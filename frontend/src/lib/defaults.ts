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
