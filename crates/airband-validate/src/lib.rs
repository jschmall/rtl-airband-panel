//! Semantic validation for RTLSDR-Airband instance configs. Rust port of
//! v0.4.110's backend/validate: same checks, codes, paths, messages, and issue order,
//! plus checks for RTLSDR-Airband v5.5/v6.3 settings and for settings the
//! panel keeps without modeling (see `checks::fork_v6`).

mod checks;
pub mod constants;
mod types;
mod view;

use airband_config::RtlAirbandConfig;

pub use constants::*;
pub use types::{Severity, ValidationIssue, ValidationResult};

use checks::{channels, devices, fork_features, fork_v6, globals, mixers, outputs, whole_numbers};
use types::Issues;

type Check = fn(&RtlAirbandConfig, &mut Issues);

/// Every check, in the order v0.4.110's backend/validate's validateConfig runs them,
/// followed by the checks with no TS counterpart.
const CHECKS: &[Check] = &[
    devices::frequency_window,
    devices::bin_collisions,
    channels::ctcss_tones,
    devices::scan_mode,
    outputs::send_tx_tags,
    devices::device_requirements,
    mixers::mixer_references,
    mixers::mixer_unused,
    devices::disable_cascade,
    outputs::rdio_scanner,
    globals::fft_size,
    globals::shout_metadata_delay,
    channels::filter_cutoffs,
    channels::modulation,
    channels::ampfactor,
    channels::squelch_threshold,
    channels::squelch_snr_threshold,
    channels::squelch_mutual_exclusion,
    channels::notch_q,
    outputs::file_output_flags,
    outputs::udp_stream_sample_rate,
    mixers::mixer_nested_outputs,
    mixers::mixer_output_balance,
    mixers::mixer_reserve_inputs,
    outputs::post_write_script,
    globals::stats_http,
    globals::control_socket_path,
    channels::enabled_disable_redundant,
    outputs::mixer_remote_output_stream_id,
    mixers::mixer_remote_inputs,
    // No TS counterpart:
    fork_v6::stats_update_interval,
    fork_v6::split_file_settings,
    fork_v6::unknown_settings,
    whole_numbers::whole_numbers,
];

pub fn validate_config(config: &RtlAirbandConfig) -> ValidationResult {
    validate_config_for(config, None)
}

/// Like `validate_config`, and when `features` is given (the instance's
/// rtl_airband is known; see airband_supervisor's binary classification),
/// also flags settings that build doesn't support: errors for ones it won't
/// start with, warnings for ones it ignores. None checks nothing extra.
pub fn validate_config_for(config: &RtlAirbandConfig, features: Option<&[String]>) -> ValidationResult {
    let mut issues = Issues::default();
    for check in CHECKS {
        check(config, &mut issues);
    }
    if let Some(features) = features {
        fork_features::check(config, features, &mut issues);
    }
    let (errors, warnings) = issues.0.into_iter().partition(|i| i.severity == Severity::Error);
    ValidationResult { errors, warnings }
}
