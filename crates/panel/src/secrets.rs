//! Icecast passwords and rdio-scanner API keys are replaced by a sentinel in
//! every config the API returns, and restored from the on-disk config when a
//! client sends the sentinel back unchanged. Port of v0.4.110's backend/api's secrets.ts.
//!
//! Restoration runs on the request JSON before it is decoded, because it
//! needs `_matchIndex`, a frontend-only hint on each output (its array
//! position at load time, -1 for a duplicate) that is stripped afterwards.

use airband_config::RtlAirbandConfig;
use airband_config::domain::{Channel, Output};
use serde_json::Value;

pub const REDACTED_SECRET: &str = "••••••••";
const NO_MATCH: i64 = -1;

fn redact_output(output: &mut Output) {
    match output {
        Output::Icecast(o) => o.password = REDACTED_SECRET.to_string(),
        Output::File(o) => {
            if let Some(r) = &mut o.rdio_scanner {
                r.api_key = REDACTED_SECRET.to_string();
            }
        }
        _ => {}
    }
}

/// Applied to every config a GET endpoint returns.
pub fn redact_secrets(config: &RtlAirbandConfig) -> RtlAirbandConfig {
    let mut c = config.clone();
    for device in &mut c.devices {
        for channel in &mut device.channels {
            let outputs = match channel {
                Channel::Multichannel(ch) => &mut ch.outputs,
                Channel::Scan(ch) => &mut ch.outputs,
            };
            outputs.iter_mut().for_each(redact_output);
        }
    }
    for mixer in c.mixers.iter_mut().flatten() {
        mixer.outputs.iter_mut().for_each(redact_output);
    }
    c
}

/// Stable identity for pairing a channel across a client-side reorder: its frequency/frequencies.
fn channel_key(channel: &Value) -> Option<String> {
    if let Some(freqs) = channel.get("freqs").and_then(Value::as_array) {
        let parts: Vec<String> = freqs.iter().map(|f| f.as_f64().map_or(String::new(), |n| n.to_string())).collect();
        return Some(format!("fs:{}", parts.join(",")));
    }
    channel.get("freq").and_then(Value::as_f64).map(|f| format!("f:{f}"))
}

fn pick_unique(
    candidates: &[Value],
    key: Option<String>,
    keyer: impl Fn(&Value) -> Option<String>,
    index: usize,
) -> Option<&Value> {
    if let Some(k) = key {
        let matches: Vec<&Value> = candidates.iter().filter(|c| keyer(c).as_ref() == Some(&k)).collect();
        if matches.len() == 1 {
            return Some(matches[0]);
        }
    }
    candidates.get(index)
}

fn existing_output<'a>(output: &Value, index: usize, existing: Option<&'a Vec<Value>>) -> Option<&'a Value> {
    let existing = existing?;
    match output.get("_matchIndex").and_then(Value::as_i64) {
        Some(NO_MATCH) => None,
        Some(i) if i >= 0 && (i as usize) < existing.len() => existing.get(i as usize),
        _ => existing.get(index),
    }
}

fn restore_output(output: &mut Value, existing: Option<&Value>) {
    let ty = |v: &Value| v.get("type").and_then(Value::as_str).map(str::to_string);
    let output_type = ty(output);
    if output_type.as_deref() == Some("icecast")
        && output.get("password").and_then(Value::as_str) == Some(REDACTED_SECRET)
    {
        let previous = existing
            .filter(|e| ty(e).as_deref() == Some("icecast"))
            .and_then(|e| e.get("password").cloned())
            .unwrap_or(Value::String(String::new()));
        output["password"] = previous;
    }
    if output_type.as_deref() == Some("file")
        && output.pointer("/rdio_scanner/api_key").and_then(Value::as_str) == Some(REDACTED_SECRET)
    {
        let previous = existing
            .filter(|e| ty(e).as_deref() == Some("file"))
            .and_then(|e| e.pointer("/rdio_scanner/api_key").cloned())
            .unwrap_or(Value::String(String::new()));
        output["rdio_scanner"]["api_key"] = previous;
    }
    if let Some(obj) = output.as_object_mut() {
        obj.remove("_matchIndex");
    }
}

fn restore_outputs(outputs: Option<&mut Value>, existing: Option<&Vec<Value>>) {
    if let Some(Value::Array(items)) = outputs {
        for (i, output) in items.iter_mut().enumerate() {
            let previous = existing_output(output, i, existing).cloned();
            restore_output(output, previous.as_ref());
        }
    }
}

/// Restores sentinel secrets in an incoming config body from `existing`
/// (None for a brand-new instance) and strips `_matchIndex`.
pub fn restore_secrets(body: &mut Value, existing: Option<&RtlAirbandConfig>) {
    let existing = existing.map(|c| serde_json::to_value(c).expect("config serializes"));
    let existing_devices = existing.as_ref().and_then(|e| e.get("devices")).and_then(Value::as_array);

    if let Some(Value::Array(devices)) = body.get_mut("devices") {
        for (di, device) in devices.iter_mut().enumerate() {
            let existing_channels =
                existing_devices.and_then(|d| d.get(di)).and_then(|d| d.get("channels")).and_then(Value::as_array);
            if let Some(Value::Array(channels)) = device.get_mut("channels") {
                for (ci, channel) in channels.iter_mut().enumerate() {
                    let previous =
                        existing_channels.and_then(|ec| pick_unique(ec, channel_key(channel), channel_key, ci));
                    let previous_outputs = previous.and_then(|p| p.get("outputs")).and_then(Value::as_array);
                    restore_outputs(channel.get_mut("outputs"), previous_outputs);
                }
            }
        }
    }

    let existing_mixers = existing.as_ref().and_then(|e| e.get("mixers")).and_then(Value::as_array);
    let name_of = |m: &Value| m.get("name").and_then(Value::as_str).map(str::to_string);
    if let Some(Value::Array(mixers)) = body.get_mut("mixers") {
        for (mi, mixer) in mixers.iter_mut().enumerate() {
            let previous = existing_mixers.and_then(|em| pick_unique(em, name_of(mixer), name_of, mi));
            let previous_outputs = previous.and_then(|p| p.get("outputs")).and_then(Value::as_array);
            restore_outputs(mixer.get_mut("outputs"), previous_outputs);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config(outputs: Value) -> RtlAirbandConfig {
        serde_json::from_value(json!({
            "multiple_demod_threads": true, "multiple_output_threads": true, "stats_filepath": "/s", "localtime": true,
            "devices": [{ "type": "rtlsdr", "serial": "1", "gain": 29, "centerfreq": 100000000,
                "channels": [
                    { "freq": 100000000, "outputs": outputs },
                    { "freq": 100500000, "outputs": [{ "type": "icecast", "server": "s", "port": 8000, "mountpoint": "/b", "username": "u", "password": "second" }] }
                ] }]
        }))
        .unwrap()
    }

    #[test]
    fn redacts_and_restores_by_match_index_and_frequency() {
        let existing = config(json!([
            { "type": "icecast", "server": "s", "port": 8000, "mountpoint": "/a", "username": "u", "password": "first" },
            { "type": "file", "directory": "/t", "filename_template": "f", "split_on_transmission": true,
              "rdio_scanner": { "server": "r", "port": 1, "api_key": "key", "talkgroup_id": 1 } }
        ]));
        let redacted = serde_json::to_value(redact_secrets(&existing)).unwrap();
        assert_eq!(redacted.pointer("/devices/0/channels/0/outputs/0/password").unwrap(), REDACTED_SECRET);
        assert_eq!(redacted.pointer("/devices/0/channels/0/outputs/1/rdio_scanner/api_key").unwrap(), REDACTED_SECRET);

        // Client reorders channels, swaps the two outputs (keeping _matchIndex), and adds a duplicate.
        let mut body = redacted.clone();
        let channels = body.pointer_mut("/devices/0/channels").unwrap().as_array_mut().unwrap();
        channels.swap(0, 1);
        let outputs = channels[1]["outputs"].as_array_mut().unwrap();
        outputs[0]["_matchIndex"] = json!(0);
        outputs[1]["_matchIndex"] = json!(1);
        outputs.swap(0, 1);
        let mut dup = outputs[1].clone();
        dup["_matchIndex"] = json!(-1);
        outputs.push(dup);

        restore_secrets(&mut body, Some(&existing));
        assert_eq!(body.pointer("/devices/0/channels/0/outputs/0/password").unwrap(), "second");
        assert_eq!(body.pointer("/devices/0/channels/1/outputs/0/rdio_scanner/api_key").unwrap(), "key");
        assert_eq!(body.pointer("/devices/0/channels/1/outputs/1/password").unwrap(), "first");
        assert_eq!(body.pointer("/devices/0/channels/1/outputs/2/password").unwrap(), "", "a duplicate never inherits");
        assert!(body.pointer("/devices/0/channels/1/outputs/1/_matchIndex").is_none(), "stripped");
        assert!(serde_json::from_value::<RtlAirbandConfig>(body).is_ok());
    }

    #[test]
    fn typed_values_pass_through() {
        let existing = config(
            json!([{ "type": "icecast", "server": "s", "port": 8000, "mountpoint": "/a", "username": "u", "password": "old" }]),
        );
        let mut body = serde_json::to_value(&existing).unwrap();
        body["devices"][0]["channels"][0]["outputs"][0]["password"] = json!("new");
        restore_secrets(&mut body, Some(&existing));
        assert_eq!(body.pointer("/devices/0/channels/0/outputs/0/password").unwrap(), "new");
    }
}
