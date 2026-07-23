/**
 * Plain-language descriptions for config-page field tooltips, based on
 * RTLSDR-Airband's wiki. Labels already show units/defaults inline; these
 * focus on behavior and "why", not restating what's in the label.
 */

export const GLOBAL_TOOLTIPS = {
  statsFilepath:
    "Path to a file RTLSDR-Airband writes periodic channel usage statistics to (squelch opens, signal levels, buffer overruns). Blank disables stats output entirely.",
  fftSize:
    "Number of FFT bins used to channelize each device's captured bandwidth. Larger values give finer frequency resolution (narrower bins) but cost more CPU. Must be a power of two.",
  pidfile: "Where the process writes its PID when run as a background daemon. Irrelevant when run under systemd as a 'simple' service type, since systemd tracks the PID itself.",
  shoutMetadataDelay:
    "Seconds to wait after switching frequency (in scan mode) before pushing the Icecast metadata update, to give streaming clients time to buffer the new audio before the title changes.",
  tau: "NFM de-emphasis time constant in microseconds. Higher values attenuate high audio frequencies more aggressively, reducing hiss. 0 disables de-emphasis. Applies globally unless overridden per device or channel.",
  multipleDemodThreads: "Runs demodulation for each device on its own thread instead of one shared thread. Improves throughput on multi-core systems with several busy devices.",
  multipleOutputThreads: "Runs each output (MP3 encode, Icecast stream, etc.) on its own thread instead of one shared thread. Improves throughput when several outputs are active.",
  localtime: "Use the local timezone for output filename timestamps and logs instead of UTC.",
  logScanActivity: "Logs when a scan-mode channel's squelch opens/closes and which frequency it was on, useful for tuning squelch thresholds.",
} as const;

export const DEVICE_TOOLTIPS = {
  type: "The SDR hardware/driver family. Determines which of the fields below apply — SoapySDR devices are identified by a device string rather than serial/index, for example.",
  mode: "Multichannel mode demodulates several fixed frequencies from one captured window simultaneously. Scan mode retunes the dongle to hop between a list of frequencies one at a time, so they can be arbitrarily far apart.",
  serial: "The dongle's USB serial number. Preferred over index because it stays stable across reboots even if USB enumeration order changes.",
  index: "Which detected dongle to use, in USB enumeration order, starting at 0. Only matters if serial isn't set — and enumeration order can change across reboots.",
  gain: "Tuner gain in dB. Higher values amplify weak signals but also amplify noise; too high can clip on strong signals nearby.",
  gainSoapy:
    "A single gain value in dB, or a comma-separated list of 'component=value' pairs for devices with multiple gain stages (e.g. 'LNA=32,VGA=20'). Leave blank to enable automatic gain control (AGC) instead.",
  centerfreq:
    "The frequency the dongle is tuned to; all of this device's channels are demodulated from the bandwidth captured around it. Only used in multichannel mode — in scan mode the dongle retunes to each scanned frequency instead.",
  sampleRate: "How much bandwidth around centerfreq is captured, in Hz. Determines both the usable channel window and the width of each FFT bin (together with FFT size).",
  correctionPpm: "Frequency tuning error correction, in parts-per-million. Positive if the dongle tunes too high, negative if it tunes too low.",
  correctionHz: "Frequency tuning error correction, in Hz. Positive if the receiver tunes too high, negative if it tunes too low.",
  tauDevice: "Overrides the global NFM de-emphasis time constant for every channel on this device, unless a channel sets its own.",
  buffers: "Number of USB transfer buffers to allocate. Rarely needs changing; increase only if you're seeing buffer overflow warnings in stats.",
  numBuffers: "Number of USB transfer buffers to allocate. Rarely needs changing; increase only if you're seeing buffer overflow warnings in stats.",
  deviceString: "Identifies the physical device and driver to SoapySDR, as comma-separated 'variable=value' stanzas (e.g. driver, serial number). Required — this is how SoapySDR devices are selected, in place of serial/index.",
  channel: "Which physical receive channel on the device to use, for devices with more than one (most single-tuner dongles only have channel 0).",
  antenna: "Selects which antenna port to use, for devices with more than one. Leave blank to use the device's default port.",
  disable: "Ignores this device entirely, as if it weren't in the config at all. Useful for temporarily disabling hardware that isn't currently connected without deleting its configuration.",
} as const;

export const CHANNEL_TOOLTIPS = {
  freq: "The frequency this channel demodulates, chosen from the FFT bin closest to it within the device's captured window.",
  freqs: "The list of frequencies to scan, in order. The dongle retunes between them one at a time, so they can be arbitrarily far apart — unlike multichannel mode's single shared window.",
  label: "A name or description for this channel, used in logs and Icecast metadata.",
  labels: "A description for each scanned frequency, in the same order as the frequency list. Replaces raw frequency numbers in Icecast metadata and logs when set.",
  modulation: "Demodulation scheme: nfm for narrowband FM (most land-mobile/analog trunking), am for amplitude modulation (most aviation and some marine bands).",
  modulations: "Sets modulation separately per scanned frequency, in the same order as the frequency list. Overrides the single Modulation setting above when present.",
  afc: "Automatic frequency correction: when enabled, switches to an adjacent FFT bin if it has stronger signal than the configured one, compensating for slight frequency drift.",
  bandwidth: "Applies an additional lowpass filter to the channelized signal before demodulation, centered at 0 Hz (so a value of 8000 keeps ±4000 Hz). Rejects interference from neighboring channels and reduces hiss. Leave blank for RTLSDR-Airband's default filtering.",
  ampfactor: "Volume multiplier for this channel's audio. Values between 0 and 1 attenuate (quieter), values above 1 amplify (louder).",
  ctcss: "Only opens squelch when this sub-audible tone (Hz) is present in the audio, even if the signal itself is strong enough. Doesn't remove the tone from the output audio — pair with a matching Notch filter for that. In a scan-mode list, 0.0 disables CTCSS for that specific frequency.",
  notch: "Frequency (Hz) of a narrowband notch filter used to cancel out a specific interfering tone (e.g. a CTCSS tone you don't want audible). In a scan-mode list, 0.0 keeps the default (no notch) for that frequency.",
  notchQ: "Selectivity (Q factor) of the notch filter — higher values make the filter narrower, affecting less of the surrounding audio spectrum.",
  squelchThreshold: "Manually fixes the squelch open level in dBFS (0 = full scale, so this is always negative), instead of RTLSDR-Airband's automatic noise-floor estimation. Useful for channels with continuous transmission (ATIS, AWOS) where auto squelch would never close. In a scan-mode list, 0 means 'use auto squelch' for that frequency.",
  squelchSnrThreshold: "Manually fixes the squelch open level as signal-to-noise ratio in dB above the estimated noise floor, instead of the ~10 dB RTLSDR-Airband uses automatically. In a scan-mode list, 0 keeps squelch open continuously and -1.0 (the only negative value allowed) leaves that frequency at the default threshold.",
  highpass: "MP3 encoder highpass filter cutoff, in Hz. Cuts low-frequency rumble/hum from the encoded audio. 0 disables it.",
  lowpass: "MP3 encoder lowpass filter cutoff, in Hz. Cuts high-frequency hiss from the encoded audio. 0 disables it.",
  tauChannel: "Overrides the device/global NFM de-emphasis time constant for this specific channel.",
  disable: "Ignores this channel entirely, as if it weren't in the config at all. The device it belongs to still needs at least one other non-disabled channel.",
} as const;

export const OUTPUT_TOOLTIPS = {
  pulseServer: "PulseAudio server address to connect to. Leave blank to use PulseAudio's default server.",
  pulseSink: "PulseAudio sink (output device) to play through. Leave blank to use the default sink.",
  pulseName: "The application name PulseAudio shows for this stream. Defaults to 'rtl_airband'.",
  streamName: "The PulseAudio stream's display name. Auto-generated from the channel frequency if left blank.",
  continuous: "Keeps the output actively writing/streaming even when squelch is closed (silence), instead of only during active transmissions.",
  fileDirectory: "Directory recordings are written into. Created if it doesn't already exist.",
  filenameTemplate: "Base filename for recordings (without extension) — combined with a timestamp unless split_on_transmission changes that.",
  minRxSeconds: "Minimum transmission length, in seconds, to keep as a separate file when split_on_transmission is enabled. Shorter transmissions are discarded.",
  postWriteScript: "A script to run after each file is finished writing, given the file path as an argument — useful for uploading, transcoding, or notifications.",
  splitOnTransmission: "Starts a new file for each individual transmission (squelch open-to-close) instead of one continuously-appended file.",
  includeFreq: "Includes the channel's frequency in the output filename.",
  append: "Appends to an existing file with the same name instead of overwriting it.",
  datedSubdirectories: "Organizes recordings into subdirectories by date instead of dropping them all in one flat directory.",
  icecastServer: "Hostname or IP address of the Icecast server to stream to.",
  port: "TCP port the Icecast server is listening on.",
  mountpoint: "The mountpoint path on the Icecast server this stream is published under (e.g. /tower.mp3).",
  username: "Icecast source username — typically 'source' unless the server is configured otherwise.",
  password: "Icecast source password, matching the server's configured source password for this mountpoint.",
  icecastName: "Stream title shown to listeners/directory listings.",
  genre: "Stream genre metadata shown to listeners/directory listings.",
  description: "Stream description metadata shown to listeners/directory listings.",
  sendScanFreqTags: "In scan mode, updates the stream's title metadata to the current frequency (or its label, if set) each time the scanner changes frequency. Has no effect in multichannel mode.",
  tls: "Enables TLS for the Icecast connection, if RTLSDR-Airband was built with libshout TLS support. Leave as default (disabled) otherwise.",
  destAddress: "Destination host or IP address the raw audio/metadata stream is sent to.",
  destPort: "Destination UDP port, as a number or a named service (e.g. '5005' or a service name from /etc/services).",
  mixerName: "The name of the top-level mixer definition this output routes audio into. Must match a mixer's Name field exactly.",
  mixerAmpfactor: "Volume multiplier applied to this channel's contribution to the mixer. Defaults to 1.0.",
  balance: "Stereo balance of this channel's contribution to the mixer, from -1.0 (full left) to 1.0 (full right). Defaults to 0.0 (centered).",
  disable: "Ignores this output entirely, as if it weren't configured. The channel it belongs to still needs at least one other non-disabled output.",
  rdioScannerEnabled: "Uploads each completed transmission to a rdio-scanner (https://github.com/chuot/rdio-scanner) instance's call-upload API. Requires split_on_transmission and a build with -DRDIO_SCANNER=ON.",
  rdioScannerServer: "Hostname or IP address of the rdio-scanner instance's API server.",
  rdioScannerPort: "TCP port the rdio-scanner API is listening on.",
  rdioScannerUseTls: "Connects to the rdio-scanner API over HTTPS instead of plain HTTP. Defaults to false.",
  rdioScannerApiKey: "API key configured on the rdio-scanner instance for this system's call-upload access.",
  rdioScannerSystemId: "The rdio-scanner system ID this upload belongs to. Defaults to unset (-1) when absent.",
  rdioScannerSystemLabel: "Optional display label for the system, shown in the rdio-scanner UI.",
  rdioScannerTalkgroupId: "The rdio-scanner talkgroup ID this upload belongs to.",
  rdioScannerTalkgroupLabel: "Optional display label for the talkgroup, shown in the rdio-scanner UI.",
  rdioScannerTalkgroupTag: "Optional short tag for the talkgroup (e.g. its category), shown in the rdio-scanner UI.",
  rdioScannerTalkgroupGroup: "Optional group name the talkgroup belongs to, shown in the rdio-scanner UI.",
  rdioScannerSourceId: "Optional radio/source ID to attribute the call to. Defaults to 0 when absent.",
  rdioScannerDeleteAfterUpload: "Deletes the local MP3 file after a successful upload. A failed upload never deletes the file, even when this is enabled.",
  rdioScannerTimeoutMs: "How long to wait for the rdio-scanner API to respond before treating the upload as failed, in milliseconds. Defaults to 5000.",
  rdioScannerMaxRetries: "How many times to retry a failed upload before giving up. Defaults to 2.",
} as const;

export const MIXER_TOOLTIPS = {
  name: "The identifier channel outputs of type 'mixer' reference to route their audio here.",
  highpass: "MP3 encoder highpass filter cutoff, in Hz, applied to the mixed-down audio. 0 disables it.",
  lowpass: "MP3 encoder lowpass filter cutoff, in Hz, applied to the mixed-down audio. 0 disables it.",
  disable: "Ignores this mixer entirely, as if it weren't configured. Any channel output still pointed at it will fail validation.",
} as const;
