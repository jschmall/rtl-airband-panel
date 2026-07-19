import type { ConfigFile, GroupNode } from "./ast.js";
import {
  DomainMappingError,
  boolSetting,
  findSetting,
  group,
  list as listNode,
  numberSetting,
  optionalBool,
  optionalHzNumber,
  optionalNumber,
  optionalString,
  requireBool,
  requireGroupItems,
  requireHzNumber,
  requireList,
  requireNumber,
  requireString,
  setting,
  stringSetting,
} from "./ast-utils.js";
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
} from "./domain.js";

const TLS_MODES = ["auto", "auto_no_plain", "transport", "upgrade", "disabled"] as const;

export function toDomain(ast: ConfigFile): RtlAirbandConfig {
  const root: GroupNode = { kind: "group", members: ast.members };
  const path = "$";

  const devicesList = requireList(root, "devices", path);
  const deviceGroups = requireGroupItems(devicesList, `${path}.devices`);

  const config: RtlAirbandConfig = {
    multiple_demod_threads: requireBool(root, "multiple_demod_threads", path),
    multiple_output_threads: requireBool(root, "multiple_output_threads", path),
    stats_filepath: requireString(root, "stats_filepath", path),
    localtime: requireBool(root, "localtime", path),
    devices: deviceGroups.map((g, i) => toDevice(g, `${path}.devices[${i}]`)),
  };
  const fftSize = optionalNumber(root, "fft_size", path);
  if (fftSize !== undefined) config.fft_size = fftSize;
  return config;
}

function toDevice(g: GroupNode, path: string): Device {
  const channelsList = requireList(g, "channels", path);
  const channelGroups = requireGroupItems(channelsList, `${path}.channels`);
  const device: Device = {
    type: requireString(g, "type", path),
    gain: requireNumber(g, "gain", path),
    centerfreq: requireHzNumber(g, "centerfreq", path),
    channels: channelGroups.map((c, i) => toChannel(c, `${path}.channels[${i}]`)),
  };
  const serial = optionalString(g, "serial", path);
  if (serial !== undefined) device.serial = serial;
  const index = optionalNumber(g, "index", path);
  if (index !== undefined) device.index = index;
  const sampleRate = optionalHzNumber(g, "sample_rate", path);
  if (sampleRate !== undefined) device.sample_rate = sampleRate;
  const correction = optionalNumber(g, "correction", path);
  if (correction !== undefined) device.correction = correction;
  return device;
}

function toChannel(g: GroupNode, path: string): Channel {
  const outputsList = requireList(g, "outputs", path);
  const outputGroups = requireGroupItems(outputsList, `${path}.outputs`);
  const channel: Channel = {
    freq: requireHzNumber(g, "freq", path),
    outputs: outputGroups.map((o, i) => toOutput(o, `${path}.outputs[${i}]`)),
  };
  const afc = optionalNumber(g, "afc", path);
  if (afc !== undefined) channel.afc = afc;
  const modulation = optionalString(g, "modulation", path);
  if (modulation !== undefined) channel.modulation = modulation;
  const bandwidth = optionalHzNumber(g, "bandwidth", path);
  if (bandwidth !== undefined) channel.bandwidth = bandwidth;
  const ampfactor = optionalNumber(g, "ampfactor", path);
  if (ampfactor !== undefined) channel.ampfactor = ampfactor;
  const ctcss = optionalNumber(g, "ctcss", path);
  if (ctcss !== undefined) channel.ctcss = ctcss;
  const notch = optionalNumber(g, "notch", path);
  if (notch !== undefined) channel.notch = notch;
  const squelch = optionalNumber(g, "squelch_snr_threshold", path);
  if (squelch !== undefined) channel.squelch_snr_threshold = squelch;
  return channel;
}

function toOutput(g: GroupNode, path: string): Output {
  const type = requireString(g, "type", path);
  switch (type) {
    case "pulse":
      return toPulseOutput(g, path);
    case "file":
      return toFileOutput(g, path);
    case "rawfile":
      return toRawFileOutput(g, path);
    case "icecast":
      return toIcecastOutput(g, path);
    case "udp_stream":
      return toUdpStreamOutput(g, path);
    case "mixer":
      return toMixerOutput(g, path);
    default:
      throw new DomainMappingError(`Unrecognized output type '${type}'`, path);
  }
}

function toPulseOutput(g: GroupNode, path: string): PulseOutput {
  const out: PulseOutput = { type: "pulse" };
  const server = optionalString(g, "server", path);
  if (server !== undefined) out.server = server;
  const sink = optionalString(g, "sink", path);
  if (sink !== undefined) out.sink = sink;
  const name = optionalString(g, "name", path);
  if (name !== undefined) out.name = name;
  const streamName = optionalString(g, "stream_name", path);
  if (streamName !== undefined) out.stream_name = streamName;
  const continuous = optionalBool(g, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  return out;
}

function toFileOutput(g: GroupNode, path: string): FileOutput {
  const out: FileOutput = {
    type: "file",
    directory: requireString(g, "directory", path),
    filename_template: requireString(g, "filename_template", path),
  };
  applyCommonFileFields(g, path, out);
  const minRxSeconds = optionalNumber(g, "min_rx_seconds", path);
  if (minRxSeconds !== undefined) out.min_rx_seconds = minRxSeconds;
  const postWriteScript = optionalString(g, "post_write_script", path);
  if (postWriteScript !== undefined) out.post_write_script = postWriteScript;
  return out;
}

function toRawFileOutput(g: GroupNode, path: string): RawFileOutput {
  const out: RawFileOutput = {
    type: "rawfile",
    directory: requireString(g, "directory", path),
    filename_template: requireString(g, "filename_template", path),
  };
  applyCommonFileFields(g, path, out);
  return out;
}

function applyCommonFileFields(g: GroupNode, path: string, out: FileOutput | RawFileOutput): void {
  const continuous = optionalBool(g, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  const splitOnTransmission = optionalBool(g, "split_on_transmission", path);
  if (splitOnTransmission !== undefined) out.split_on_transmission = splitOnTransmission;
  const includeFreq = optionalBool(g, "include_freq", path);
  if (includeFreq !== undefined) out.include_freq = includeFreq;
  const append = optionalBool(g, "append", path);
  if (append !== undefined) out.append = append;
  const datedSubdirectories = optionalBool(g, "dated_subdirectories", path);
  if (datedSubdirectories !== undefined) out.dated_subdirectories = datedSubdirectories;
}

function toIcecastOutput(g: GroupNode, path: string): IcecastOutput {
  const out: IcecastOutput = {
    type: "icecast",
    server: requireString(g, "server", path),
    port: requireNumber(g, "port", path),
    mountpoint: requireString(g, "mountpoint", path),
    username: requireString(g, "username", path),
    password: requireString(g, "password", path),
  };
  const name = optionalString(g, "name", path);
  if (name !== undefined) out.name = name;
  const genre = optionalString(g, "genre", path);
  if (genre !== undefined) out.genre = genre;
  const description = optionalString(g, "description", path);
  if (description !== undefined) out.description = description;
  const sendScanFreqTags = optionalBool(g, "send_scan_freq_tags", path);
  if (sendScanFreqTags !== undefined) out.send_scan_freq_tags = sendScanFreqTags;
  const tls = optionalString(g, "tls", path);
  if (tls !== undefined) {
    if (!(TLS_MODES as readonly string[]).includes(tls)) {
      throw new DomainMappingError(`Invalid tls value '${tls}' (must be one of: ${TLS_MODES.join(", ")})`, path);
    }
    out.tls = tls as Exclude<IcecastOutput["tls"], undefined>;
  }
  return out;
}

function toUdpStreamOutput(g: GroupNode, path: string): UdpStreamOutput {
  const out: UdpStreamOutput = {
    type: "udp_stream",
    dest_address: requireString(g, "dest_address", path),
    // dest_port may be authored as an int or a string in the source; normalize to string either way.
    dest_port: requireStringOrNumberAsString(g, "dest_port", path),
  };
  const continuous = optionalBool(g, "continuous", path);
  if (continuous !== undefined) out.continuous = continuous;
  return out;
}

function requireStringOrNumberAsString(g: GroupNode, name: string, path: string): string {
  const s = findSetting(g, name);
  if (!s || s.value.kind !== "scalar") {
    throw new DomainMappingError(`Missing required field '${name}'`, path);
  }
  if (s.value.type === "string") return s.value.value as string;
  if (s.value.type === "int" || s.value.type === "int64" || s.value.type === "float") {
    return String(s.value.value);
  }
  throw new DomainMappingError(`Expected '${name}' to be a string or number`, path);
}

function toMixerOutput(g: GroupNode, path: string): MixerOutput {
  const out: MixerOutput = {
    type: "mixer",
    name: requireString(g, "name", path),
  };
  const ampfactor = optionalNumber(g, "ampfactor", path);
  if (ampfactor !== undefined) out.ampfactor = ampfactor;
  const balance = optionalNumber(g, "balance", path);
  if (balance !== undefined) out.balance = balance;
  return out;
}

export function fromDomain(config: RtlAirbandConfig): ConfigFile {
  const members = [
    boolSetting("multiple_demod_threads", config.multiple_demod_threads),
    boolSetting("multiple_output_threads", config.multiple_output_threads),
    stringSetting("stats_filepath", config.stats_filepath),
    boolSetting("localtime", config.localtime),
  ];
  if (config.fft_size !== undefined) members.push(numberSetting("fft_size", config.fft_size, "int"));
  members.push(setting("devices", listNode(config.devices.map(deviceFromDomain))));
  return { members };
}

function deviceFromDomain(device: Device) {
  const members = [stringSetting("type", device.type)];
  if (device.serial !== undefined) members.push(stringSetting("serial", device.serial));
  if (device.index !== undefined) members.push(numberSetting("index", device.index, "int"));
  members.push(numberSetting("gain", device.gain, "int"));
  members.push(numberSetting("centerfreq", device.centerfreq, "int"));
  if (device.sample_rate !== undefined) members.push(numberSetting("sample_rate", device.sample_rate, "int"));
  if (device.correction !== undefined) members.push(numberSetting("correction", device.correction, "int"));
  members.push(setting("channels", listNode(device.channels.map(channelFromDomain))));
  return group(members);
}

function channelFromDomain(channel: Channel) {
  const members = [numberSetting("freq", channel.freq, "int")];
  if (channel.bandwidth !== undefined) members.push(numberSetting("bandwidth", channel.bandwidth, "int"));
  if (channel.ampfactor !== undefined) members.push(numberSetting("ampfactor", channel.ampfactor, "float"));
  if (channel.afc !== undefined) members.push(numberSetting("afc", channel.afc, "int"));
  if (channel.modulation !== undefined) members.push(stringSetting("modulation", channel.modulation));
  if (channel.ctcss !== undefined) members.push(numberSetting("ctcss", channel.ctcss, "float"));
  if (channel.notch !== undefined) members.push(numberSetting("notch", channel.notch, "float"));
  if (channel.squelch_snr_threshold !== undefined) {
    members.push(numberSetting("squelch_snr_threshold", channel.squelch_snr_threshold, "int"));
  }
  members.push(setting("outputs", listNode(channel.outputs.map(outputFromDomain))));
  return group(members);
}

function outputFromDomain(output: Output): GroupNode {
  switch (output.type) {
    case "pulse":
      return pulseOutputToAst(output);
    case "file":
      return fileOutputToAst(output);
    case "rawfile":
      return rawFileOutputToAst(output);
    case "icecast":
      return icecastOutputToAst(output);
    case "udp_stream":
      return udpStreamOutputToAst(output);
    case "mixer":
      return mixerOutputToAst(output);
  }
}

function pulseOutputToAst(output: PulseOutput): GroupNode {
  const members = [stringSetting("type", output.type)];
  if (output.server !== undefined) members.push(stringSetting("server", output.server));
  if (output.sink !== undefined) members.push(stringSetting("sink", output.sink));
  if (output.name !== undefined) members.push(stringSetting("name", output.name));
  if (output.stream_name !== undefined) members.push(stringSetting("stream_name", output.stream_name));
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  return group(members);
}

function fileOutputToAst(output: FileOutput): GroupNode {
  const members = [
    stringSetting("type", output.type),
    stringSetting("directory", output.directory),
    stringSetting("filename_template", output.filename_template),
  ];
  appendCommonFileFields(members, output);
  if (output.min_rx_seconds !== undefined) members.push(numberSetting("min_rx_seconds", output.min_rx_seconds, "float"));
  if (output.post_write_script !== undefined) members.push(stringSetting("post_write_script", output.post_write_script));
  return group(members);
}

function rawFileOutputToAst(output: RawFileOutput): GroupNode {
  const members = [
    stringSetting("type", output.type),
    stringSetting("directory", output.directory),
    stringSetting("filename_template", output.filename_template),
  ];
  appendCommonFileFields(members, output);
  return group(members);
}

function appendCommonFileFields(members: ReturnType<typeof stringSetting>[], output: FileOutput | RawFileOutput): void {
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  if (output.split_on_transmission !== undefined) members.push(boolSetting("split_on_transmission", output.split_on_transmission));
  if (output.include_freq !== undefined) members.push(boolSetting("include_freq", output.include_freq));
  if (output.append !== undefined) members.push(boolSetting("append", output.append));
  if (output.dated_subdirectories !== undefined) members.push(boolSetting("dated_subdirectories", output.dated_subdirectories));
}

function icecastOutputToAst(output: IcecastOutput): GroupNode {
  const members = [
    stringSetting("type", output.type),
    stringSetting("server", output.server),
    numberSetting("port", output.port, "int"),
    stringSetting("mountpoint", output.mountpoint),
    stringSetting("username", output.username),
    stringSetting("password", output.password),
  ];
  if (output.name !== undefined) members.push(stringSetting("name", output.name));
  if (output.genre !== undefined) members.push(stringSetting("genre", output.genre));
  if (output.description !== undefined) members.push(stringSetting("description", output.description));
  if (output.send_scan_freq_tags !== undefined) members.push(boolSetting("send_scan_freq_tags", output.send_scan_freq_tags));
  if (output.tls !== undefined) members.push(stringSetting("tls", output.tls));
  return group(members);
}

function udpStreamOutputToAst(output: UdpStreamOutput): GroupNode {
  const members = [
    stringSetting("type", output.type),
    stringSetting("dest_address", output.dest_address),
    stringSetting("dest_port", output.dest_port),
  ];
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  return group(members);
}

function mixerOutputToAst(output: MixerOutput): GroupNode {
  const members = [stringSetting("type", output.type), stringSetting("name", output.name)];
  if (output.ampfactor !== undefined) members.push(numberSetting("ampfactor", output.ampfactor, "float"));
  if (output.balance !== undefined) members.push(numberSetting("balance", output.balance, "float"));
  return group(members);
}

// re-exported for callers that only need existence checks on the raw AST
export { findSetting };
