//! Checks with no TS counterpart: RTLSDR-Airband v5.5/v6.3 settings
//! (stats_update_interval, split_* file settings) and settings the panel
//! keeps verbatim without modeling them. They run after every ported check
//! so issue order for configs without these settings matches the TS
//! implementation.

use airband_config::ast::Setting;
use airband_config::domain::{Channel, Output, RtlAirbandConfig};

use crate::constants::{DEFAULT_SPLIT_MAX_FILE_TIME, DEFAULT_SPLIT_MAX_IDLE_TIME, DEFAULT_SPLIT_MIN_FILE_TIME};
use crate::types::Issues;
use crate::view::{Owner, for_each_output_list};

/// stats_update_interval must be > 0 (valid_stats_update_interval).
pub fn stats_update_interval(config: &RtlAirbandConfig, issues: &mut Issues) {
    if let Some(i) = config.stats_update_interval
        && i <= 0.0
    {
        issues.error(
            "stats-update-interval-non-positive",
            "$.stats_update_interval",
            "stats_update_interval must be greater than 0",
        );
    }
}

/// Same text RTLSDR-Airband prints (helper_functions.cpp, split_file_times_constraint).
const SPLIT_FILE_TIMES_CONSTRAINT: &str = "invalid split file time settings (need split_min_file_time >= 1.0, split_max_file_time > split_min_file_time, split_max_idle_time > 0)";

fn valid_split_file_times(min: f64, max: f64, idle: f64) -> bool {
    min >= 1.0 && max > min && idle > 0.0
}

struct SplitOverrides {
    min: Option<f64>,
    max: Option<f64>,
    idle: Option<f64>,
    include_start: Option<bool>,
    split_on_transmission: bool,
}

fn split_overrides(output: &Output) -> Option<SplitOverrides> {
    match output {
        Output::File(o) => Some(SplitOverrides {
            min: o.split_min_file_time,
            max: o.split_max_file_time,
            idle: o.split_max_idle_time,
            include_start: o.split_include_transmission_start,
            split_on_transmission: o.split_on_transmission == Some(true),
        }),
        Output::RawFile(o) => Some(SplitOverrides {
            min: o.split_min_file_time,
            max: o.split_max_file_time,
            idle: o.split_max_idle_time,
            include_start: o.split_include_transmission_start,
            split_on_transmission: o.split_on_transmission == Some(true),
        }),
        _ => None,
    }
}

/// Mirrors the fork's parse_split_file_times() and its global counterpart:
/// - global split_* times must satisfy the constraint (fatal);
/// - a file/rawfile output's effective times (its own, else global, else
///   default) must satisfy it (fatal) -- only reported when the output
///   overrides one, so an invalid global isn't reported once per output;
/// - split_* settings on a mixer's output are fatal;
/// - split_* settings without split_on_transmission are ignored (warning).
pub fn split_file_settings(config: &RtlAirbandConfig, issues: &mut Issues) {
    let global_min = config.split_min_file_time.unwrap_or(DEFAULT_SPLIT_MIN_FILE_TIME);
    let global_max = config.split_max_file_time.unwrap_or(DEFAULT_SPLIT_MAX_FILE_TIME);
    let global_idle = config.split_max_idle_time.unwrap_or(DEFAULT_SPLIT_MAX_IDLE_TIME);
    let any_global = config.split_min_file_time.is_some()
        || config.split_max_file_time.is_some()
        || config.split_max_idle_time.is_some();
    if any_global && !valid_split_file_times(global_min, global_max, global_idle) {
        issues.error("split-file-times-invalid", "$", SPLIT_FILE_TIMES_CONSTRAINT);
    }

    for_each_output_list(config, |prefix, outputs, owner| {
        for (oi, output) in outputs.iter().enumerate() {
            let Some(s) = split_overrides(output) else { continue };
            let path = format!("{prefix}.outputs[{oi}]");
            let has_times = s.min.is_some() || s.max.is_some() || s.idle.is_some();

            if matches!(owner, Owner::Mixer) {
                if has_times {
                    issues.error(
                        "mixer-output-split-settings-not-allowed",
                        &path,
                        "split_*_time settings are not allowed for mixers",
                    );
                }
                if s.include_start.is_some() {
                    issues.error(
                        "mixer-output-split-settings-not-allowed",
                        &path,
                        "split_include_transmission_start is not allowed for mixers",
                    );
                }
                continue;
            }

            if has_times
                && !valid_split_file_times(
                    s.min.unwrap_or(global_min),
                    s.max.unwrap_or(global_max),
                    s.idle.unwrap_or(global_idle),
                )
            {
                issues.error("split-file-times-invalid", &path, SPLIT_FILE_TIMES_CONSTRAINT);
            }
            if !s.split_on_transmission {
                if has_times {
                    issues.warning(
                        "split-settings-ignored-without-split-on-transmission",
                        &path,
                        "split_*_time settings are ignored without split_on_transmission",
                    );
                }
                if s.include_start.is_some() {
                    issues.warning(
                        "split-settings-ignored-without-split-on-transmission",
                        &path,
                        "split_include_transmission_start is ignored without split_on_transmission",
                    );
                }
            }
        }
    });
}

/// Settings the panel doesn't model are kept as written; say so, and call
/// out `squelch`, which RTLSDR-Airband itself ignores with a warning.
pub fn unknown_settings(config: &RtlAirbandConfig, issues: &mut Issues) {
    let mut report = |path: &str, settings: &[Setting], is_channel: bool| {
        for s in settings {
            let setting_path = format!("{path}.{}", s.name);
            if is_channel && s.name == "squelch" {
                issues.warning(
                    "squelch-deprecated",
                    setting_path,
                    "'squelch' no longer supported and will be ignored, use 'squelch_threshold' or 'squelch_snr_threshold' instead",
                );
            } else {
                issues.warning(
                    "unknown-setting-preserved",
                    setting_path,
                    format!(
                        "setting '{}' is not recognized by the panel; it is kept exactly as written but can't be edited here",
                        s.name
                    ),
                );
            }
        }
    };

    report("$", &config.unknown_settings, false);
    for (di, device) in config.devices.iter().enumerate() {
        let device_path = format!("$.devices[{di}]");
        report(&device_path, &device.unknown_settings, false);
        for (ci, channel) in device.channels.iter().enumerate() {
            let channel_path = format!("{device_path}.channels[{ci}]");
            let unknown = match channel {
                Channel::Multichannel(c) => &c.unknown_settings,
                Channel::Scan(c) => &c.unknown_settings,
            };
            report(&channel_path, unknown, true);
            report_outputs(&mut report, &channel_path, channel.outputs());
        }
    }
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        let mixer_path = format!("$.mixers[{mi}]");
        report(&mixer_path, &mixer.unknown_settings, false);
        for (ri, input) in mixer.remote_inputs.iter().flatten().enumerate() {
            report(&format!("{mixer_path}.remote_inputs[{ri}]"), &input.unknown_settings, false);
        }
        report_outputs(&mut report, &mixer_path, &mixer.outputs);
    }
}

fn report_outputs(report: &mut impl FnMut(&str, &[Setting], bool), prefix: &str, outputs: &[Output]) {
    for (oi, output) in outputs.iter().enumerate() {
        let path = format!("{prefix}.outputs[{oi}]");
        let unknown = match output {
            Output::Pulse(o) => &o.unknown_settings,
            Output::File(o) => {
                if let Some(rdio) = &o.rdio_scanner {
                    report(&format!("{path}.rdio_scanner"), &rdio.unknown_settings, false);
                }
                &o.unknown_settings
            }
            Output::RawFile(o) => &o.unknown_settings,
            Output::Icecast(o) => &o.unknown_settings,
            Output::UdpStream(o) => &o.unknown_settings,
            Output::Mixer(o) => &o.unknown_settings,
            Output::MixerRemote(o) => &o.unknown_settings,
        };
        report(&path, unknown, false);
    }
}
