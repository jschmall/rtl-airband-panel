//! Client for a running instance's control socket (RTLSDR-Airband fork,
//! src/control_socket.cpp): AF_UNIX stream, one flat JSON object per line,
//! exactly one response line per request, same-UID peers only. Port of
//! v0.4.110's backend/api/src/control-socket/unix-client.ts, extended to the other
//! commands.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

/// The daemon serves one connection at a time with its own 10 s receive timeout.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ReloadDiffResult {
    Applied {
        /// What the process live-applied, verbatim from the socket.
        applied: Vec<String>,
        /// What still needs a restart, verbatim from the socket.
        #[serde(rename = "skippedRequiresRestart")]
        skipped_requires_restart: Vec<String>,
    },
    /// Nothing listening, stale socket file, permission error, or timeout.
    /// Never means "the config is bad"; fall back to a restart.
    Unreachable { reason: String },
    /// The socket answered `{"ok":false,...}` or something unparseable.
    ProtocolError { message: String },
}

/// Result of a single-purpose command (retune, set_gain, ...).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommandResult {
    Ok,
    Unreachable { reason: String },
    ProtocolError { message: String },
}

/// Reply to the read-only `status` command (fork v6.4.0+), field names as the
/// daemon sends them. Counters are cumulative since the process started.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StatusReport {
    pub version: String,
    pub devices: Vec<DeviceStatus>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DeviceStatus {
    /// Index among the config's non-disabled devices.
    pub index: u32,
    pub driver: Option<String>,
    pub state: String,
    pub mode: String,
    pub centerfreq: i64,
    pub sample_rate: i64,
    /// dB. None when the driver can't express it as one number (AGC, or
    /// SoapySDR per-element gains) or doesn't report it.
    pub gain: Option<f64>,
    /// ppm (Hz for mirisdr, whose library has no ppm correction).
    pub correction: Option<f64>,
    /// Tuner bandwidth in Hz, 0 = driver default.
    pub bandwidth: Option<i64>,
    /// Largest sample over the last ~1 s relative to ADC full scale; None
    /// until the first window completes.
    pub peak_dbfs: Option<f64>,
    pub clipped_samples: u64,
    pub buffer_overflows: u64,
    pub buffer_underruns: u64,
    pub retune_failures: u64,
    pub output_overruns: u64,
    pub channels: Vec<ChannelStatus>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ChannelStatus {
    /// Index among the device's non-disabled channels.
    pub index: u32,
    pub enabled: bool,
    /// Which of `freqs` is tuned (scan channels; always 0 otherwise).
    pub freq_idx: u32,
    pub squelch_open: bool,
    pub freqs: Vec<FreqStatus>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FreqStatus {
    pub freq: i64,
    pub label: Option<String>,
    pub modulation: String,
    pub noise_dbfs: Option<f64>,
    pub signal_dbfs: Option<f64>,
    /// Smoothed carrier offset from `freq`, measured while squelch was open.
    pub freq_offset_hz: Option<f64>,
    pub freq_offset_updates: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StatusResult {
    Ok(StatusReport),
    /// The daemon answered but doesn't know `status`: a binary older than
    /// fork v6.4.0.
    Unsupported,
    Unreachable {
        reason: String,
    },
    ProtocolError {
        message: String,
    },
}

/// A control-socket command. Fields mirror the daemon's flat JSON fields.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    ReloadDiff,
    Status,
    Retune { device: u32, freq: i64 },
    SetSampleRate { device: u32, sample_rate: i64 },
    SetGain { device: u32, gain: f64 },
    SetBandwidth { device: u32, bandwidth: i64 },
    SetCorrection { device: u32, correction: i64 },
    ChannelEnable { device: u32, channel: u32 },
    ChannelDisable { device: u32, channel: u32 },
    MixerEnable { mixer: String },
    MixerDisable { mixer: String },
}

impl Command {
    pub fn to_line(&self) -> String {
        let v = match self {
            Command::ReloadDiff => json!({ "cmd": "reload_diff" }),
            Command::Status => json!({ "cmd": "status" }),
            Command::Retune { device, freq } => json!({ "cmd": "retune", "device": device, "freq": freq }),
            Command::SetSampleRate { device, sample_rate } => {
                json!({ "cmd": "set_sample_rate", "device": device, "sample_rate": sample_rate })
            }
            Command::SetGain { device, gain } => json!({ "cmd": "set_gain", "device": device, "gain": gain }),
            Command::SetBandwidth { device, bandwidth } => {
                json!({ "cmd": "set_bandwidth", "device": device, "bandwidth": bandwidth })
            }
            Command::SetCorrection { device, correction } => {
                json!({ "cmd": "set_correction", "device": device, "correction": correction })
            }
            Command::ChannelEnable { device, channel } => {
                json!({ "cmd": "channel_enable", "device": device, "channel": channel })
            }
            Command::ChannelDisable { device, channel } => {
                json!({ "cmd": "channel_disable", "device": device, "channel": channel })
            }
            Command::MixerEnable { mixer } => json!({ "cmd": "mixer_enable", "mixer": mixer }),
            Command::MixerDisable { mixer } => json!({ "cmd": "mixer_disable", "mixer": mixer }),
        };
        format!("{v}\n")
    }
}

#[derive(Debug, Clone)]
pub struct ControlSocketClient {
    timeout: Duration,
}

impl Default for ControlSocketClient {
    fn default() -> Self {
        ControlSocketClient { timeout: DEFAULT_TIMEOUT }
    }
}

enum Exchange {
    Line(Map<String, Value>),
    Unreachable(String),
    Protocol(String),
}

impl ControlSocketClient {
    pub fn new(timeout: Duration) -> Self {
        ControlSocketClient { timeout }
    }

    pub async fn reload_diff(&self, socket_path: &Path) -> ReloadDiffResult {
        match self.exchange(socket_path, &Command::ReloadDiff).await {
            Exchange::Unreachable(reason) => ReloadDiffResult::Unreachable { reason },
            Exchange::Protocol(message) => ReloadDiffResult::ProtocolError { message },
            Exchange::Line(obj) => {
                let strings = |key: &str| -> Option<Vec<String>> {
                    obj.get(key)?.as_array()?.iter().map(|v| v.as_str().map(str::to_string)).collect()
                };
                match (obj.get("ok"), strings("applied"), strings("skipped_requires_restart")) {
                    (Some(Value::Bool(true)), Some(applied), Some(skipped_requires_restart)) => {
                        ReloadDiffResult::Applied { applied, skipped_requires_restart }
                    }
                    (Some(Value::Bool(false)), _, _) if obj.get("error").is_some_and(Value::is_string) => {
                        ReloadDiffResult::ProtocolError { message: obj["error"].as_str().unwrap().to_string() }
                    }
                    _ => ReloadDiffResult::ProtocolError {
                        message: format!("unrecognized response shape: {}", Value::Object(obj)),
                    },
                }
            }
        }
    }

    pub async fn status(&self, socket_path: &Path) -> StatusResult {
        match self.exchange(socket_path, &Command::Status).await {
            Exchange::Unreachable(reason) => StatusResult::Unreachable { reason },
            Exchange::Protocol(message) => StatusResult::ProtocolError { message },
            Exchange::Line(obj) => match (obj.get("ok"), obj.get("error")) {
                (Some(Value::Bool(false)), Some(Value::String(e))) if e.starts_with("unknown cmd") => {
                    StatusResult::Unsupported
                }
                (Some(Value::Bool(false)), Some(Value::String(e))) => {
                    StatusResult::ProtocolError { message: e.clone() }
                }
                _ => match serde_json::from_value::<StatusReport>(Value::Object(obj)) {
                    Ok(report) => StatusResult::Ok(report),
                    Err(e) => StatusResult::ProtocolError { message: format!("unrecognized status reply: {e}") },
                },
            },
        }
    }

    pub async fn send(&self, socket_path: &Path, command: &Command) -> CommandResult {
        match self.exchange(socket_path, command).await {
            Exchange::Unreachable(reason) => CommandResult::Unreachable { reason },
            Exchange::Protocol(message) => CommandResult::ProtocolError { message },
            Exchange::Line(obj) => match (obj.get("ok"), obj.get("error")) {
                (Some(Value::Bool(true)), _) => CommandResult::Ok,
                (Some(Value::Bool(false)), Some(Value::String(e))) => {
                    CommandResult::ProtocolError { message: e.clone() }
                }
                _ => CommandResult::ProtocolError {
                    message: format!("unrecognized response shape: {}", Value::Object(obj)),
                },
            },
        }
    }

    /// Connect, send one line, read one line. Connect-per-request: this is
    /// a rare local IPC call, and the daemon serves one connection at a time.
    async fn exchange(&self, socket_path: &Path, command: &Command) -> Exchange {
        let attempt = async {
            let stream = UnixStream::connect(socket_path).await.map_err(|e| Exchange::Unreachable(io_reason(&e)))?;
            let (read, mut write) = stream.into_split();
            write.write_all(command.to_line().as_bytes()).await.map_err(|e| Exchange::Unreachable(io_reason(&e)))?;
            let mut line = String::new();
            let n =
                BufReader::new(read).read_line(&mut line).await.map_err(|e| Exchange::Unreachable(io_reason(&e)))?;
            if n == 0 || !line.ends_with('\n') {
                return Err(Exchange::Unreachable("connection closed before a response line arrived".into()));
            }
            Ok(line)
        };
        let line = match tokio::time::timeout(self.timeout, attempt).await {
            Err(_) => return Exchange::Unreachable("timeout".into()),
            Ok(Err(e)) => return e,
            Ok(Ok(line)) => line,
        };
        let line = line.trim_end();
        match serde_json::from_str::<Value>(line) {
            Ok(Value::Object(obj)) => Exchange::Line(obj),
            Ok(_) => Exchange::Protocol(format!("expected a JSON object, got: {line}")),
            Err(_) => Exchange::Protocol(format!("non-JSON response line: {line}")),
        }
    }
}

/// Short errno-style reasons ("ENOENT", "EACCES", ...), as the TS client reported.
fn io_reason(e: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    match e.kind() {
        NotFound => "ENOENT".into(),
        ConnectionRefused => "ECONNREFUSED".into(),
        PermissionDenied => "EACCES".into(),
        ConnectionReset => "ECONNRESET".into(),
        BrokenPipe => "EPIPE".into(),
        _ => e.to_string(),
    }
}
