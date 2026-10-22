//! Top-level setting checks.

use airband_config::domain::RtlAirbandConfig;

use crate::constants::{MAX_FFT_SIZE, MIN_FFT_SIZE};
use crate::types::Issues;
use crate::view::js;

fn is_power_of_two(n: f64) -> bool {
    airband_config::jsnum::is_integer(n) && n > 0.0 && (n as u64).is_power_of_two()
}

/// fft_size must be a power of two in [256, 8192].
pub fn fft_size(config: &RtlAirbandConfig, issues: &mut Issues) {
    let Some(n) = config.fft_size else { return };
    if !is_power_of_two(n) || n < MIN_FFT_SIZE || n > MAX_FFT_SIZE {
        issues.error(
            "fft-size-invalid",
            "$.fft_size",
            format!(
                "fft_size {} is invalid (must be a power of two in range {}-{})",
                js(n),
                js(MIN_FFT_SIZE),
                js(MAX_FFT_SIZE)
            ),
        );
    }
}

const MAX_SHOUT_METADATA_DELAY: f64 = 32.0;

/// shout_metadata_delay must be in [0, 32] (2 * TAG_QUEUE_LEN).
pub fn shout_metadata_delay(config: &RtlAirbandConfig, issues: &mut Issues) {
    let Some(d) = config.shout_metadata_delay else { return };
    if !(0.0..=MAX_SHOUT_METADATA_DELAY).contains(&d) {
        issues.error(
            "shout-metadata-delay-out-of-range",
            "$.shout_metadata_delay",
            format!("shout_metadata_delay {} is out of allowed range (0-{})", js(d), js(MAX_SHOUT_METADATA_DELAY)),
        );
    }
}

/// stats_http_address and stats_http_port go together; the port is 1-65535.
pub fn stats_http(config: &RtlAirbandConfig, issues: &mut Issues) {
    if config.stats_http_address.is_some() != config.stats_http_port.is_some() {
        issues.error(
            "stats-http-address-and-port-must-be-set-together",
            "$",
            "stats_http_address and stats_http_port must be set together",
        );
    }
    if let Some(port) = config.stats_http_port
        && (port <= 0.0 || port > 65535.0)
    {
        issues.error(
            "stats-http-port-out-of-range",
            "$.stats_http_port",
            "stats_http_port must be between 1 and 65535",
        );
    }
}

/// control_socket_path, if set, must not be blank.
pub fn control_socket_path(config: &RtlAirbandConfig, issues: &mut Issues) {
    if config.control_socket_path.as_deref().is_some_and(|p| p.trim().is_empty()) {
        issues.error(
            "control-socket-path-empty",
            "$.control_socket_path",
            "control_socket_path, if set, must not be empty",
        );
    }
}
