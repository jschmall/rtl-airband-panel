/** RTLSDR-Airband's own default (input-rtlsdr.h, RTLSDR_DEFAULT_SAMPLE_RATE) when a device's sample_rate is omitted. */
export const DEFAULT_SAMPLE_RATE_HZ = 2_560_000;

/**
 * RTLSDR-Airband's own floor (rtl_airband.cpp, WAVE_RATE): sample_rate must be
 * strictly greater than this or config parsing calls error() (_Exit(1)).
 * WAVE_RATE is 16000 in the default NFM-enabled build, 8000 otherwise -- 16000
 * is used here since that's what ships by default.
 */
export const MIN_SAMPLE_RATE_HZ = 16_000;

/**
 * librtlsdr's own documented valid-rate ranges (rtl-sdr.h's
 * rtlsdr_set_sample_rate doc comment): 225001-300000 Hz or 900001-3200000 Hz.
 * Values strictly between those two ranges are rejected by the driver at
 * runtime -- this is that dead zone. Unlike MIN_SAMPLE_RATE_HZ above (a
 * RTLSDR-Airband-imposed floor, same for every device type), this is a
 * hardware/driver constraint specific to rtlsdr devices only -- mirisdr and
 * soapysdr have no equivalent documented range.
 */
export const RTLSDR_SAMPLE_RATE_DEAD_ZONE = { min: 300_001, max: 900_000 };

/**
 * Curated common rtlsdr sample rates for the panel's sample-rate dropdown --
 * all inside librtlsdr's valid ranges above. Not exhaustive; the dropdown
 * also offers a free-text "Custom" option for any other in-range value.
 */
export const RTLSDR_COMMON_SAMPLE_RATES_HZ = [
  250_000, 1_024_000, 1_200_000, 1_400_000, 1_800_000, 1_920_000, 2_000_000, 2_048_000, 2_160_000, 2_400_000, 2_560_000, 2_800_000,
  3_200_000,
];
