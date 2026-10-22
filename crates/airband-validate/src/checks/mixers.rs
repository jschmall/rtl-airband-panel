//! Mixer checks: references, usage, nested-output rules, ranges, remote inputs.

use std::collections::{HashMap, HashSet};

use airband_config::domain::{Output, RtlAirbandConfig};

use crate::types::Issues;
use crate::view::js;

fn channel_mixer_outputs(
    config: &RtlAirbandConfig,
) -> impl Iterator<Item = (String, &airband_config::domain::MixerOutput)> {
    config.devices.iter().enumerate().flat_map(|(di, device)| {
        device.channels.iter().enumerate().flat_map(move |(ci, channel)| {
            channel.outputs().iter().enumerate().filter_map(move |(oi, output)| match output {
                Output::Mixer(m) => Some((format!("$.devices[{di}].channels[{ci}].outputs[{oi}]"), m)),
                _ => None,
            })
        })
    })
}

/// A channel output of type "mixer" must name an existing top-level mixer.
pub fn mixer_references(config: &RtlAirbandConfig, issues: &mut Issues) {
    let names: HashSet<&str> = config.mixers.iter().flatten().map(|m| m.name.as_str()).collect();
    for (path, m) in channel_mixer_outputs(config) {
        if !names.contains(m.name.as_str()) {
            issues.error(
                "mixer-reference-not-found",
                path,
                format!(
                    "output routes into mixer '{}', which has no matching entry in the top-level mixers list",
                    m.name
                ),
            );
        }
    }
}

/// A mixer nothing routes into makes RTLSDR-Airband exit at startup. A
/// mixer with no active outputs is left to `disable_cascade`.
pub fn mixer_unused(config: &RtlAirbandConfig, issues: &mut Issues) {
    let referenced: HashSet<&str> = channel_mixer_outputs(config).map(|(_, m)| m.name.as_str()).collect();
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        if mixer.disable == Some(true) || referenced.contains(mixer.name.as_str()) {
            continue;
        }
        if !mixer.outputs.iter().any(|o| o.disable() != Some(true)) {
            continue;
        }
        issues.error(
            "mixer-unused",
            format!("$.mixers[{mi}]"),
            format!(
                "mixer '{}' has no channel outputs routed into it; RTLSDR-Airband has nothing to write to this mixer and will exit at startup",
                mixer.name
            ),
        );
    }
}

/// A mixer's own outputs: no rawfile, no split_on_transmission, and pulse
/// outputs need stream_name.
pub fn mixer_nested_outputs(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        for (oi, output) in mixer.outputs.iter().enumerate() {
            let path = format!("$.mixers[{mi}].outputs[{oi}]");
            if matches!(output, Output::RawFile(_)) {
                issues.error("mixer-output-rawfile-not-allowed", &path, "rawfile output is not allowed for mixers");
            }
            let split = match output {
                Output::File(o) => o.split_on_transmission,
                Output::RawFile(o) => o.split_on_transmission,
                _ => None,
            };
            if split == Some(true) {
                issues.error(
                    "mixer-output-split-on-transmission-not-allowed",
                    &path,
                    "split_on_transmission is not allowed for mixers",
                );
            }
            if let Output::Pulse(p) = output
                && p.stream_name.is_none()
            {
                issues.error(
                    "mixer-output-pulse-stream-name-required",
                    &path,
                    "pulse outputs of mixers must have stream_name defined",
                );
            }
        }
    }
}

/// balance on a channel's mixer output must be in [-1.0, 1.0].
pub fn mixer_output_balance(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (path, m) in channel_mixer_outputs(config) {
        if let Some(b) = m.balance
            && !(-1.0..=1.0).contains(&b)
        {
            issues.error(
                "mixer-output-balance-out-of-range",
                path,
                format!("balance {} is out of allowed range <-1.0;1.0>", js(b)),
            );
        }
    }
}

pub fn mixer_reserve_inputs(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        if let Some(r) = mixer.reserve_inputs
            && r < 0.0
        {
            issues.error(
                "mixer-reserve-inputs-negative",
                format!("$.mixers[{mi}]"),
                format!("reserve_inputs {} must not be negative", js(r)),
            );
        }
    }
}

/// remote_inputs: non-empty listen_path, non-negative stream_id, balance in
/// range, and (listen_path, stream_id) unique across ALL mixers (the fork
/// shares one listener registry per listen_path).
pub fn mixer_remote_inputs(config: &RtlAirbandConfig, issues: &mut Issues) {
    let mut seen: HashMap<&str, Vec<f64>> = HashMap::new();
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        for (ri, input) in mixer.remote_inputs.iter().flatten().enumerate() {
            let path = format!("$.mixers[{mi}].remote_inputs[{ri}]");
            if input.listen_path.trim().is_empty() {
                issues.error("mixer-remote-input-listen-path-empty", &path, "listen_path must not be empty");
            }
            if input.stream_id < 0.0 {
                issues.error(
                    "mixer-remote-input-stream-id-negative",
                    &path,
                    format!("stream_id {} must not be negative", js(input.stream_id)),
                );
            }
            if let Some(b) = input.balance
                && !(-1.0..=1.0).contains(&b)
            {
                issues.error(
                    "mixer-remote-input-balance-out-of-range",
                    &path,
                    format!("balance {} is out of allowed range <-1.0;1.0>", js(b)),
                );
            }
            let ids = seen.entry(input.listen_path.as_str()).or_default();
            if ids.contains(&input.stream_id) {
                issues.error(
                    "mixer-remote-input-duplicate-stream-id",
                    &path,
                    format!("duplicate stream_id {} for listen_path {}", js(input.stream_id), input.listen_path),
                );
            } else {
                ids.push(input.stream_id);
            }
        }
    }
}
