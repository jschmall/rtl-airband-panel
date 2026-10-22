//! Reads the Prometheus-text stats RTLSDR-Airband writes to `stats_filepath`
//! (or serves on `stats_http_address:stats_http_port`). Port of
//! v0.4.110's backend/api/src/stats/{prometheus-parser,poller}.ts; the polling loop
//! and storage live in the panel.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatSample {
    pub metric: String,
    pub labels: BTreeMap<String, String>,
    pub value: f64,
}

/// Parses Prometheus text exposition format: `# HELP`/`# TYPE` comments,
/// then `name{label="value",...} value` lines. Malformed lines are skipped.
pub fn parse_prometheus_text(text: &str) -> Vec<StatSample> {
    text.lines().filter_map(|l| parse_sample_line(l.trim())).collect()
}

fn is_metric_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == ':')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':')
}

fn parse_sample_line(line: &str) -> Option<StatSample> {
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (series, value_text) = line.rsplit_once(char::is_whitespace)?;
    let value: f64 = value_text.parse().ok().filter(|v: &f64| v.is_finite())?;
    let series = series.trim_end();
    let (metric, labels) = match series.split_once('{') {
        Some((name, rest)) => (name, parse_labels(rest.strip_suffix('}')?)?),
        None => (series, BTreeMap::new()),
    };
    is_metric_name(metric).then(|| StatSample { metric: metric.to_string(), labels, value })
}

fn parse_labels(s: &str) -> Option<BTreeMap<String, String>> {
    let mut labels = BTreeMap::new();
    let mut rest = s.trim();
    while !rest.is_empty() {
        let (key, after) = rest.split_once('=')?;
        let after = after.strip_prefix('"')?;
        let mut value = String::new();
        let mut chars = after.char_indices();
        let mut end = None;
        while let Some((i, c)) = chars.next() {
            match c {
                '\\' => match chars.next() {
                    Some((_, 'n')) => value.push('\n'),
                    Some((_, other)) => value.push(other),
                    None => return None,
                },
                '"' => {
                    end = Some(i);
                    break;
                }
                other => value.push(other),
            }
        }
        labels.insert(key.trim().to_string(), value);
        rest = after[end? + 1..].trim_start().trim_start_matches(',').trim_start();
    }
    Some(labels)
}

/// A real stats snapshot is a few KB; stats_filepath comes from an
/// instance's config unchecked, so bound what one bad instance can cost.
pub const MAX_STATS_BYTES: u64 = 5 * 1024 * 1024;
pub const READ_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Error)]
pub enum StatsError {
    #[error("stats_filepath ({path}) is {size} bytes, over the {MAX_STATS_BYTES}-byte cap -- refusing to read it")]
    TooLarge { path: String, size: u64 },
    #[error("reading {0} timed out after {READ_TIMEOUT:?}")]
    Timeout(String),
    #[error("reading {path}: {source}")]
    Io { path: String, source: std::io::Error },
    #[error("stats endpoint {0} returned a non-200 response")]
    Http(String),
}

/// Where an instance publishes stats.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatsSource {
    File(PathBuf),
    /// `stats_http_address:stats_http_port` (fork feature); any request
    /// returns the current stats file contents.
    Http {
        address: String,
        port: u16,
    },
}

impl StatsSource {
    /// Prefers the HTTP endpoint when configured (no file permissions needed).
    pub fn for_config(config: &airband_config::RtlAirbandConfig) -> Option<StatsSource> {
        if let (Some(address), Some(port)) = (&config.stats_http_address, config.stats_http_port)
            && (1.0..=65535.0).contains(&port)
        {
            let address = if address == "0.0.0.0" { "127.0.0.1".to_string() } else { address.clone() };
            return Some(StatsSource::Http { address, port: port as u16 });
        }
        (!config.stats_filepath.is_empty()).then(|| StatsSource::File(PathBuf::from(&config.stats_filepath)))
    }
}

/// Reads stats snapshots, skipping a file whose mtime hasn't changed since
/// the last read (a stopped instance leaves its last file in place forever).
#[derive(Default)]
pub struct StatsReader {
    last_mtime: Mutex<HashMap<String, SystemTime>>,
}

impl StatsReader {
    /// `Ok(None)`: nothing new (unchanged file, or no file yet).
    pub async fn read(&self, instance: &str, source: &StatsSource) -> Result<Option<Vec<StatSample>>, StatsError> {
        match source {
            StatsSource::File(path) => self.read_file(instance, path).await,
            StatsSource::Http { address, port } => read_http(address, *port).await.map(Some),
        }
    }

    async fn read_file(&self, instance: &str, path: &Path) -> Result<Option<Vec<StatSample>>, StatsError> {
        let shown = path.display().to_string();
        let Ok(meta) = tokio::fs::metadata(path).await else { return Ok(None) };
        let mtime = meta.modified().ok();
        {
            let mut seen = self.last_mtime.lock().unwrap();
            if mtime.is_some() && seen.get(instance) == mtime.as_ref() {
                return Ok(None);
            }
            if let Some(m) = mtime {
                seen.insert(instance.to_string(), m);
            }
        }
        if meta.len() > MAX_STATS_BYTES {
            return Err(StatsError::TooLarge { path: shown, size: meta.len() });
        }
        let read = async {
            let file = tokio::fs::File::open(path).await?;
            let mut text = String::new();
            file.take(MAX_STATS_BYTES).read_to_string(&mut text).await?;
            Ok::<_, std::io::Error>(text)
        };
        let text = tokio::time::timeout(READ_TIMEOUT, read)
            .await
            .map_err(|_| StatsError::Timeout(shown.clone()))?
            .map_err(|source| StatsError::Io { path: shown, source })?;
        Ok(Some(parse_prometheus_text(&text)))
    }
}

async fn read_http(address: &str, port: u16) -> Result<Vec<StatSample>, StatsError> {
    let endpoint = format!("{address}:{port}");
    let fetch = async {
        let mut stream = TcpStream::connect(&endpoint).await?;
        stream.write_all(format!("GET / HTTP/1.0\r\nHost: {endpoint}\r\n\r\n").as_bytes()).await?;
        let mut body = Vec::new();
        stream.take(MAX_STATS_BYTES).read_to_end(&mut body).await?;
        Ok::<_, std::io::Error>(String::from_utf8_lossy(&body).into_owned())
    };
    let response = tokio::time::timeout(READ_TIMEOUT, fetch)
        .await
        .map_err(|_| StatsError::Timeout(endpoint.clone()))?
        .map_err(|source| StatsError::Io { path: endpoint.clone(), source })?;
    let (head, body) = response.split_once("\r\n\r\n").ok_or_else(|| StatsError::Http(endpoint.clone()))?;
    if !head.lines().next().is_some_and(|status| status.split_whitespace().nth(1) == Some("200")) {
        return Err(StatsError::Http(endpoint));
    }
    Ok(parse_prometheus_text(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_exposition_text() {
        let text = r#"
# HELP channel_activity_counter Loops of output_thread with frequency active.
# TYPE channel_activity_counter counter
channel_activity_counter{freq="151.160",label="Tower \"A\""} 42
channel_noise_level{freq="151.160",label=""}	-38.5
buffer_overflow_count 0
bad line here
nan_metric NaN
"#;
        let s = parse_prometheus_text(text);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].metric, "channel_activity_counter");
        assert_eq!(s[0].labels["label"], "Tower \"A\"");
        assert_eq!(s[0].value, 42.0);
        assert_eq!(s[1].value, -38.5);
        assert_eq!(s[1].labels["label"], "");
        assert!(s[2].labels.is_empty());
    }
}
