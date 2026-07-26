/** RTLSDR-Airband's own default (input-rtlsdr.h, RTLSDR_DEFAULT_SAMPLE_RATE) when a device's sample_rate is omitted. */
export const DEFAULT_SAMPLE_RATE_HZ = 2_560_000;

/**
 * RTLSDR-Airband's own floor (rtl_airband.cpp, WAVE_RATE): sample_rate must be
 * strictly greater than this or config parsing calls error() (_Exit(1)).
 * WAVE_RATE is 16000 in the default NFM-enabled build, 8000 otherwise -- 16000
 * is used here since that's what ships by default.
 */
export const MIN_SAMPLE_RATE_HZ = 16_000;
