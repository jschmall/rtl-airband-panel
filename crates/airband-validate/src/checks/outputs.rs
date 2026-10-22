//! Output-level checks, across device-channel and mixer outputs.

use airband_config::domain::{Output, RtlAirbandConfig};

use crate::types::Issues;
use crate::view::{Owner, for_each_output_list, is_scan_device, js};

/// send_tx_tags is rejected on scan-mode channels (the frequency changes at
/// runtime there; send_scan_freq_tags covers that). Mixers are exempt.
pub fn send_tx_tags(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (di, device) in config.devices.iter().enumerate() {
        if !is_scan_device(device) {
            continue;
        }
        for (ci, channel) in device.channels.iter().enumerate() {
            for (oi, output) in channel.outputs().iter().enumerate() {
                if let Output::Icecast(o) = output
                    && o.send_tx_tags == Some(true)
                {
                    issues.error(
                        "send-tx-tags-not-supported-on-scan-mode",
                        format!("$.devices[{di}].channels[{ci}].outputs[{oi}]"),
                        "send_tx_tags is not supported on scan-mode channels — the frequency itself changes at runtime there; use send_scan_freq_tags instead",
                    );
                }
            }
        }
    }
}

/// rdio_scanner needs split_on_transmission, isn't allowed on scan-mode
/// channels, and has timeout/retry/queue-depth bounds.
pub fn rdio_scanner(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_output_list(config, |prefix, outputs, owner| {
        let is_scan = matches!(owner, Owner::Channel { device, .. } if is_scan_device(device));
        for (oi, output) in outputs.iter().enumerate() {
            let Output::File(file) = output else { continue };
            let Some(rdio) = &file.rdio_scanner else { continue };
            if rdio.disable == Some(true) {
                continue;
            }
            let output_path = format!("{prefix}.outputs[{oi}]");
            if file.split_on_transmission != Some(true) {
                issues.error(
                    "rdio-scanner-requires-split-on-transmission",
                    &output_path,
                    "rdio_scanner requires split_on_transmission to be true on the same output",
                );
            }
            if is_scan {
                issues.error(
                    "rdio-scanner-not-supported-on-scan-mode",
                    &output_path,
                    "rdio_scanner is not supported on scan-mode channels — talkgroup_id and the other per-channel fields are fixed at config time and can't track the frequency currently being scanned",
                );
            }
            if let Some(t) = rdio.timeout_ms
                && t <= 0.0
            {
                issues.error(
                    "rdio-scanner-invalid-timeout",
                    format!("{output_path}.rdio_scanner.timeout_ms"),
                    "rdio_scanner timeout_ms must be greater than 0 (0 means libcurl never times out)",
                );
            }
            if let Some(r) = rdio.max_retries
                && r < 0.0
            {
                issues.error(
                    "rdio-scanner-invalid-max-retries",
                    format!("{output_path}.rdio_scanner.max_retries"),
                    "rdio_scanner max_retries must not be negative",
                );
            }
        }
    });
    if let Some(d) = config.rdio_scanner_queue_depth
        && d <= 0.0
    {
        issues.error(
            "rdio-scanner-invalid-queue-depth",
            "$.rdio_scanner_queue_depth",
            "rdio_scanner_queue_depth must be greater than 0",
        );
    }
}

/// A file output can't be both continuous and split_on_transmission.
pub fn file_output_flags(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            if let Output::File(o) = output
                && o.continuous == Some(true)
                && o.split_on_transmission == Some(true)
            {
                issues.error(
                    "file-output-continuous-and-split-on-transmission",
                    format!("{prefix}.outputs[{oi}]"),
                    "can't have both continuous and split_on_transmission set on the same file output",
                );
            }
        }
    });
}

/// A udp_stream output's sample_rate must be greater than 0.
pub fn udp_stream_sample_rate(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            if let Output::UdpStream(o) = output
                && let Some(sr) = o.sample_rate
                && sr <= 0.0
            {
                issues.error(
                    "udp-stream-sample-rate-non-positive",
                    format!("{prefix}.outputs[{oi}].sample_rate"),
                    "udp_stream sample_rate must be greater than 0",
                );
            }
        }
    });
}

/// post_write_script is legitimate but runs an arbitrary command after
/// every write; worth a standing reminder whenever it's present.
pub fn post_write_script(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            if let Output::File(o) = output
                && o.post_write_script.as_deref().is_some_and(|s| !s.is_empty())
            {
                issues.warning(
                    "post-write-script-runs-arbitrary-command",
                    format!("{prefix}.outputs[{oi}].post_write_script"),
                    "post_write_script runs an arbitrary command after every write; make sure this instance's config can't be edited by anyone you wouldn't trust to run commands as the rtl_airband process user",
                );
            }
        }
    });
}

/// A mixer_remote output's stream_id must not be negative.
pub fn mixer_remote_output_stream_id(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            if let Output::MixerRemote(o) = output
                && o.stream_id < 0.0
            {
                issues.error(
                    "mixer-remote-output-stream-id-negative",
                    format!("{prefix}.outputs[{oi}]"),
                    format!("stream_id {} must not be negative", js(o.stream_id)),
                );
            }
        }
    });
}
