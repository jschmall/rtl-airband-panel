import type {
  Channel,
  Device,
  FileOutput,
  IcecastOutput,
  Mixer,
  MixerOutput,
  MultichannelChannel,
  PulseOutput,
  RawFileOutput,
  RdioScannerConfig,
  RtlAirbandConfig,
  ScanChannel,
  UdpStreamOutput,
} from "@rtl-airband-panel/parser";

export function defaultPulseOutput(): PulseOutput {
  return { type: "pulse", server: "", sink: "", stream_name: "", continuous: false };
}

export function defaultFileOutput(): FileOutput {
  return {
    type: "file",
    directory: "",
    filename_template: "",
    continuous: false,
    split_on_transmission: true,
    min_rx_seconds: 1,
    include_freq: true,
    append: true,
    dated_subdirectories: true,
  };
}

export function defaultRdioScannerConfig(): RdioScannerConfig {
  return { server: "", port: 443, use_tls: true, api_key: "", talkgroup_id: 0 };
}

export function defaultRawFileOutput(): RawFileOutput {
  return {
    type: "rawfile",
    directory: "",
    filename_template: "",
    continuous: false,
    split_on_transmission: false,
    include_freq: true,
    append: true,
    dated_subdirectories: true,
  };
}

export function defaultIcecastOutput(): IcecastOutput {
  return { type: "icecast", server: "", port: 8000, mountpoint: "", username: "source", password: "" };
}

export function defaultUdpStreamOutput(): UdpStreamOutput {
  return { type: "udp_stream", dest_address: "", dest_port: "" };
}

export function defaultMixerOutput(): MixerOutput {
  return { type: "mixer", name: "" };
}

export function defaultChannel(): MultichannelChannel {
  return { freq: 0, afc: 0, modulation: "nfm", outputs: [defaultPulseOutput()] };
}

export function defaultScanChannel(): ScanChannel {
  return { freqs: [0], outputs: [defaultPulseOutput()] };
}

/** Rebuilds a device's channels array to match its mode when the mode toggle changes. */
export function channelsForMode(existing: Channel[], mode: "multichannel" | "scan" | undefined): Channel[] {
  if (mode === "scan") return [defaultScanChannel()];
  return existing.some((c) => "freqs" in c) ? [defaultChannel()] : existing;
}

/** Fields that only apply to a subset of device types; kept out of a device object once its type no longer uses them. */
const TYPE_SPECIFIC_FIELDS = ["serial", "index", "buffers", "num_buffers", "device_string", "channel", "antenna"] as const;

const FIELDS_BY_TYPE: Record<string, readonly (typeof TYPE_SPECIFIC_FIELDS)[number][]> = {
  rtlsdr: ["serial", "index", "buffers"],
  mirisdr: ["serial", "index", "num_buffers"],
  soapysdr: ["device_string", "channel", "antenna"],
};

/**
 * Strips device fields that don't apply to `newType` (e.g. `device_string`
 * when switching away from soapysdr), so switching types doesn't leave
 * stale, inapplicable values behind in the saved config.
 */
export function deviceForType(device: Device, newType: string): Device {
  const next: Device = { ...device, type: newType };
  const keep = new Set(FIELDS_BY_TYPE[newType] ?? []);
  for (const field of TYPE_SPECIFIC_FIELDS) {
    if (!keep.has(field)) delete next[field];
  }
  return next;
}

/** Strips device fields that don't apply to `newMode` (centerfreq is multichannel-only). */
export function deviceForMode(device: Device, newMode: Device["mode"]): Device {
  const next: Device = { ...device };
  if (newMode === "scan") delete next.centerfreq;
  return next;
}

export function defaultDevice(): Device {
  return {
    type: "rtlsdr",
    serial: "",
    gain: 0,
    centerfreq: 0,
    sample_rate: 0,
    correction: 0,
    channels: [defaultChannel()],
  };
}

export function defaultMixer(): Mixer {
  return { name: "", outputs: [] };
}

export function defaultConfig(): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "",
    localtime: true,
    devices: [defaultDevice()],
  };
}
