/**
 * JSON domain model for an RTLSDR-Airband instance config.
 * Field names mirror the .conf keys (snake_case) rather than being
 * translated to camelCase, so the JSON stays directly cross-referenceable
 * against RTLSDR-Airband's own docs and the source .conf file.
 *
 * `centerfreq`, `sample_rate`, `freq`/`freqs`, and `bandwidth` are
 * canonicalized to integer Hz, matching RTLSDR-Airband's own internal
 * representation (device_t/channel_t post-parse) rather than mirroring the
 * source file's int-vs-float typing, which upstream's parse_anynum2int()
 * treats as significant (float = MHz * 1e6, int = literal Hz).
 *
 * A channel is a MultichannelChannel (single `freq`) or a ScanChannel
 * (a `freqs` list). Which shape is allowed is determined by the owning
 * Device's `mode`: "multichannel" (default) devices hold any number of
 * MultichannelChannel entries; "scan" devices hold exactly one
 * ScanChannel. Several ScanChannel fields (ampfactor, ctcss, notch,
 * notch_q, bandwidth, squelch_threshold, squelch_snr_threshold) accept
 * either a single value (applied to every scanned frequency) or a list
 * with one entry per frequency in `freqs`, per upstream's own config
 * grammar — the key name doesn't change between the two forms.
 */

export interface RtlAirbandConfig {
  multiple_demod_threads: boolean;
  multiple_output_threads: boolean;
  stats_filepath: string;
  localtime: boolean;
  /** Power of two in [256, 8192]; RTLSDR-Airband defaults to 512 when absent. */
  fft_size?: number;
  /** RTLSDR-Airband defaults to "/run/rtl_airband.pid" when absent. */
  pidfile?: string;
  /** RTLSDR-Airband defaults to false when absent. */
  log_scan_activity?: boolean;
  /** Seconds, valid range 0-32 inclusive; RTLSDR-Airband defaults to 3 when absent. */
  shout_metadata_delay?: number;
  /** Microseconds; global NFM deemphasis time constant. RTLSDR-Airband defaults to 200 when absent. */
  tau?: number;
  devices: Device[];
  mixers?: Mixer[];
}

export interface Device {
  /** e.g. "rtlsdr", "mirisdr", "soapysdr". */
  type: string;
  /** Either serial or index selects the dongle; RTLSDR-Airband defaults index to 0 if neither is set. */
  serial?: string;
  index?: number;
  /**
   * Numeric gain in dB, or a SoapySDR "component=value,..." string.
   * Omitted entirely enables AGC (SoapySDR only); rtlsdr/mirisdr require it.
   */
  gain?: number | string;
  /** Hz. Required in "multichannel" mode; meaningless (and omittable) in "scan" mode, since the dongle retunes to each scanned frequency in turn. */
  centerfreq?: number;
  /** Hz; RTLSDR-Airband defaults to 2,560,000 when absent. */
  sample_rate?: number;
  /** PPM (rtlsdr/mirisdr) or ppm-as-float (soapysdr) frequency correction; RTLSDR-Airband defaults to 0 when absent. */
  correction?: number;
  /** "multichannel" (default) or "scan". Scan-mode devices must have exactly one channel entry, and it must be a ScanChannel. */
  mode?: "multichannel" | "scan";
  /** RTLSDR-Airband defaults to false when absent. Ignores this device entirely, as if it weren't configured. */
  disable?: boolean;
  /** Per-device NFM deemphasis override in microseconds; falls back to the global tau when absent. */
  tau?: number;
  /** rtlsdr only. Number of USB transfer buffers; RTLSDR-Airband defaults to 10 when absent. */
  buffers?: number;
  /** mirisdr only. Number of USB transfer buffers; RTLSDR-Airband defaults to 10 when absent. */
  num_buffers?: number;
  /** soapysdr only, required. Comma-separated "variable=value" stanzas identifying the driver/device. */
  device_string?: string;
  /** soapysdr only. Physical channel index on the device; RTLSDR-Airband defaults to 0 when absent. */
  channel?: number;
  /** soapysdr only. Antenna port selector; RTLSDR-Airband defaults to the device's default port when absent. */
  antenna?: string;
  channels: Channel[];
}

export type Channel = MultichannelChannel | ScanChannel;

export interface MultichannelChannel {
  /** Hz */
  freq: number;
  /** Name/description used for logging, icecast metadata, etc. */
  label?: string;
  /** Hz; enables raw-IQ processing when present. Omitted = default demod filtering. */
  bandwidth?: number;
  ampfactor?: number;
  /** RTLSDR-Airband defaults to 0 when absent. */
  afc?: number;
  /** RTLSDR-Airband defaults to "am" when absent. */
  modulation?: string;
  ctcss?: number;
  notch?: number;
  /** Notch filter selectivity (Q factor); RTLSDR-Airband defaults to 10.0 when absent. */
  notch_q?: number;
  /** MP3 highpass filter cutoff, Hz; RTLSDR-Airband defaults to 100 when absent. 0 disables it. */
  highpass?: number;
  /** MP3 lowpass filter cutoff, Hz; RTLSDR-Airband defaults to 2500 when absent. 0 disables it. */
  lowpass?: number;
  /** Per-channel NFM deemphasis override in microseconds; falls back to device/global tau when absent. */
  tau?: number;
  /** dBFS, <= 0. Mutually exclusive in practice with squelch_snr_threshold. */
  squelch_threshold?: number;
  squelch_snr_threshold?: number;
  /** RTLSDR-Airband defaults to false when absent. Ignores this channel entirely, as if it weren't configured. */
  disable?: boolean;
  outputs: Output[];
}

/**
 * A scan-mode device's single channel entry: `freqs` replaces `freq`.
 * Most per-channel fields may be given once (applied to every scanned
 * frequency) or as a list the same length as `freqs` (one value per
 * frequency, in the same order).
 */
export interface ScanChannel {
  /** Hz; the frequencies to scan, in order. */
  freqs: number[];
  /** Descriptions, one per entry in freqs; used for logging/icecast metadata. */
  labels?: string[];
  /** Applies to every scanned frequency; RTLSDR-Airband defaults to "am" when absent. */
  modulation?: string;
  /** Per-frequency modulation, one entry per freqs; overrides `modulation` when present. */
  modulations?: string[];
  /** Hz; single value or one per freqs entry. */
  bandwidth?: number | number[];
  /** Single value or one per freqs entry. */
  ampfactor?: number | number[];
  /** RTLSDR-Airband defaults to 0 when absent. */
  afc?: number;
  /** Single value or one per freqs entry; 0.0 disables CTCSS for that frequency. */
  ctcss?: number | number[];
  /** Single value or one per freqs entry; 0.0 keeps the default (disabled) notch for that frequency. */
  notch?: number | number[];
  /** Single value or one per freqs entry; RTLSDR-Airband defaults to 10.0 when absent. */
  notch_q?: number | number[];
  /** MP3 highpass filter cutoff, Hz; RTLSDR-Airband defaults to 100 when absent. 0 disables it. */
  highpass?: number;
  /** MP3 lowpass filter cutoff, Hz; RTLSDR-Airband defaults to 2500 when absent. 0 disables it. */
  lowpass?: number;
  /** NFM deemphasis override in microseconds; falls back to device/global tau when absent. */
  tau?: number;
  /**
   * dBFS, <= 0, single value or one per freqs entry. In list form, a value
   * of 0 means auto squelch for that frequency. Mutually exclusive in
   * practice with squelch_snr_threshold.
   */
  squelch_threshold?: number | number[];
  /**
   * Single value or one per freqs entry. In list form, 0 keeps squelch
   * open continuously for that frequency, and -1.0 (the only negative
   * value allowed) skips configuration for that frequency (keeps the
   * default SNR threshold).
   */
  squelch_snr_threshold?: number | number[];
  /** RTLSDR-Airband defaults to false when absent. Ignores this channel entirely, as if it weren't configured. */
  disable?: boolean;
  outputs: Output[];
}

/** Top-level named mixer that channel outputs of type "mixer" route audio into by name. */
export interface Mixer {
  name: string;
  /** RTLSDR-Airband defaults to false when absent. Ignores this mixer entirely, as if it weren't configured. */
  disable?: boolean;
  /** MP3 highpass filter cutoff, Hz, applied to the mixed output. 0 disables it. */
  highpass?: number;
  /** MP3 lowpass filter cutoff, Hz, applied to the mixed output. 0 disables it. */
  lowpass?: number;
  /** A mixer's own outputs cannot themselves be of type "mixer". */
  outputs: Exclude<Output, MixerOutput>[];
}

export type Output = PulseOutput | FileOutput | RawFileOutput | IcecastOutput | UdpStreamOutput | MixerOutput;

export interface PulseOutput {
  type: "pulse";
  /** Optional; PulseAudio connects to its default server when absent. */
  server?: string;
  /** Optional; PulseAudio uses its default sink when absent. */
  sink?: string;
  /** Optional; RTLSDR-Airband defaults to "rtl_airband" when absent. */
  name?: string;
  /** Optional; RTLSDR-Airband auto-generates one from the channel frequency when absent. */
  stream_name?: string;
  /** RTLSDR-Airband defaults to false when absent. */
  continuous?: boolean;
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}

export interface FileOutput {
  type: "file";
  directory: string;
  filename_template: string;
  /** RTLSDR-Airband defaults to false when absent. */
  continuous?: boolean;
  /** RTLSDR-Airband defaults to false when absent. */
  split_on_transmission?: boolean;
  /** Only meaningful when split_on_transmission is true; defaults to 0 when absent. */
  min_rx_seconds?: number;
  /** RTLSDR-Airband defaults to false when absent. */
  include_freq?: boolean;
  /** RTLSDR-Airband defaults to true when absent. */
  append?: boolean;
  /** RTLSDR-Airband defaults to false when absent. */
  dated_subdirectories?: boolean;
  post_write_script?: string;
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}

/** Like FileOutput but writes raw IQ (.cf32) instead of MP3, and has no min_rx_seconds/post_write_script. */
export interface RawFileOutput {
  type: "rawfile";
  directory: string;
  filename_template: string;
  /** RTLSDR-Airband defaults to false when absent. */
  continuous?: boolean;
  /** RTLSDR-Airband defaults to false when absent. */
  split_on_transmission?: boolean;
  /** RTLSDR-Airband defaults to false when absent. */
  include_freq?: boolean;
  /** RTLSDR-Airband defaults to true when absent. */
  append?: boolean;
  /** RTLSDR-Airband defaults to false when absent. */
  dated_subdirectories?: boolean;
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}

export interface IcecastOutput {
  type: "icecast";
  server: string;
  port: number;
  mountpoint: string;
  username: string;
  password: string;
  name?: string;
  genre?: string;
  description?: string;
  /** RTLSDR-Airband defaults to false when absent. Has no effect outside scan mode. */
  send_scan_freq_tags?: boolean;
  /** Only meaningful when built with libshout TLS support. */
  tls?: "auto" | "auto_no_plain" | "transport" | "upgrade" | "disabled";
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}

export interface UdpStreamOutput {
  type: "udp_stream";
  dest_address: string;
  /** A port number or a named service, e.g. "5005" or "http" — kept as a string either way. */
  dest_port: string;
  /** RTLSDR-Airband defaults to false when absent. */
  continuous?: boolean;
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}

/** Routes this channel's audio into a top-level mixer, referenced by name. */
export interface MixerOutput {
  type: "mixer";
  name: string;
  /** RTLSDR-Airband defaults to 1.0 when absent. */
  ampfactor?: number;
  /** Valid range -1.0 to 1.0; RTLSDR-Airband defaults to 0.0 when absent. */
  balance?: number;
  /** RTLSDR-Airband defaults to false when absent. Ignores this output entirely, as if it weren't configured. */
  disable?: boolean;
}
