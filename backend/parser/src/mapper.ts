import type { ConfigFile, GroupNode } from "./ast.js";
import {
  DomainMappingError,
  boolSetting,
  findSetting,
  group,
  list as listNode,
  numberOrListSetting,
  numberOrStringSetting,
  numberListSetting,
  numberSetting,
  optionalBool,
  optionalGroup,
  optionalHzNumber,
  optionalHzNumberOrList,
  optionalNumber,
  optionalNumberOrList,
  optionalNumberOrString,
  optionalString,
  optionalStringList,
  requireBool,
  requireGroupItems,
  requireHzNumber,
  requireHzNumberList,
  requireList,
  requireNumber,
  requireString,
  setting,
  stringListSetting,
  stringSetting,
} from "./ast-utils.js";
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
  RdioScannerConfig,
  RtlAirbandConfig,
  ScanChannel,
  UdpStreamOutput,
} from "./domain.js";

const TLS_MODES = ["auto", "auto_no_plain", "transport", "upgrade", "disabled"] as const;
const DEVICE_MODES = ["multichannel", "scan"] as const;

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
  const pidfile = optionalString(root, "pidfile", path);
  if (pidfile !== undefined) config.pidfile = pidfile;
  const logScanActivity = optionalBool(root, "log_scan_activity", path);
  if (logScanActivity !== undefined) config.log_scan_activity = logScanActivity;
  const shoutMetadataDelay = optionalNumber(root, "shout_metadata_delay", path);
  if (shoutMetadataDelay !== undefined) config.shout_metadata_delay = shoutMetadataDelay;
  const tau = optionalNumber(root, "tau", path);
  if (tau !== undefined) config.tau = tau;

  const mixersList = findSetting(root, "mixers");
  if (mixersList) {
    const ml = requireList(root, "mixers", path);
    const mixerGroups = requireGroupItems(ml, `${path}.mixers`);
    config.mixers = mixerGroups.map((g, i) => toMixer(g, `${path}.mixers[${i}]`));
  }
  return config;
}

function toDeviceMode(g: GroupNode, path: string): "multichannel" | "scan" | undefined {
  const mode = optionalString(g, "mode", path);
  if (mode === undefined) return undefined;
  if (!(DEVICE_MODES as readonly string[]).includes(mode)) {
    throw new DomainMappingError(`Invalid mode value '${mode}' (must be one of: ${DEVICE_MODES.join(", ")})`, path);
  }
  return mode as "multichannel" | "scan";
}

function toDevice(g: GroupNode, path: string): Device {
  const channelsList = requireList(g, "channels", path);
  const channelGroups = requireGroupItems(channelsList, `${path}.channels`);
  const device: Device = {
    type: requireString(g, "type", path),
    channels: channelGroups.map((c, i) => toChannel(c, `${path}.channels[${i}]`)),
  };
  const serial = optionalString(g, "serial", path);
  if (serial !== undefined) device.serial = serial;
  const index = optionalNumber(g, "index", path);
  if (index !== undefined) device.index = index;
  const gain = optionalNumberOrString(g, "gain", path);
  if (gain !== undefined) device.gain = gain;
  const centerfreq = optionalHzNumber(g, "centerfreq", path);
  if (centerfreq !== undefined) device.centerfreq = centerfreq;
  const sampleRate = optionalHzNumber(g, "sample_rate", path);
  if (sampleRate !== undefined) device.sample_rate = sampleRate;
  const correction = optionalNumber(g, "correction", path);
  if (correction !== undefined) device.correction = correction;
  const mode = toDeviceMode(g, path);
  if (mode !== undefined) device.mode = mode;
  const disable = optionalBool(g, "disable", path);
  if (disable !== undefined) device.disable = disable;
  const tau = optionalNumber(g, "tau", path);
  if (tau !== undefined) device.tau = tau;
  const buffers = optionalNumber(g, "buffers", path);
  if (buffers !== undefined) device.buffers = buffers;
  const numBuffers = optionalNumber(g, "num_buffers", path);
  if (numBuffers !== undefined) device.num_buffers = numBuffers;
  const deviceString = optionalString(g, "device_string", path);
  if (deviceString !== undefined) device.device_string = deviceString;
  const channel = optionalNumber(g, "channel", path);
  if (channel !== undefined) device.channel = channel;
  const antenna = optionalString(g, "antenna", path);
  if (antenna !== undefined) device.antenna = antenna;
  return device;
}

function toChannel(g: GroupNode, path: string): Channel {
  const hasFreqs = findSetting(g, "freqs") !== undefined;
  const hasFreq = findSetting(g, "freq") !== undefined;
  if (hasFreqs === hasFreq) {
    throw new DomainMappingError("Channel must have exactly one of 'freq' (multichannel) or 'freqs' (scan mode)", path);
  }
  return hasFreqs ? toScanChannel(g, path) : toMultichannelChannel(g, path);
}

function toMultichannelChannel(g: GroupNode, path: string): MultichannelChannel {
  const outputsList = requireList(g, "outputs", path);
  const outputGroups = requireGroupItems(outputsList, `${path}.outputs`);
  const channel: MultichannelChannel = {
    freq: requireHzNumber(g, "freq", path),
    outputs: outputGroups.map((o, i) => toOutput(o, `${path}.outputs[${i}]`)),
  };
  const label = optionalString(g, "label", path);
  if (label !== undefined) channel.label = label;
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
  const notchQ = optionalNumber(g, "notch_q", path);
  if (notchQ !== undefined) channel.notch_q = notchQ;
  const highpass = optionalNumber(g, "highpass", path);
  if (highpass !== undefined) channel.highpass = highpass;
  const lowpass = optionalNumber(g, "lowpass", path);
  if (lowpass !== undefined) channel.lowpass = lowpass;
  const tau = optionalNumber(g, "tau", path);
  if (tau !== undefined) channel.tau = tau;
  const squelchThreshold = optionalNumber(g, "squelch_threshold", path);
  if (squelchThreshold !== undefined) channel.squelch_threshold = squelchThreshold;
  const squelchSnr = optionalNumber(g, "squelch_snr_threshold", path);
  if (squelchSnr !== undefined) channel.squelch_snr_threshold = squelchSnr;
  const disable = optionalBool(g, "disable", path);
  if (disable !== undefined) channel.disable = disable;
  return channel;
}

function toScanChannel(g: GroupNode, path: string): ScanChannel {
  const outputsList = requireList(g, "outputs", path);
  const outputGroups = requireGroupItems(outputsList, `${path}.outputs`);
  const channel: ScanChannel = {
    freqs: requireHzNumberList(g, "freqs", path),
    outputs: outputGroups.map((o, i) => toOutput(o, `${path}.outputs[${i}]`)),
  };
  const labels = optionalStringList(g, "labels", path);
  if (labels !== undefined) channel.labels = labels;
  const modulation = optionalString(g, "modulation", path);
  if (modulation !== undefined) channel.modulation = modulation;
  const modulations = optionalStringList(g, "modulations", path);
  if (modulations !== undefined) channel.modulations = modulations;
  const bandwidth = optionalHzNumberOrList(g, "bandwidth", path);
  if (bandwidth !== undefined) channel.bandwidth = bandwidth;
  const ampfactor = optionalNumberOrList(g, "ampfactor", path);
  if (ampfactor !== undefined) channel.ampfactor = ampfactor;
  const afc = optionalNumber(g, "afc", path);
  if (afc !== undefined) channel.afc = afc;
  const ctcss = optionalNumberOrList(g, "ctcss", path);
  if (ctcss !== undefined) channel.ctcss = ctcss;
  const notch = optionalNumberOrList(g, "notch", path);
  if (notch !== undefined) channel.notch = notch;
  const notchQ = optionalNumberOrList(g, "notch_q", path);
  if (notchQ !== undefined) channel.notch_q = notchQ;
  const highpass = optionalNumber(g, "highpass", path);
  if (highpass !== undefined) channel.highpass = highpass;
  const lowpass = optionalNumber(g, "lowpass", path);
  if (lowpass !== undefined) channel.lowpass = lowpass;
  const tau = optionalNumber(g, "tau", path);
  if (tau !== undefined) channel.tau = tau;
  const squelchThreshold = optionalNumberOrList(g, "squelch_threshold", path);
  if (squelchThreshold !== undefined) channel.squelch_threshold = squelchThreshold;
  const squelchSnr = optionalNumberOrList(g, "squelch_snr_threshold", path);
  if (squelchSnr !== undefined) channel.squelch_snr_threshold = squelchSnr;
  const disable = optionalBool(g, "disable", path);
  if (disable !== undefined) channel.disable = disable;
  return channel;
}

function isScanChannel(channel: Channel): channel is ScanChannel {
  return "freqs" in channel;
}

function toMixer(g: GroupNode, path: string): Mixer {
  const outputsList = requireList(g, "outputs", path);
  const outputGroups = requireGroupItems(outputsList, `${path}.outputs`);
  const outputs = outputGroups.map((o, i) => toOutput(o, `${path}.outputs[${i}]`));
  outputs.forEach((o, i) => {
    if (o.type === "mixer") {
      throw new DomainMappingError("A mixer's outputs cannot themselves be of type 'mixer'", `${path}.outputs[${i}]`);
    }
  });
  const mixer: Mixer = {
    name: requireString(g, "name", path),
    outputs: outputs as Mixer["outputs"],
  };
  const disable = optionalBool(g, "disable", path);
  if (disable !== undefined) mixer.disable = disable;
  const highpass = optionalNumber(g, "highpass", path);
  if (highpass !== undefined) mixer.highpass = highpass;
  const lowpass = optionalNumber(g, "lowpass", path);
  if (lowpass !== undefined) mixer.lowpass = lowpass;
  return mixer;
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

function applyDisable(g: GroupNode, path: string, out: { disable?: boolean }): void {
  const disable = optionalBool(g, "disable", path);
  if (disable !== undefined) out.disable = disable;
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
  applyDisable(g, path, out);
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
  const rdioScanner = optionalGroup(g, "rdio_scanner", path);
  if (rdioScanner !== undefined) out.rdio_scanner = toRdioScannerConfig(rdioScanner, `${path}.rdio_scanner`);
  return out;
}

function toRdioScannerConfig(g: GroupNode, path: string): RdioScannerConfig {
  const out: RdioScannerConfig = {
    server: requireString(g, "server", path),
    port: requireNumber(g, "port", path),
    api_key: requireString(g, "api_key", path),
    talkgroup_id: requireNumber(g, "talkgroup_id", path),
  };
  const useTls = optionalBool(g, "use_tls", path);
  if (useTls !== undefined) out.use_tls = useTls;
  const systemId = optionalNumber(g, "system_id", path);
  if (systemId !== undefined) out.system_id = systemId;
  const systemLabel = optionalString(g, "system_label", path);
  if (systemLabel !== undefined) out.system_label = systemLabel;
  const talkgroupLabel = optionalString(g, "talkgroup_label", path);
  if (talkgroupLabel !== undefined) out.talkgroup_label = talkgroupLabel;
  const talkgroupTag = optionalString(g, "talkgroup_tag", path);
  if (talkgroupTag !== undefined) out.talkgroup_tag = talkgroupTag;
  const talkgroupGroup = optionalString(g, "talkgroup_group", path);
  if (talkgroupGroup !== undefined) out.talkgroup_group = talkgroupGroup;
  const sourceId = optionalNumber(g, "source_id", path);
  if (sourceId !== undefined) out.source_id = sourceId;
  const deleteAfterUpload = optionalBool(g, "delete_after_upload", path);
  if (deleteAfterUpload !== undefined) out.delete_after_upload = deleteAfterUpload;
  const timeoutMs = optionalNumber(g, "timeout_ms", path);
  if (timeoutMs !== undefined) out.timeout_ms = timeoutMs;
  const maxRetries = optionalNumber(g, "max_retries", path);
  if (maxRetries !== undefined) out.max_retries = maxRetries;
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
  applyDisable(g, path, out);
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
  applyDisable(g, path, out);
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
  applyDisable(g, path, out);
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
  applyDisable(g, path, out);
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
  if (config.pidfile !== undefined) members.push(stringSetting("pidfile", config.pidfile));
  if (config.log_scan_activity !== undefined) members.push(boolSetting("log_scan_activity", config.log_scan_activity));
  if (config.shout_metadata_delay !== undefined) {
    members.push(numberSetting("shout_metadata_delay", config.shout_metadata_delay, "int"));
  }
  if (config.tau !== undefined) members.push(numberSetting("tau", config.tau, "int"));
  members.push(setting("devices", listNode(config.devices.map(deviceFromDomain))));
  if (config.mixers !== undefined) {
    members.push(setting("mixers", listNode(config.mixers.map(mixerFromDomain))));
  }
  return { members };
}

function deviceFromDomain(device: Device) {
  const members = [stringSetting("type", device.type)];
  if (device.serial !== undefined) members.push(stringSetting("serial", device.serial));
  if (device.index !== undefined) members.push(numberSetting("index", device.index, "int"));
  if (device.gain !== undefined) members.push(numberOrStringSetting("gain", device.gain));
  if (device.centerfreq !== undefined) members.push(numberSetting("centerfreq", device.centerfreq, "int"));
  if (device.sample_rate !== undefined) members.push(numberSetting("sample_rate", device.sample_rate, "int"));
  if (device.correction !== undefined) members.push(numberSetting("correction", device.correction, "int"));
  if (device.mode !== undefined) members.push(stringSetting("mode", device.mode));
  if (device.disable !== undefined) members.push(boolSetting("disable", device.disable));
  if (device.tau !== undefined) members.push(numberSetting("tau", device.tau, "int"));
  if (device.buffers !== undefined) members.push(numberSetting("buffers", device.buffers, "int"));
  if (device.num_buffers !== undefined) members.push(numberSetting("num_buffers", device.num_buffers, "int"));
  if (device.device_string !== undefined) members.push(stringSetting("device_string", device.device_string));
  if (device.channel !== undefined) members.push(numberSetting("channel", device.channel, "int"));
  if (device.antenna !== undefined) members.push(stringSetting("antenna", device.antenna));
  members.push(setting("channels", listNode(device.channels.map(channelFromDomain))));
  return group(members);
}

function channelFromDomain(channel: Channel): GroupNode {
  return isScanChannel(channel) ? scanChannelFromDomain(channel) : multichannelChannelFromDomain(channel);
}

function multichannelChannelFromDomain(channel: MultichannelChannel): GroupNode {
  const members = [numberSetting("freq", channel.freq, "int")];
  if (channel.label !== undefined) members.push(stringSetting("label", channel.label));
  if (channel.bandwidth !== undefined) members.push(numberSetting("bandwidth", channel.bandwidth, "int"));
  if (channel.ampfactor !== undefined) members.push(numberSetting("ampfactor", channel.ampfactor, "float"));
  if (channel.afc !== undefined) members.push(numberSetting("afc", channel.afc, "int"));
  if (channel.modulation !== undefined) members.push(stringSetting("modulation", channel.modulation));
  if (channel.ctcss !== undefined) members.push(numberSetting("ctcss", channel.ctcss, "float"));
  if (channel.notch !== undefined) members.push(numberSetting("notch", channel.notch, "float"));
  if (channel.notch_q !== undefined) members.push(numberSetting("notch_q", channel.notch_q, "float"));
  if (channel.highpass !== undefined) members.push(numberSetting("highpass", channel.highpass, "int"));
  if (channel.lowpass !== undefined) members.push(numberSetting("lowpass", channel.lowpass, "int"));
  if (channel.tau !== undefined) members.push(numberSetting("tau", channel.tau, "int"));
  if (channel.squelch_threshold !== undefined) {
    members.push(numberSetting("squelch_threshold", channel.squelch_threshold, "int"));
  }
  if (channel.squelch_snr_threshold !== undefined) {
    members.push(numberSetting("squelch_snr_threshold", channel.squelch_snr_threshold, "int"));
  }
  if (channel.disable !== undefined) members.push(boolSetting("disable", channel.disable));
  members.push(setting("outputs", listNode(channel.outputs.map(outputFromDomain))));
  return group(members);
}

function scanChannelFromDomain(channel: ScanChannel): GroupNode {
  const members = [numberListSetting("freqs", channel.freqs, "int")];
  if (channel.labels !== undefined) members.push(stringListSetting("labels", channel.labels));
  if (channel.modulation !== undefined) members.push(stringSetting("modulation", channel.modulation));
  if (channel.modulations !== undefined) members.push(stringListSetting("modulations", channel.modulations));
  if (channel.bandwidth !== undefined) members.push(numberOrListSetting("bandwidth", channel.bandwidth, "int"));
  if (channel.ampfactor !== undefined) members.push(numberOrListSetting("ampfactor", channel.ampfactor, "float"));
  if (channel.afc !== undefined) members.push(numberSetting("afc", channel.afc, "int"));
  if (channel.ctcss !== undefined) members.push(numberOrListSetting("ctcss", channel.ctcss, "float"));
  if (channel.notch !== undefined) members.push(numberOrListSetting("notch", channel.notch, "float"));
  if (channel.notch_q !== undefined) members.push(numberOrListSetting("notch_q", channel.notch_q, "float"));
  if (channel.highpass !== undefined) members.push(numberSetting("highpass", channel.highpass, "int"));
  if (channel.lowpass !== undefined) members.push(numberSetting("lowpass", channel.lowpass, "int"));
  if (channel.tau !== undefined) members.push(numberSetting("tau", channel.tau, "int"));
  if (channel.squelch_threshold !== undefined) {
    members.push(numberOrListSetting("squelch_threshold", channel.squelch_threshold, "int"));
  }
  if (channel.squelch_snr_threshold !== undefined) {
    members.push(numberOrListSetting("squelch_snr_threshold", channel.squelch_snr_threshold, "float"));
  }
  if (channel.disable !== undefined) members.push(boolSetting("disable", channel.disable));
  members.push(setting("outputs", listNode(channel.outputs.map(outputFromDomain))));
  return group(members);
}

function mixerFromDomain(mixer: Mixer): GroupNode {
  const members = [stringSetting("name", mixer.name)];
  if (mixer.disable !== undefined) members.push(boolSetting("disable", mixer.disable));
  if (mixer.highpass !== undefined) members.push(numberSetting("highpass", mixer.highpass, "int"));
  if (mixer.lowpass !== undefined) members.push(numberSetting("lowpass", mixer.lowpass, "int"));
  members.push(setting("outputs", listNode(mixer.outputs.map(outputFromDomain))));
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

function appendDisable(members: SettingNodeLike[], output: { disable?: boolean }): void {
  if (output.disable !== undefined) members.push(boolSetting("disable", output.disable));
}

function pulseOutputToAst(output: PulseOutput): GroupNode {
  const members = [stringSetting("type", output.type)];
  if (output.server !== undefined) members.push(stringSetting("server", output.server));
  if (output.sink !== undefined) members.push(stringSetting("sink", output.sink));
  if (output.name !== undefined) members.push(stringSetting("name", output.name));
  if (output.stream_name !== undefined) members.push(stringSetting("stream_name", output.stream_name));
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  appendDisable(members, output);
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
  if (output.rdio_scanner !== undefined) members.push(setting("rdio_scanner", rdioScannerConfigToAst(output.rdio_scanner)));
  return group(members);
}

function rdioScannerConfigToAst(config: RdioScannerConfig): GroupNode {
  const members = [
    stringSetting("server", config.server),
    numberSetting("port", config.port, "int"),
    stringSetting("api_key", config.api_key),
    numberSetting("talkgroup_id", config.talkgroup_id, "int"),
  ];
  if (config.use_tls !== undefined) members.push(boolSetting("use_tls", config.use_tls));
  if (config.system_id !== undefined) members.push(numberSetting("system_id", config.system_id, "int"));
  if (config.system_label !== undefined) members.push(stringSetting("system_label", config.system_label));
  if (config.talkgroup_label !== undefined) members.push(stringSetting("talkgroup_label", config.talkgroup_label));
  if (config.talkgroup_tag !== undefined) members.push(stringSetting("talkgroup_tag", config.talkgroup_tag));
  if (config.talkgroup_group !== undefined) members.push(stringSetting("talkgroup_group", config.talkgroup_group));
  if (config.source_id !== undefined) members.push(numberSetting("source_id", config.source_id, "int"));
  if (config.delete_after_upload !== undefined) members.push(boolSetting("delete_after_upload", config.delete_after_upload));
  if (config.timeout_ms !== undefined) members.push(numberSetting("timeout_ms", config.timeout_ms, "int"));
  if (config.max_retries !== undefined) members.push(numberSetting("max_retries", config.max_retries, "int"));
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

type SettingNodeLike = ReturnType<typeof stringSetting>;

function appendCommonFileFields(members: SettingNodeLike[], output: FileOutput | RawFileOutput): void {
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  if (output.split_on_transmission !== undefined) members.push(boolSetting("split_on_transmission", output.split_on_transmission));
  if (output.include_freq !== undefined) members.push(boolSetting("include_freq", output.include_freq));
  if (output.append !== undefined) members.push(boolSetting("append", output.append));
  if (output.dated_subdirectories !== undefined) members.push(boolSetting("dated_subdirectories", output.dated_subdirectories));
  appendDisable(members, output);
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
  appendDisable(members, output);
  return group(members);
}

function udpStreamOutputToAst(output: UdpStreamOutput): GroupNode {
  const members = [
    stringSetting("type", output.type),
    stringSetting("dest_address", output.dest_address),
    stringSetting("dest_port", output.dest_port),
  ];
  if (output.continuous !== undefined) members.push(boolSetting("continuous", output.continuous));
  appendDisable(members, output);
  return group(members);
}

function mixerOutputToAst(output: MixerOutput): GroupNode {
  const members = [stringSetting("type", output.type), stringSetting("name", output.name)];
  if (output.ampfactor !== undefined) members.push(numberSetting("ampfactor", output.ampfactor, "float"));
  if (output.balance !== undefined) members.push(numberSetting("balance", output.balance, "float"));
  appendDisable(members, output);
  return group(members);
}

// re-exported for callers that only need existence checks on the raw AST
export { findSetting };
