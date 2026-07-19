/**
 * JSON domain model for an RTLSDR-Airband instance config.
 * Field names mirror the .conf keys (snake_case) rather than being
 * translated to camelCase, so the JSON stays directly cross-referenceable
 * against RTLSDR-Airband's own docs and the source .conf file.
 *
 * `centerfreq`, `sample_rate`, `freq`, and `bandwidth` are canonicalized to
 * integer Hz, matching RTLSDR-Airband's own internal representation
 * (device_t/channel_t post-parse) rather than mirroring the source file's
 * int-vs-float typing, which upstream's parse_anynum2int() treats as
 * significant (float = MHz * 1e6, int = literal Hz).
 */

export interface RtlAirbandConfig {
  multiple_demod_threads: boolean;
  multiple_output_threads: boolean;
  stats_filepath: string;
  localtime: boolean;
  /** Power of two in [256, 8192]; RTLSDR-Airband defaults to 512 when absent. */
  fft_size?: number;
  devices: Device[];
}

export interface Device {
  type: string;
  /** Either serial or index selects the dongle; RTLSDR-Airband defaults index to 0 if neither is set. */
  serial?: string;
  index?: number;
  gain: number;
  /** Hz */
  centerfreq: number;
  /** Hz; RTLSDR-Airband defaults to 2,560,000 when absent. */
  sample_rate?: number;
  /** PPM frequency correction; RTLSDR-Airband defaults to 0 when absent. */
  correction?: number;
  channels: Channel[];
}

export interface Channel {
  /** Hz */
  freq: number;
  /** Hz; enables raw-IQ processing when present. Omitted = default demod filtering. */
  bandwidth?: number;
  ampfactor?: number;
  /** RTLSDR-Airband defaults to 0 when absent. */
  afc?: number;
  /** RTLSDR-Airband defaults to "am" when absent. */
  modulation?: string;
  ctcss?: number;
  notch?: number;
  squelch_snr_threshold?: number;
  outputs: Output[];
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
  /** RTLSDR-Airband defaults to false when absent. */
  send_scan_freq_tags?: boolean;
  /** Only meaningful when built with libshout TLS support. */
  tls?: "auto" | "auto_no_plain" | "transport" | "upgrade" | "disabled";
}

export interface UdpStreamOutput {
  type: "udp_stream";
  dest_address: string;
  /** A port number or a named service, e.g. "5005" or "http" — kept as a string either way. */
  dest_port: string;
  /** RTLSDR-Airband defaults to false when absent. */
  continuous?: boolean;
}

/** Routes this channel's audio into a top-level mixer, referenced by name (not yet modeled here). */
export interface MixerOutput {
  type: "mixer";
  name: string;
  /** RTLSDR-Airband defaults to 1.0 when absent. */
  ampfactor?: number;
  /** Valid range -1.0 to 1.0; RTLSDR-Airband defaults to 0.0 when absent. */
  balance?: number;
}
