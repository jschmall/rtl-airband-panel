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
  MixerOutput,
  Output,
  PulseOutput,
  RawFileOutput,
  RtlAirbandConfig,
  UdpStreamOutput,
} from "@rtl-airband-panel/parser";

const TLS_MODES = ["auto", "auto_no_plain", "transport", "upgrade", "disabled"] as const;

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
  return config;
}

function parseDevice(input: unknown, path: string): Device {
  const obj = requireRecord(input, path);
  const device: Device = {
    type: requireString(obj, "type", path),
    gain: requireNumber(obj, "gain", path),
    centerfreq: requireNumber(obj, "centerfreq", path),
    channels: requireArray(obj, "channels", path).map((c, i) => parseChannel(c, `${path}.channels[${i}]`)),
  };
  const serial = optionalString(obj, "serial", path);
  if (serial !== undefined) device.serial = serial;
  const index = optionalNumber(obj, "index", path);
  if (index !== undefined) device.index = index;
  const sampleRate = optionalNumber(obj, "sample_rate", path);
  if (sampleRate !== undefined) device.sample_rate = sampleRate;
  const correction = optionalNumber(obj, "correction", path);
  if (correction !== undefined) device.correction = correction;
  return device;
}

function parseChannel(input: unknown, path: string): Channel {
  const obj = requireRecord(input, path);
  const channel: Channel = {
    freq: requireNumber(obj, "freq", path),
    outputs: requireArray(obj, "outputs", path).map((o, i) => parseOutput(o, `${path}.outputs[${i}]`)),
  };
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
  const squelch = optionalNumber(obj, "squelch_snr_threshold", path);
  if (squelch !== undefined) channel.squelch_snr_threshold = squelch;
  return channel;
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
  return out;
}
