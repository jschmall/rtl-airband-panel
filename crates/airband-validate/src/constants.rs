//! RTLSDR-Airband / librtlsdr constants the checks mirror. Port of
//! backend/validate's fft.ts, rtlsdr-defaults.ts and ctcss-tones.ts.

/// RTLSDR-Airband's built-in default when no top-level `fft_size` is configured.
pub const DEFAULT_FFT_SIZE: f64 = 512.0;
/// fft_size must be a power of two in [256, 8192] (MIN/MAX_FFT_SIZE_LOG = 8/13).
pub const MIN_FFT_SIZE: f64 = 256.0;
pub const MAX_FFT_SIZE: f64 = 8192.0;

/// Default device sample_rate when omitted (RTLSDR_DEFAULT_SAMPLE_RATE).
pub const DEFAULT_SAMPLE_RATE_HZ: f64 = 2_560_000.0;
/// sample_rate must be strictly greater than WAVE_RATE (16000 in the default NFM build).
pub const MIN_SAMPLE_RATE_HZ: f64 = 16_000.0;
/// librtlsdr rejects rates strictly between 300000 and 900001 Hz.
pub const RTLSDR_SAMPLE_RATE_DEAD_ZONE: (f64, f64) = (300_001.0, 900_000.0);
/// Curated common rtlsdr sample rates for the panel's dropdown.
pub const RTLSDR_COMMON_SAMPLE_RATES_HZ: [f64; 13] = [
    250_000.0,
    1_024_000.0,
    1_200_000.0,
    1_400_000.0,
    1_800_000.0,
    1_920_000.0,
    2_000_000.0,
    2_048_000.0,
    2_160_000.0,
    2_400_000.0,
    2_560_000.0,
    2_800_000.0,
    3_200_000.0,
];

/// RTLSDR-Airband's soft usable-bandwidth threshold (warn_if_freq_not_in_range).
pub const SOFT_BW_THRESHOLD: f64 = 0.9;

/// Defaults for the split-file settings (RTLSDR-Airband v5.5).
pub const DEFAULT_SPLIT_MIN_FILE_TIME: f64 = 1.0;
pub const DEFAULT_SPLIT_MAX_FILE_TIME: f64 = 3600.0;
pub const DEFAULT_SPLIT_MAX_IDLE_TIME: f64 = 0.5;

/// The 51 standard CTCSS tones RTLSDR-Airband's detector watches for
/// (ctcss.cpp, CTCSS::standard_tones). Used only to flag near-miss typos.
pub const STANDARD_CTCSS_TONES: [f64; 51] = [
    67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8,
    123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 150.0, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3,
    179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3,
    254.1,
];

/// FFT bin a channel's carrier lands on, replicating RTLSDR-Airband's own
/// formula (config.cpp, parse_channels()):
///
///   bin = ceil((freq + sample_rate - centerfreq) / (sample_rate / fft_size) - 1) % fft_size
///
/// `correction` is deliberately not factored in: it is applied at the
/// tuner/driver level and doesn't shift this software-side bin math.
pub fn compute_bin(freq_hz: f64, centerfreq_hz: f64, sample_rate_hz: f64, fft_size: f64) -> f64 {
    let bin_width_hz = sample_rate_hz / fft_size;
    let raw = ((freq_hz + sample_rate_hz - centerfreq_hz) / bin_width_hz - 1.0).ceil();
    ((raw % fft_size) + fft_size) % fft_size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_formula_wraps_into_range() {
        // The `+ sample_rate` offset puts a carrier exactly at centerfreq in the last bin.
        assert_eq!(compute_bin(100_000_000.0, 100_000_000.0, 2_560_000.0, 512.0), 511.0);
        // One bin width (5 kHz) above centerfreq wraps to bin 0.
        assert_eq!(compute_bin(100_005_000.0, 100_000_000.0, 2_560_000.0, 512.0), 0.0);
        let below = compute_bin(99_000_000.0, 100_000_000.0, 2_560_000.0, 512.0);
        assert!((0.0..512.0).contains(&below));
    }
}
