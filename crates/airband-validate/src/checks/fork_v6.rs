//! Checks with no TS counterpart: RTLSDR-Airband v5.5/v6.3 settings
//! (stats_update_interval, split_* file settings), fork v6.6.0+ auto_ppm,
//! and settings the panel keeps verbatim without modeling them. They run after every ported check
//! so issue order for configs without these settings matches the TS
//! implementation.

use airband_config::ast::Setting;
use airband_config::domain::{Channel, Output, RtlAirbandConfig};

use crate::constants::{
    AUTO_PPM_INTERVAL_RANGE, AUTO_PPM_MAX_PPM_RANGE, AUTO_PPM_MAX_STEP_RANGE, DEFAULT_AUTO_PPM_MAX_PPM,
    DEFAULT_SPLIT_MAX_FILE_TIME, DEFAULT_SPLIT_MAX_IDLE_TIME, DEFAULT_SPLIT_MIN_FILE_TIME,
    DEFAULT_SPLIT_TX_DROP_SHORTER_THAN,
};
use crate::types::Issues;
use crate::view::{Owner, for_each_output_list, js};

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

/// Same text the fork prints (helper_functions.cpp, split_tx_drop_shorter_than_constraint).
const SPLIT_TX_DROP_CONSTRAINT: &str =
    "invalid split_tx_drop_shorter_than (need 0 (disabled) <= split_tx_drop_shorter_than < split_max_file_time)";

fn valid_split_tx_drop(drop: f64, max: f64) -> bool {
    drop >= 0.0 && drop < max
}

struct SplitOverrides {
    min: Option<f64>,
    max: Option<f64>,
    idle: Option<f64>,
    include_start: Option<bool>,
    drop_shorter: Option<f64>,
    split_on_transmission: bool,
}

fn split_overrides(output: &Output) -> Option<SplitOverrides> {
    match output {
        Output::File(o) => Some(SplitOverrides {
            min: o.split_min_file_time,
            max: o.split_max_file_time,
            idle: o.split_max_idle_time,
            include_start: o.split_include_transmission_start,
            drop_shorter: o.split_tx_drop_shorter_than,
            split_on_transmission: o.split_on_transmission == Some(true),
        }),
        Output::RawFile(o) => Some(SplitOverrides {
            min: o.split_min_file_time,
            max: o.split_max_file_time,
            idle: o.split_max_idle_time,
            include_start: o.split_include_transmission_start,
            drop_shorter: o.split_tx_drop_shorter_than,
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
/// - split_tx_drop_shorter_than must be in [0, split_max_file_time), checked
///   the same way (global, then each output's effective values when it
///   overrides either);
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
    let global_drop = config.split_tx_drop_shorter_than.unwrap_or(DEFAULT_SPLIT_TX_DROP_SHORTER_THAN);
    if config.split_tx_drop_shorter_than.is_some() && !valid_split_tx_drop(global_drop, global_max) {
        issues.error("split-tx-drop-invalid", "$", SPLIT_TX_DROP_CONSTRAINT);
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
                if s.drop_shorter.is_some() {
                    issues.error(
                        "mixer-output-split-settings-not-allowed",
                        &path,
                        "split_tx_drop_shorter_than is not allowed for mixers",
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
            if (s.drop_shorter.is_some() || s.max.is_some())
                && !valid_split_tx_drop(s.drop_shorter.unwrap_or(global_drop), s.max.unwrap_or(global_max))
            {
                issues.error("split-tx-drop-invalid", &path, SPLIT_TX_DROP_CONSTRAINT);
            }
            if !s.split_on_transmission {
                if has_times {
                    issues.warning(
                        "split-settings-ignored-without-split-on-transmission",
                        &path,
                        "split_*_time settings are ignored without split_on_transmission",
                    );
                }
                if s.drop_shorter.is_some() {
                    issues.warning(
                        "split-settings-ignored-without-split-on-transmission",
                        &path,
                        "split_tx_drop_shorter_than is ignored without split_on_transmission",
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

/// Mirrors the fork's startup checks for auto_ppm (config.cpp,
/// auto_ppm_parse_params). The parameters are only read when the
/// `auto_ppm` key is there (true or false), so without it they do nothing.
/// Non-integer parameters are `whole_numbers`' job.
pub fn auto_ppm(config: &RtlAirbandConfig, issues: &mut Issues) {
    for (di, d) in config.devices.iter().enumerate() {
        let path = format!("$.devices[{di}]");
        let params = [
            ("auto_ppm_interval", d.auto_ppm_interval, AUTO_PPM_INTERVAL_RANGE),
            ("auto_ppm_max_ppm", d.auto_ppm_max_ppm, AUTO_PPM_MAX_PPM_RANGE),
            ("auto_ppm_max_step", d.auto_ppm_max_step, AUTO_PPM_MAX_STEP_RANGE),
        ];
        if d.auto_ppm.is_none() {
            for (name, value, _) in params {
                if value.is_some() {
                    issues.warning(
                        "auto-ppm-settings-ignored",
                        format!("{path}.{name}"),
                        format!("{name} is ignored without auto_ppm"),
                    );
                }
            }
            continue;
        }
        if d.device_type != "rtlsdr" {
            issues.error(
                "auto-ppm-driver-unsupported",
                format!("{path}.auto_ppm"),
                format!("auto_ppm is not supported by the {} driver (only rtlsdr devices have it)", d.device_type),
            );
        }
        for (name, value, (lo, hi)) in params {
            if let Some(v) = value
                && !(lo..=hi).contains(&v)
            {
                issues.error(
                    "auto-ppm-param-out-of-range",
                    format!("{path}.{name}"),
                    format!("{name} must be between {} and {}", js(lo), js(hi)),
                );
            }
        }
        let max_ppm = d.auto_ppm_max_ppm.unwrap_or(DEFAULT_AUTO_PPM_MAX_PPM);
        // The fork rounds the driver's correction and compares it to max_ppm.
        let correction = d.correction.unwrap_or(0.0).round();
        if AUTO_PPM_MAX_PPM_RANGE.0 <= max_ppm && correction.abs() > max_ppm {
            issues.error(
                "auto-ppm-correction-outside-limit",
                format!("{path}.correction"),
                format!("correction {} is outside auto_ppm_max_ppm (+/-{})", js(correction), js(max_ppm)),
            );
        }
    }
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
