//! Device-level checks: capture window, FFT bins, scan-mode structure,
//! per-type requirements, and the disable cascade.

use std::collections::HashMap;

use airband_config::domain::{Channel, Device, RtlAirbandConfig};

use crate::constants::*;
use crate::types::Issues;
use crate::view::{ChannelView, is_scan_device, js};

/// A non-scan device's centerfreq and the half-width of its usable capture
/// window. None for a scan-mode device (it retunes per frequency) or one
/// without a centerfreq.
fn window(device: &Device) -> Option<(f64, f64)> {
    let centerfreq = device.centerfreq?;
    if is_scan_device(device) {
        return None;
    }
    let sample_rate = device.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE_HZ);
    Some((centerfreq, (sample_rate / 2.0) * SOFT_BW_THRESHOLD))
}

/// The usable capture window (low, high Hz) frequency_window checks a
/// device's channels against; see `window`.
pub fn usable_window_hz(device: &Device) -> Option<(f64, f64)> {
    window(device).map(|(centerfreq, bw_limit)| (centerfreq - bw_limit, centerfreq + bw_limit))
}

/// Warns (RTLSDR-Airband itself only logs a warning) when a channel sits
/// outside the SDR's usable capture bandwidth around its device's
/// centerfreq. Not applicable to scan-mode devices, which retune per frequency.
pub fn frequency_window(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (di, device) in config.devices.iter().enumerate() {
        let Some((centerfreq, bw_limit)) = window(device) else { continue };
        for (ci, channel) in device.channels.iter().enumerate() {
            let Some(freq) = channel.freq() else { continue };
            if (freq - centerfreq).abs() < bw_limit {
                continue;
            }
            issues.warning(
                "frequency-out-of-window",
                format!("$.devices[{di}].channels[{ci}]"),
                format!(
                    "channel frequency {} Hz is outside of the SDR's usable operating bandwidth ({}-{} Hz around centerfreq {} Hz)",
                    js(freq),
                    js(centerfreq - bw_limit),
                    js(centerfreq + bw_limit),
                    js(centerfreq)
                ),
            );
        }
    }
}

/// Errors when two channels on one device with *different* frequencies
/// quantize to the same FFT bin; RTLSDR-Airband doesn't detect this and the
/// second channel silently demodulates the wrong audio. Identical
/// frequencies are the legitimate multi-CTCSS pattern and never flagged.
pub fn bin_collisions(config: &RtlAirbandConfig, issues: &mut Issues) {
    let fft_size = config.fft_size.unwrap_or(DEFAULT_FFT_SIZE);
    for (di, device) in config.devices.iter().enumerate() {
        let Some(centerfreq) = device.centerfreq else { continue };
        if is_scan_device(device) {
            continue;
        }
        let sample_rate = device.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE_HZ);
        let bin_width_hz = sample_rate / fft_size;
        // bin -> (freq, index of the first channel seen at that freq), in insertion order
        let mut anchors: HashMap<u64, Vec<(f64, usize)>> = HashMap::new();
        for (ci, channel) in device.channels.iter().enumerate() {
            let Some(freq) = channel.freq() else { continue };
            let bin = compute_bin(freq, centerfreq, sample_rate, fft_size);
            let for_bin = anchors.entry(bin.to_bits()).or_default();
            if for_bin.iter().any(|(f, _)| *f == freq) {
                continue;
            }
            if let Some((anchor_freq, anchor_ci)) = for_bin.first() {
                issues.error(
                    "fft-bin-collision",
                    format!("$.devices[{di}].channels[{ci}]"),
                    format!(
                        "channel frequency {} Hz collides with channels[{anchor_ci}]'s {} Hz — both quantize to FFT bin {} (bin width {} Hz), so only one will be demodulated correctly",
                        js(freq),
                        js(*anchor_freq),
                        js(bin),
                        js(bin_width_hz)
                    ),
                );
            }
            for_bin.push((freq, ci));
        }
    }
}

/// Scan-mode structure: a scan device has exactly one `freqs` channel, a
/// non-scan device has none, and per-frequency lists cover every frequency.
pub fn scan_mode(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (di, device) in config.devices.iter().enumerate() {
        let device_path = format!("$.devices[{di}]");
        let scan_channel_count = device.channels.iter().filter(|c| c.is_scan()).count();

        if is_scan_device(device) {
            if device.channels.len() != 1 {
                issues.error(
                    "scan-mode-single-channel",
                    &device_path,
                    format!(
                        "device is in scan mode but has {} channel entries; scan mode allows exactly one",
                        device.channels.len()
                    ),
                );
            }
            if scan_channel_count != device.channels.len() {
                issues.error(
                    "scan-mode-channel-shape-mismatch",
                    &device_path,
                    "device is in scan mode but its channel uses 'freq' instead of 'freqs'",
                );
            }
        } else if scan_channel_count > 0 {
            issues.error(
                "scan-mode-channel-shape-mismatch",
                &device_path,
                "device has a channel using 'freqs' (scan mode) but the device's mode is not \"scan\"",
            );
        }

        for (ci, channel) in device.channels.iter().enumerate() {
            let Channel::Scan(c) = channel else { continue };
            let channel_path = format!("{device_path}.channels[{ci}]");
            let freq_count = c.freqs.len();
            if freq_count == 0 {
                issues.error(
                    "scan-freqs-empty",
                    format!("{channel_path}.freqs"),
                    "freqs should be a list with at least one element",
                );
            }
            let list_len = |v: &Option<airband_config::domain::NumberOrList>| match v {
                Some(airband_config::domain::NumberOrList::Many(ns)) => Some(ns.len()),
                _ => None,
            };
            let lists: [(&str, Option<usize>); 9] = [
                ("labels", c.labels.as_ref().map(Vec::len)),
                ("modulations", c.modulations.as_ref().map(Vec::len)),
                ("ampfactor", list_len(&c.ampfactor)),
                ("ctcss", list_len(&c.ctcss)),
                ("notch", list_len(&c.notch)),
                ("notch_q", list_len(&c.notch_q)),
                ("bandwidth", list_len(&c.bandwidth)),
                ("squelch_threshold", list_len(&c.squelch_threshold)),
                ("squelch_snr_threshold", list_len(&c.squelch_snr_threshold)),
            ];
            for (field, len) in lists {
                let Some(len) = len else { continue };
                let path = format!("{channel_path}.{field}");
                if len < freq_count {
                    issues.error(
                        "scan-list-too-short",
                        path,
                        format!("'{field}' has {len} entries but 'freqs' has {freq_count}; RTLSDR-Airband requires at least one entry per scanned frequency"),
                    );
                } else if len > freq_count {
                    issues.warning(
                        "scan-list-too-long",
                        path,
                        format!("'{field}' has {len} entries but 'freqs' only has {freq_count}; the extra entries are ignored"),
                    );
                }
            }
        }
    }
}

const KNOWN_DEVICE_TYPES: [&str; 3] = ["rtlsdr", "mirisdr", "soapysdr"];

/// Per-type/mode requiredness and RTLSDR-Airband's device startup checks.
pub fn device_requirements(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (di, device) in config.devices.iter().enumerate() {
        let path = format!("$.devices[{di}]");
        let ty = device.device_type.as_str();
        let (is_soapy, is_rtl, is_miri) = (ty == "soapysdr", ty == "rtlsdr", ty == "mirisdr");

        if !KNOWN_DEVICE_TYPES.contains(&ty) {
            issues.error(
                "device-type-unsupported",
                &path,
                format!("unsupported device type '{ty}' (must be one of: {})", KNOWN_DEVICE_TYPES.join(", ")),
            );
        }
        if !is_soapy && device.gain.is_none() {
            issues.error(
                "device-gain-required",
                &path,
                format!(
                    "device type '{ty}' requires a 'gain' value (only soapysdr devices may omit it, to enable AGC)"
                ),
            );
        }
        if is_soapy && device.device_string.is_none() {
            issues.error("device-string-required", &path, "soapysdr devices require a 'device_string'");
        }
        if !is_scan_device(device) && device.centerfreq.is_none() {
            issues.error(
                "device-centerfreq-required",
                &path,
                "device is in multichannel mode and requires a 'centerfreq'",
            );
        }
        if (is_rtl || is_miri) && device.serial.is_none() && device.index.is_none() {
            issues.error(
                "device-serial-or-index-required",
                &path,
                format!("device type '{ty}' requires either 'serial' or 'index' to select a dongle"),
            );
        }

        let sample_rate = device.sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE_HZ);
        if sample_rate <= MIN_SAMPLE_RATE_HZ {
            issues.error(
                "device-sample-rate-too-low",
                &path,
                format!("sample_rate {} must be greater than {}", js(sample_rate), js(MIN_SAMPLE_RATE_HZ)),
            );
        }
        let (dead_min, dead_max) = RTLSDR_SAMPLE_RATE_DEAD_ZONE;
        if is_rtl && sample_rate >= dead_min && sample_rate <= dead_max {
            issues.error(
                "device-sample-rate-unsupported",
                &path,
                format!(
                    "sample_rate {} is outside librtlsdr's supported ranges (225001-300000 or 900001-3200000 Hz)",
                    js(sample_rate)
                ),
            );
        }
        if let Some(b) = device.buffers
            && is_rtl
            && b <= 0.0
        {
            issues.error("device-buffers-invalid", &path, format!("buffers {} must be greater than 0", js(b)));
        }
        if let Some(b) = device.num_buffers
            && is_miri
            && b <= 0.0
        {
            issues.error("device-num-buffers-invalid", &path, format!("num_buffers {} must be greater than 0", js(b)));
        }
        if let Some(r) = device.reserve_channels
            && r < 0.0
        {
            issues.error(
                "device-reserve-channels-negative",
                &path,
                format!("reserve_channels {} must not be negative", js(r)),
            );
        }
        if let Some(r) = device.reserve_channels
            && is_scan_device(device)
            && r != 0.0
        {
            issues.error(
                "device-reserve-channels-scan-unsupported",
                &path,
                "reserve_channels is not supported in scan mode",
            );
        }
        if let Some(bw) = device.bandwidth
            && is_rtl
            && bw < 0.0
        {
            issues.error(
                "device-bandwidth-negative",
                &path,
                format!("bandwidth {} must not be negative (0 = automatic)", js(bw)),
            );
        }
    }
}

/// RTLSDR-Airband needs at least one active device, each active device an
/// active channel, each active channel an active output, and each active
/// mixer an active output.
pub fn disable_cascade(config: &RtlAirbandConfig, issues: &mut Issues) {
    let mut active_devices = 0;
    for (di, device) in config.devices.iter().enumerate() {
        if device.disable == Some(true) {
            continue;
        }
        active_devices += 1;
        let device_path = format!("$.devices[{di}]");
        let mut active_channels = 0;
        for (ci, channel) in device.channels.iter().enumerate() {
            if channel.disable() == Some(true) {
                continue;
            }
            active_channels += 1;
            if channel.outputs().iter().all(|o| o.disable() == Some(true)) {
                issues.error(
                    "no-active-outputs",
                    format!("{device_path}.channels[{ci}]"),
                    "every output on this channel is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled output per channel",
                );
            }
        }
        if active_channels == 0 {
            issues.error(
                "no-active-channels",
                &device_path,
                "every channel on this device is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled channel per device",
            );
        }
    }
    if active_devices == 0 {
        issues.error(
            "no-active-devices",
            "$",
            "every device is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled device",
        );
    }
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        if mixer.disable == Some(true) {
            continue;
        }
        if mixer.outputs.iter().all(|o| o.disable() == Some(true)) {
            issues.error(
                "no-active-mixer-outputs",
                format!("$.mixers[{mi}]"),
                "every output on this mixer is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled output per mixer",
            );
        }
    }
}
