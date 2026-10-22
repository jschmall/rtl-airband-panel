//! Channel-level checks: CTCSS, filters, modulation, value ranges.

use airband_config::domain::{Channel, RtlAirbandConfig};

use crate::constants::STANDARD_CTCSS_TONES;
use crate::types::Issues;
use crate::view::{ChannelView, Vals, js};

fn for_each_channel(config: &RtlAirbandConfig, mut f: impl FnMut(String, &Channel)) {
    for (di, device) in config.devices.iter().enumerate() {
        for (ci, channel) in device.channels.iter().enumerate() {
            f(format!("$.devices[{di}].channels[{ci}]"), channel);
        }
    }
}

/// Flag a ctcss value this close to (but not exactly on) a standard tone as a likely typo.
const NEAR_MISS_EPSILON_HZ: f64 = 2.0;

pub fn ctcss_tones(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_channel(config, |path, channel| match channel.ctcss() {
        None => {}
        // 0.0 is the per-frequency "CTCSS disabled" sentinel in list form.
        Some(Vals::Many(values)) => {
            for (vi, v) in values.iter().enumerate() {
                ctcss_value(issues, *v, format!("{path}.ctcss[{vi}]"), *v != 0.0);
            }
        }
        Some(Vals::One(v)) => ctcss_value(issues, v, format!("{path}.ctcss"), true),
    });
}

fn ctcss_value(issues: &mut Issues, value: f64, path: String, warn_on_non_positive: bool) {
    if value <= 0.0 {
        if warn_on_non_positive {
            issues.warning(
                "ctcss-non-positive",
                path,
                format!(
                    "ctcss value {} Hz is not positive; RTLSDR-Airband ignores it and CTCSS squelch is disabled",
                    js(value)
                ),
            );
        }
        return;
    }
    let mut nearest = STANDARD_CTCSS_TONES[0];
    for tone in STANDARD_CTCSS_TONES {
        if (tone - value).abs() < (nearest - value).abs() {
            nearest = tone;
        }
    }
    let distance = (nearest - value).abs();
    if distance > 0.0 && distance <= NEAR_MISS_EPSILON_HZ {
        issues.warning(
            "ctcss-near-standard-tone",
            path,
            format!(
                "ctcss value {} Hz is close to but not exactly the standard tone {} Hz — likely a typo",
                js(value),
                js(nearest)
            ),
        );
    }
}

/// lowpass must be >= highpass when both are set (channels and mixers).
pub fn filter_cutoffs(config: &RtlAirbandConfig, issues: &mut Issues) {
    let mut check = |path: String, lowpass: Option<f64>, highpass: Option<f64>| {
        if let (Some(lp), Some(hp)) = (lowpass, highpass)
            && lp < hp
        {
            issues.error(
                "lowpass-below-highpass",
                path,
                format!("lowpass ({}) must be greater than or equal to highpass ({})", js(lp), js(hp)),
            );
        }
    };
    for (di, device) in config.devices.iter().enumerate() {
        for (ci, channel) in device.channels.iter().enumerate() {
            check(format!("$.devices[{di}].channels[{ci}]"), channel.lowpass(), channel.highpass());
        }
    }
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        check(format!("$.mixers[{mi}]"), mixer.lowpass, mixer.highpass);
    }
}

/// RTLSDR-Airband matches modulation by prefix ("nfm"/"am"); anything else
/// is a fatal "unknown modulation".
fn is_recognized_modulation(value: &str) -> bool {
    value.starts_with("nfm") || value.starts_with("am")
}

pub fn modulation(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_channel(config, |path, channel| {
        if let Some(m) = channel.modulation()
            && !is_recognized_modulation(m)
        {
            issues.error(
                "modulation-unrecognized",
                format!("{path}.modulation"),
                format!("unknown modulation '{m}' (must start with \"nfm\" or \"am\")"),
            );
        }
        if let Channel::Scan(c) = channel {
            for (mi, m) in c.modulations.iter().flatten().enumerate() {
                if !is_recognized_modulation(m) {
                    issues.error(
                        "modulation-unrecognized",
                        format!("{path}.modulations[{mi}]"),
                        format!("unknown modulation '{m}' (must start with \"nfm\" or \"am\")"),
                    );
                }
            }
        }
    });
}

/// Reports one error per invalid entry of a scalar-or-list channel field.
fn scalar_or_list(
    config: &RtlAirbandConfig,
    issues: &mut Issues,
    field: &str,
    code: &str,
    get: impl Fn(&Channel) -> Option<Vals<'_>>,
    is_invalid: impl Fn(f64) -> bool,
    message: impl Fn(f64) -> String,
) {
    for_each_channel(config, |path, channel| match get(channel) {
        None => {}
        Some(Vals::Many(values)) => {
            for (vi, v) in values.iter().enumerate() {
                if is_invalid(*v) {
                    issues.error(code, format!("{path}.{field}[{vi}]"), message(*v));
                }
            }
        }
        Some(Vals::One(v)) if is_invalid(v) => issues.error(code, format!("{path}.{field}"), message(v)),
        Some(Vals::One(_)) => {}
    });
}

pub fn ampfactor(config: &RtlAirbandConfig, issues: &mut Issues) {
    scalar_or_list(
        config,
        issues,
        "ampfactor",
        "ampfactor-negative",
        |c| c.ampfactor(),
        |v| v < 0.0,
        |v| format!("ampfactor {} must not be negative", js(v)),
    );
}

pub fn squelch_threshold(config: &RtlAirbandConfig, issues: &mut Issues) {
    scalar_or_list(
        config,
        issues,
        "squelch_threshold",
        "squelch-threshold-positive",
        |c| c.squelch_threshold(),
        |v| v > 0.0,
        |v| format!("squelch_threshold {} must be less than or equal to 0", js(v)),
    );
}

/// >= 0, with -1 as the documented "use the default" sentinel.
pub fn squelch_snr_threshold(config: &RtlAirbandConfig, issues: &mut Issues) {
    scalar_or_list(
        config,
        issues,
        "squelch_snr_threshold",
        "squelch-snr-threshold-invalid",
        |c| c.squelch_snr_threshold(),
        |v| v < 0.0 && v != -1.0,
        |v| {
            format!(
                "squelch_snr_threshold {} must be greater than or equal to 0 (or exactly -1 to use the default)",
                js(v)
            )
        },
    );
}

/// RTLSDR-Airband only warns when both are set; the panel fails closed.
pub fn squelch_mutual_exclusion(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_channel(config, |path, channel| {
        if channel.squelch_threshold().is_some() && channel.squelch_snr_threshold().is_some() {
            issues.error(
                "squelch-threshold-and-snr-threshold-both-set",
                path,
                "squelch_threshold and squelch_snr_threshold can't both be set on the same channel",
            );
        }
    });
}

pub fn notch_q(config: &RtlAirbandConfig, issues: &mut Issues) {
    scalar_or_list(
        config,
        issues,
        "notch_q",
        "notch-q-non-positive",
        |c| c.notch_q(),
        |v| v <= 0.0,
        |v| format!("notch_q {} must be greater than 0.0", js(v)),
    );
}

/// `enabled: false` is redundant next to `disable: true` (a warning, not an error).
pub fn enabled_disable_redundant(config: &RtlAirbandConfig, issues: &mut Issues) {
    for_each_channel(config, |path, channel| {
        if channel.disable() == Some(true) && channel.enabled() == Some(false) {
            issues.warning(
                "enabled-false-with-disable",
                path,
                "enabled: false has no effect here since disable: true already omits this channel from the config entirely",
            );
        }
    });
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        if mixer.disable == Some(true) && mixer.enabled == Some(false) {
            issues.warning(
                "enabled-false-with-disable",
                format!("$.mixers[{mi}]"),
                "enabled: false has no effect here since disable: true already omits this mixer from the config entirely",
            );
        }
    }
}
