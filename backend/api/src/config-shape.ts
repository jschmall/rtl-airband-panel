/**
 * Runtime structural validation for RtlAirbandConfig arriving as an HTTP
 * request body. backend/parser's fromDomain() trusts its input's TS types
 * (fine for internal callers coming from toDomain()), but an HTTP body is
 * untrusted JSON with no compile-time guarantee — this is the boundary
 * check CLAUDE.md's validation philosophy calls for.
 */
import type {
  Channel,
  Device,
  FileOutput,
  IcecastOutput,
  Mixer,
  MixerOutput,
  MultichannelChannel,
  Output,
  PulseOutput,
  RawFileOutput,
  RtlAirbandConfig,
  ScanChannel,
  UdpStreamOutput,
} from "@rtl-airband-panel/parser";

const TLS_MODES = ["auto", "auto_no_plain", "transport", "upgrade", "disabled"] as const;
const DEVICE_MODES = ["multichannel", "scan"] as const;

export class ShapeValidationError extends Error {
  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = "ShapeValidationError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new ShapeValidationError("Expected an object", path);
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string, path: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new ShapeValidationError(`Expected '${key}' to be an array`, path);
  return v;
}

function optionalArray(obj: Record<string, unknown>, key: string, path: string): unknown[] | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ShapeValidationError(`Expected '${key}' to be an array`, path);
  return v;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new ShapeValidationError(`Expected '${key}' to be a string`, path);
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string, path: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ShapeValidationError(`Expected '${key}' to be a string`, path);
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ShapeValidationError(`Expected '${key}' to be a finite number`, path);
  }
  return v;
}

function optionalNumber(obj: Record<string, unknown>, key: string, path: string): number | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ShapeValidationError(`Expected '${key}' to be a finite number`, path);
  }
  return v;
}

function requireBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") throw new ShapeValidationError(`Expected '${key}' to be a boolean`, path);
  return v;
}

function optionalBoolean(obj: Record<string, unknown>, key: string, path: string): boolean | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new ShapeValidationError(`Expected '${key}' to be a boolean`, path);
  return v;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string";
}

/** Reads an optional field that may be a single number or an array of numbers, e.g. scan-mode `ampfactor`. */
function optionalNumberOrList(obj: Record<string, unknown>, key: string, path: string): number | number[] | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) {
    return v.map((item, i) => {
      if (!isFiniteNumber(item)) throw new ShapeValidationError(`Expected '${key}[${i}]' to be a finite number`, path);
      return item;
    });
  }
  if (!isFiniteNumber(v)) throw new ShapeValidationError(`Expected '${key}' to be a number or an array of numbers`, path);
  return v;
}

/** Reads a required array-of-numbers field, e.g. scan-mode `freqs`. */
function requireNumberArray(obj: Record<string, unknown>, key: string, path: string): number[] {
  const arr = requireArray(obj, key, path);
  return arr.map((item, i) => {
    if (!isFiniteNumber(item)) throw new ShapeValidationError(`Expected '${key}[${i}]' to be a finite number`, path);
    return item;
  });
}

function optionalStringArray(obj: Record<string, unknown>, key: string, path: string): string[] | undefined {
  const arr = optionalArray(obj, key, path);
  if (arr === undefined) return undefined;
  return arr.map((item, i) => {
    if (!isNonEmptyString(item)) throw new ShapeValidationError(`Expected '${key}[${i}]' to be a string`, path);
    return item;
  });
}

/** Reads an optional field that may be a number or a string, e.g. SoapySDR `gain`. */
function optionalNumberOrString(obj: Record<string, unknown>, key: string, path: string): number | string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (isFiniteNumber(v)) return v;
  throw new ShapeValidationError(`Expected '${key}' to be a number or a string`, path);
}

/** dest_port may arrive as either a JSON string or number; normalize to string either way. */
function requireStringOrNumberAsString(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new ShapeValidationError(`Expected '${key}' to be a string or number`, path);
}

export function parseRtlAirbandConfigBody(input: unknown): RtlAirbandConfig {
  const path = "$";
  const obj = requireRecord(input, path);

  const config: RtlAirbandConfig = {
    multiple_demod_threads: requireBoolean(obj, "multiple_demod_threads", path),
    multiple_output_threads: requireBoolean(obj, "multiple_output_threads", path),
    stats_filepath: requireString(obj, "stats_filepath", path),
    localtime: requireBoolean(obj, "localtime", path),
    devices: requireArray(obj, "devices", path).map((d, i) => parseDevice(d, `${path}.devices[${i}]`)),
  };
  const fftSize = optionalNumber(obj, "fft_size", path);
  if (fftSize !== undefined) config.fft_size = fftSize;
  const pidfile = optionalString(obj, "pidfile", path);
  if (pidfile !== undefined) config.pidfile = pidfile;
  const logScanActivity = optionalBoolean(obj, "log_scan_activity", path);
  if (logScanActivity !== undefined) config.log_scan_activity = logScanActivity;
  const shoutMetadataDelay = optionalNumber(obj, "shout_metadata_delay", path);
  if (shoutMetadataDelay !== undefined) config.shout_metadata_delay = shoutMetadataDelay;
  const tau = optionalNumber(obj, "tau", path);
  if (tau !== undefined) config.tau = tau;
  const mixers = optionalArray(obj, "mixers", path);
  if (mixers !== undefined) {
    config.mixers = mixers.map((m, i) => parseMixer(m, `${path}.mixers[${i}]`));
  }
  return config;
}

function parseDeviceMode(obj: Record<string, unknown>, path: string): "multichannel" | "scan" | undefined {
  const mode = optionalString(obj, "mode", path);
  if (mode === undefined) return undefined;
  if (!(DEVICE_MODES as readonly string[]).includes(mode)) {
    throw new ShapeValidationError(`Invalid mode value '${mode}' (must be one of: ${DEVICE_MODES.join(", ")})`, path);
  }
  return mode as "multichannel" | "scan";
}

function parseDevice(input: unknown, path: string): Device {
  const obj = requireRecord(input, path);
  const device: Device = {
    type: requireString(obj, "type", path),
    channels: requireArray(obj, "channels", path).map((c, i) => parseChannel(c, `${path}.channels[${i}]`)),
  };
  const serial = optionalString(obj, "serial", path);
  if (serial !== undefined) device.serial = serial;
  const index = optionalNumber(obj, "index", path);
  if (index !== undefined) device.index = index;
  const gain = optionalNumberOrString(obj, "gain", path);
  if (gain !== undefined) device.gain = gain;
  const centerfreq = optionalNumber(obj, "centerfreq", path);
  if (centerfreq !== undefined) device.centerfreq = centerfreq;
  const sampleRate = optionalNumber(obj, "sample_rate", path);
  if (sampleRate !== undefined) device.sample_rate = sampleRate;
  const correction = optionalNumber(obj, "correction", path);
  if (correction !== undefined) device.correction = correction;
  const mode = parseDeviceMode(obj, path);
  if (mode !== undefined) device.mode = mode;
  const disable = optionalBoolean(obj, "disable", path);
  if (disable !== undefined) device.disable = disable;
  const tau = optionalNumber(obj, "tau", path);
  if (tau !== undefined) device.tau = tau;
  const buffers = optionalNumber(obj, "buffers", path);
  if (buffers !== undefined) device.buffers = buffers;
  const numBuffers = optionalNumber(obj, "num_buffers", path);
  if (numBuffers !== undefined) device.num_buffers = numBuffers;
  const deviceString = optionalString(obj, "device_string", path);
  if (deviceString !== undefined) device.device_string = deviceString;
  const channel = optionalNumber(obj, "channel", path);
  if (channel !== undefined) device.channel = channel;
  const antenna = optionalString(obj, "antenna", path);
  if (antenna !== undefined) device.antenna = antenna;
  return device;
}

function parseChannel(input: unknown, path: string): Channel {
  const obj = requireRecord(input, path);
  const hasFreqs = obj["freqs"] !== undefined;
  const hasFreq = obj["freq"] !== undefined;
  if (hasFreqs === hasFreq) {
    throw new ShapeValidationError("Channel must have exactly one of 'freq' (multichannel) or 'freqs' (scan mode)", path);
  }
  return hasFreqs ? parseScanChannel(obj, path) : parseMultichannelChannel(obj, path);
}

function parseMultichannelChannel(obj: Record<string, unknown>, path: string): MultichannelChannel {
  const channel: MultichannelChannel = {
    freq: requireNumber(obj, "freq", path),
    outputs: requireArray(obj, "outputs", path).map((o, i) => parseOutput(o, `${path}.outputs[${i}]`)),
  };
  const label = optionalString(obj, "label", path);
  if (label !== undefined) channel.label = label;
  const afc = optionalNumber(obj, "afc", path);
  if (afc !== undefined) channel.afc = afc;
  const modulation = optionalString(obj, "modulation", path);
  if (modulation !== undefined) channel.modulation = modulation;
  const bandwidth = optionalNumber(obj, "bandwidth", path);
  if (bandwidth !== undefined) channel.bandwidth = bandwidth;
  const ampfactor = optionalNumber(obj, "ampfactor", path);
  if (ampfactor !== undefined) channel.ampfactor = ampfactor;
  const ctcss = optionalNumber(obj, "ctcss", path);
  if (ctcss !== undefined) channel.ctcss = ctcss;
  const notch = optionalNumber(obj, "notch", path);
  if (notch !== undefined) channel.notch = notch;
  const notchQ = optionalNumber(obj, "notch_q", path);
  if (notchQ !== undefined) channel.notch_q = notchQ;
  const highpass = optionalNumber(obj, "highpass", path);
  if (highpass !== undefined) channel.highpass = highpass;
  const lowpass = optionalNumber(obj, "lowpass", path);
  if (lowpass !== undefined) channel.lowpass = lowpass;
  const tau = optionalNumber(obj, "tau", path);
  if (tau !== undefined) channel.tau = tau;
  const squelchThreshold = optionalNumber(obj, "squelch_threshold", path);
  if (squelchThreshold !== undefined) channel.squelch_threshold = squelchThreshold;
  const squelchSnr = optionalNumber(obj, "squelch_snr_threshold", path);
  if (squelchSnr !== undefined) channel.squelch_snr_threshold = squelchSnr;
  const disable = optionalBoolean(obj, "disable", path);
  if (disable !== undefined) channel.disable = disable;
  return channel;
}

function parseScanChannel(obj: Record<string, unknown>, path: string): ScanChannel {
  const channel: ScanChannel = {
    freqs: requireNumberArray(obj, "freqs", path),
    outputs: requireArray(obj, "outputs", path).map((o, i) => parseOutput(o, `${path}.outputs[${i}]`)),
  };
  const labels = optionalStringArray(obj, "labels", path);
  if (labels !== undefined) channel.labels = labels;
  const modulation = optionalString(obj, "modulation", path);
  if (modulation !== undefined) channel.modulation = modulation;
  const modulations = optionalStringArray(obj, "modulations", path);
  if (modulations !== undefined) channel.modulations = modulations;
  const bandwidth = optionalNumberOrList(obj, "bandwidth", path);
  if (bandwidth !== undefined) channel.bandwidth = bandwidth;
  const ampfactor = optionalNumberOrList(obj, "ampfactor", path);
  if (ampfactor !== undefined) channel.ampfactor = ampfactor;
  const afc = optionalNumber(obj, "afc", path);
  if (afc !== undefined) channel.afc = afc;
  const ctcss = optionalNumberOrList(obj, "ctcss", path);
  if (ctcss !== undefined) channel.ctcss = ctcss;
  const notch = optionalNumberOrList(obj, "notch", path);
  if (notch !== undefined) channel.notch = notch;
  const notchQ = optionalNumberOrList(obj, "notch_q", path);
  if (notchQ !== undefined) channel.notch_q = notchQ;
  const highpass = optionalNumber(obj, "highpass", path);
  if (highpass !== undefined) channel.highpass = highpass;
  const lowpass = optionalNumber(obj, "lowpass", path);
  if (lowpass !== undefined) channel.lowpass = lowpass;
  const tau = optionalNumber(obj, "tau", path);
  if (tau !== undefined) channel.tau = tau;
  const squelchThreshold = optionalNumberOrList(obj, "squelch_threshold", path);
  if (squelchThreshold !== undefined) channel.squelch_threshold = squelchThreshold;
  const squelchSnr = optionalNumberOrList(obj, "squelch_snr_threshold", path);
  if (squelchSnr !== undefined) channel.squelch_snr_threshold = squelchSnr;
  const disable = optionalBoolean(obj, "disable", path);
  if (disable !== undefined) channel.disable = disable;
  return channel;
}

function parseMixer(input: unknown, path: string): Mixer {
  const obj = requireRecord(input, path);
  const outputs = requireArray(obj, "outputs", path).map((o, i) => parseOutput(o, `${path}.outputs[${i}]`));
  outputs.forEach((o, i) => {
    if (o.type === "mixer") {
      throw new ShapeValidationError("A mixer's outputs cannot themselves be of type 'mixer'", `${path}.outputs[${i}]`);
    }
  });
  const mixer: Mixer = {
    name: requireString(obj, "name", path),
    outputs: outputs as Mixer["outputs"],
  };
  const disable = optionalBoolean(obj, "disable", path);
  if (disable !== undefined) mixer.disable = disable;
  const highpass = optionalNumber(obj, "highpass", path);
  if (highpass !== undefined) mixer.highpass = highpass;
  const lowpass = optionalNumber(obj, "lowpass", path);
  if (lowpass !== undefined) mixer.lowpass = lowpass;
  return mixer;
}

function parseOutput(input: unknown, path: string): Output {
  const obj = requireRecord(input, path);
  const type = requireString(obj, "type", path);

  switch (type) {
    case "pulse":
      return parsePulseOutput(obj, path);
    case "file":
      return parseFileOutput(obj, path);
    case "rawfile":
      return parseRawFileOutput(obj, path);
    case "icecast":
      return parseIcecastOutput(obj, path);
    case "udp_stream":
      return parseUdpStreamOutput(obj, path);
    case "mixer":
      return parseMixerOutput(obj, path);
    default:
      throw new ShapeValidationError(
        `Unrecognized output type '${type}' (expected one of: pulse, file, rawfile, icecast, udp_stream, mixer)`,
        path
      );
  }
}

function parseOutputDisable(obj: Record<string, unknown>, path: string, out: { disable?: boolean }): void {
  const disable = optionalBoolean(obj, "disable", path);
  if (disable !== undefined) out.disable = disable;
}

function parsePulseOutput(obj: Record<string, unknown>, path: string): PulseOutput {
  const out: PulseOutput = { type: "pulse" };
  const server = optionalString(obj, "server", path);
  if (server !== undefined) out.server = server;
  const sink = optionalString(obj, "sink", path);
  if (sink !== undefined) out.sink = sink;
  const name = optionalString(obj, "name", path);
  if (name !== undefined) out.name = name;
  const streamName = optionalString(obj, "stream_name", path);
  if (streamName !== undefined) out.stream_name = streamName;
  const continuous = optionalBoolean(obj, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  parseOutputDisable(obj, path, out);
  return out;
}

function parseFileOutput(obj: Record<string, unknown>, path: string): FileOutput {
  const out: FileOutput = {
    type: "file",
    directory: requireString(obj, "directory", path),
    filename_template: requireString(obj, "filename_template", path),
  };
  applyCommonFileFields(obj, path, out);
  const minRxSeconds = optionalNumber(obj, "min_rx_seconds", path);
  if (minRxSeconds !== undefined) out.min_rx_seconds = minRxSeconds;
  const postWriteScript = optionalString(obj, "post_write_script", path);
  if (postWriteScript !== undefined) out.post_write_script = postWriteScript;
  return out;
}

function parseRawFileOutput(obj: Record<string, unknown>, path: string): RawFileOutput {
  const out: RawFileOutput = {
    type: "rawfile",
    directory: requireString(obj, "directory", path),
    filename_template: requireString(obj, "filename_template", path),
  };
  applyCommonFileFields(obj, path, out);
  return out;
}

function applyCommonFileFields(obj: Record<string, unknown>, path: string, out: FileOutput | RawFileOutput): void {
  const continuous = optionalBoolean(obj, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  const splitOnTransmission = optionalBoolean(obj, "split_on_transmission", path);
  if (splitOnTransmission !== undefined) out.split_on_transmission = splitOnTransmission;
  const includeFreq = optionalBoolean(obj, "include_freq", path);
  if (includeFreq !== undefined) out.include_freq = includeFreq;
  const append = optionalBoolean(obj, "append", path);
  if (append !== undefined) out.append = append;
  const datedSubdirectories = optionalBoolean(obj, "dated_subdirectories", path);
  if (datedSubdirectories !== undefined) out.dated_subdirectories = datedSubdirectories;
  parseOutputDisable(obj, path, out);
}

function parseIcecastOutput(obj: Record<string, unknown>, path: string): IcecastOutput {
  const out: IcecastOutput = {
    type: "icecast",
    server: requireString(obj, "server", path),
    port: requireNumber(obj, "port", path),
    mountpoint: requireString(obj, "mountpoint", path),
    username: requireString(obj, "username", path),
    password: requireString(obj, "password", path),
  };
  const name = optionalString(obj, "name", path);
  if (name !== undefined) out.name = name;
  const genre = optionalString(obj, "genre", path);
  if (genre !== undefined) out.genre = genre;
  const description = optionalString(obj, "description", path);
  if (description !== undefined) out.description = description;
  const sendScanFreqTags = optionalBoolean(obj, "send_scan_freq_tags", path);
  if (sendScanFreqTags !== undefined) out.send_scan_freq_tags = sendScanFreqTags;
  const tls = optionalString(obj, "tls", path);
  if (tls !== undefined) {
    if (!(TLS_MODES as readonly string[]).includes(tls)) {
      throw new ShapeValidationError(`Invalid tls value '${tls}' (must be one of: ${TLS_MODES.join(", ")})`, path);
    }
    out.tls = tls as Exclude<IcecastOutput["tls"], undefined>;
  }
  parseOutputDisable(obj, path, out);
  return out;
}

function parseUdpStreamOutput(obj: Record<string, unknown>, path: string): UdpStreamOutput {
  const out: UdpStreamOutput = {
    type: "udp_stream",
    dest_address: requireString(obj, "dest_address", path),
    dest_port: requireStringOrNumberAsString(obj, "dest_port", path),
  };
  const continuous = optionalBoolean(obj, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  parseOutputDisable(obj, path, out);
  return out;
}

function parseMixerOutput(obj: Record<string, unknown>, path: string): MixerOutput {
  const out: MixerOutput = {
    type: "mixer",
    name: requireString(obj, "name", path),
  };
  const ampfactor = optionalNumber(obj, "ampfactor", path);
  if (ampfactor !== undefined) out.ampfactor = ampfactor;
  const balance = optionalNumber(obj, "balance", path);
  if (balance !== undefined) out.balance = balance;
  parseOutputDisable(obj, path, out);
  return out;
}
