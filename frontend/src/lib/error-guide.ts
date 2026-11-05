import type { ErrorLogEvent } from "../api/client.js";
import { isMarker } from "./error-log.js";

export type GuideCategory =
  | "Service"
  | "SDR hardware"
  | "Streaming & outputs"
  | "Recording files"
  | "Frequency correction"
  | "Sockets & ports";

export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  "Service",
  "SDR hardware",
  "Frequency correction",
  "Streaming & outputs",
  "Recording files",
  "Sockets & ports",
];

/** One kind of problem the Errors page can show, with what usually causes it and how to fix it. */
export interface GuideEntry {
  /** Stable anchor: the key's entry is `guide-<id>`. */
  id: string;
  category: GuideCategory;
  title: string;
  /** One or two sentences: the tooltip on a matching event. */
  summary: string;
  causes: readonly string[];
  fixes: readonly string[];
  /** An event matches on its kind, its counter metric, or (log lines) its message. */
  match: { kinds?: readonly string[]; metrics?: readonly string[]; patterns?: readonly RegExp[] };
}

/**
 * The catalog, most specific first: an event gets the first entry that
 * matches. Message patterns are taken from the log lines rtl_airband (the
 * bundled fork), librtlsdr and systemd actually write.
 */
export const ERROR_GUIDE: readonly GuideEntry[] = [
  // ---- Service ----
  {
    id: "unit-failed",
    category: "Service",
    title: "Instance failed",
    summary: "rtl_airband exited with an error and systemd marked the unit failed. The log lines just before this one usually say why.",
    causes: [
      "An SDR couldn't be opened at startup (unplugged, wrong serial, or in use by another instance).",
      "A config value rtl_airband rejects at startup (the panel's validator catches most of these, but not a hand-edited file).",
      "A crash (segfault) or the system running out of memory.",
    ],
    fixes: [
      "Read the error lines logged just before this event (filter by this instance), or open the instance's Logs tab.",
      "Check the Hardware page: is every configured serial actually connected?",
      "Fix the cause, then start the instance from its page. systemd won't retry a failed unit forever.",
    ],
    match: { kinds: ["unit-failed"], patterns: [/Failed with result/i, /Main process exited, code=(exited|killed|dumped)/i] },
  },
  {
    id: "unit-stopped",
    category: "Service",
    title: "Instance stopped outside the panel",
    summary: "The unit went from running to stopped, and the panel didn't do it: someone ran systemctl stop, or the system is shutting down.",
    causes: ["`systemctl stop` (or a script) on the host.", "A system shutdown or reboot.", "Another tool managing the same unit."],
    fixes: ["If it wasn't intended, start the instance from its page.", "If something else manages these units, stop it from doing so: the panel expects to own them."],
    match: { kinds: ["unit-stopped"] },
  },
  {
    id: "unexpected-restart",
    category: "Service",
    title: "Restarted outside the panel",
    summary: "The instance started again without the panel asking: usually systemd's Restart= bringing it back after a crash.",
    causes: [
      "rtl_airband exited (crash, lost SDR, all receivers failed) and systemd restarted it.",
      "Someone ran `systemctl restart` on the host.",
    ],
    fixes: [
      "Look at the errors just before this marker: they're why it went down.",
      "Repeated restarts mean the cause persists; fix it rather than relying on Restart=.",
    ],
    match: { kinds: ["unexpected-restart"] },
  },

  // ---- Frequency correction ----
  {
    id: "auto-ppm-disabled",
    category: "Frequency correction",
    title: "auto_ppm stopped itself",
    summary: "auto_ppm's corrections made the frequency error worse, so it put the configured correction back and turned itself off until the next restart.",
    causes: [
      "A transmitter that's itself off-frequency was used as a reference.",
      "Different mobiles on one frequency disagreeing by a ppm or two, or low-band channels, where ordinary transmitter tolerance is several ppm.",
      "The configured correction is far from right, so measurements look inconsistent.",
      "Interference or a weak signal producing bad error readings.",
    ],
    fixes: [
      "Set the correction manually from the Hardware page's Frequency error reading, then restart the instance to re-arm auto_ppm.",
      "If mobiles keep moving it, set Auto PPM min voters to 2 so one transmitter can't. Below about 133 MHz, also consider raising Auto PPM deadband. Both need fork v7.3.0 or newer.",
    ],
    match: { patterns: [/auto_ppm disabled/i, /auto_ppm failed to set correction/i] },
  },
  {
    id: "auto-ppm-limit",
    category: "Frequency correction",
    title: "auto_ppm hit its limit",
    summary: "auto_ppm wants to move the correction further than auto_ppm_max_ppm allows, so it stops short.",
    causes: ["The dongle's real error is larger than the limit (common on non-TCXO dongles when cold).", "A bad reference transmitter."],
    fixes: [
      "Check the Frequency error on the Hardware page; if it's consistent, save a correction closer to it, or raise auto_ppm_max_ppm.",
      "A TCXO dongle drifts far less.",
    ],
    match: { patterns: [/auto_ppm wants/i] },
  },

  // ---- SDR hardware ----
  {
    id: "sdr-open-failed",
    category: "SDR hardware",
    title: "Couldn't open the SDR",
    summary: "rtl_airband couldn't open a configured SDR at startup, so the instance (or that device) didn't start.",
    causes: [
      "The dongle is unplugged, or its serial doesn't match the config.",
      "Another instance (or another program, like a dump1090) already has that dongle.",
      "The Linux DVB-T driver (dvb_usb_rtl28xxu) claimed the dongle first (\"usb_claim_interface error -6\").",
      "The user the unit runs as can't access the USB device (missing udev rule).",
    ],
    fixes: [
      "Compare the serial in the device's config with `rtl_test` output (or the Hardware page of another instance).",
      "Make sure each serial is used by exactly one instance.",
      "Blacklist the DVB driver: add `blacklist dvb_usb_rtl28xxu` to /etc/modprobe.d/ and unplug/replug the dongle.",
      "Install the rtl-sdr udev rules (or add the unit's user to the plugdev group).",
    ],
    match: {
      patterns: [
        /Failed to open (rtlsdr|SoapySDR) device/i,
        /device\(s\) failed to initialize/i,
        /All receivers failed/i,
        /usb_claim_interface/i,
        /Kernel driver is active/i,
        /No supported devices found/i,
      ],
    },
  },
  {
    id: "sdr-lost",
    category: "SDR hardware",
    title: "SDR stopped while running",
    summary: "An SDR stopped delivering samples and rtl_airband disabled it. Its channels go silent until the instance restarts.",
    causes: [
      "A USB reset or disconnect: loose cable, flaky hub, not enough power.",
      "The dongle overheating.",
    ],
    fixes: [
      "Check `dmesg` on the host for USB disconnect/reset messages at the same time.",
      "Use a powered USB hub and short cables; give dongles airflow.",
      "Restart the instance to bring the device back once the hardware is fixed.",
    ],
    match: { patterns: [/async read failed/i, /readStream failed/i, /Device #\d+ failed, disconnecting/i, /device is down/i] },
  },
  {
    id: "tuner-setting-failed",
    category: "SDR hardware",
    title: "Tuner rejected a setting",
    summary: "The SDR refused a gain, frequency, sample rate, bandwidth or correction value.",
    causes: [
      "A value the tuner doesn't support (a sample rate or bandwidth outside its range).",
      "A flaky dongle or USB connection (the same setting works after a replug).",
    ],
    fixes: [
      "Use a sample rate the device supports (2.4 MHz or less is safe on rtl-sdr).",
      "For gain, pick one of the tuner's steps (the Hardware page shows the gain actually applied).",
      "If a frequency-hopping scan logs an occasional failed retune, it retries on the next hop; many in a row point at the hardware.",
    ],
    match: {
      patterns: [
        /Failed to (set|initialize|apply|disable|activate|read supported|find a suitable) .*(gain|freq|frequency|centerfreq|sample[ _]rate|bandwidth|correction|AGC|antenna|stream|sample formats)/i,
        /Failed to retune/i,
        /Failed to set up stream/i,
        /no supported sample format/i,
        /failed to read supported sampling rate/i,
        /Failed do stop device/i,
      ],
    },
  },
  {
    id: "buffer-overflow",
    category: "SDR hardware",
    title: "Dropped samples (buffer overflows)",
    summary: "rtl_airband couldn't process samples as fast as the SDR delivered them, so some were lost: audio gaps and glitches.",
    causes: [
      "Not enough CPU for the number of channels and the sample rate.",
      "Several dongles sharing one USB controller.",
      "Another process on the host using the CPU in bursts.",
    ],
    fixes: [
      "Lower the device's sample_rate, or move some channels to another SDR/instance.",
      "Spread dongles across USB controllers (check `lsusb -t`).",
      "Check host load (`top`) while the overflows happen.",
    ],
    match: { metrics: ["buffer_overflow_count"], patterns: [/buffer overflow/i] },
  },
  {
    id: "outside-bandwidth",
    category: "SDR hardware",
    title: "Channel outside the SDR's span",
    summary: "A channel's frequency doesn't fit in the band the SDR captures, so it receives nothing.",
    causes: ["The channel is further from centerfreq than half the sample rate (minus a margin for the filter roll-off)."],
    fixes: ["Move centerfreq closer, raise sample_rate, or put the channel on another SDR. The editor's validation shows the usable window."],
    match: { patterns: [/outside of SDR operating bandwidth/i] },
  },

  // ---- Streaming & outputs ----
  {
    id: "icecast",
    category: "Streaming & outputs",
    title: "Icecast connection problems",
    summary: "An Icecast output lost its connection or couldn't connect. rtl_airband keeps retrying, but listeners hear nothing meanwhile.",
    causes: [
      "The Icecast server is down or unreachable (network, firewall, DNS).",
      "Wrong server, port, mountpoint, username or password.",
      "The mountpoint is already in use by another source.",
      "Not enough upstream bandwidth (\"Exceeded max backlog\").",
      "A metadata message means only a stream title update failed (send_tx_tags or send_scan_freq_tags). Audio keeps flowing, but the same server or credential checks apply.",
    ],
    fixes: [
      "Check the server is up and reachable from this host (`curl http://server:port/`).",
      "Re-check the output's server, port, mountpoint and credentials in the editor.",
      "Make sure no other instance or channel streams to the same mountpoint.",
      "Lower the bitrate if the uplink is slow.",
    ],
    match: {
      metrics: ["icecast_disconnect_count"],
      patterns: [/Lost connection to/i, /Could not connect to/i, /Exceeded max backlog/i, /Closing connection to/i, /shout metadata/i, /Icecast metadata for /i],
    },
  },
  {
    id: "mp3-encode",
    category: "Streaming & outputs",
    title: "MP3 encoding failed",
    summary: "The MP3 encoder (LAME) failed, so some audio wasn't encoded.",
    causes: ["The host is short on memory.", "An unusual bitrate/sample-rate combination."],
    fixes: ["Check free memory.", "Use a standard bitrate (e.g. 16–64 kbps) on the affected outputs."],
    match: { metrics: ["lame_encode_failure_count"], patterns: [/lame_/i, /lamebuf/i, /LameTone/i] },
  },
  {
    id: "output-overrun",
    category: "Streaming & outputs",
    title: "Outputs falling behind",
    summary: "Audio or transmission tags arrived faster than an output could take them, so some were dropped.",
    causes: [
      "On rtl_airband builds older than fork v7.2.0, RTL-SDR dongles below 2.56 Msps deliver audio in bursts that outrun the outputs. This was the main cause on 1.024 Msps instances, even with fast disks.",
      "On builds older than fork v7.4.1, stream title updates (send_tx_tags, send_scan_freq_tags) and stats file writes ran on the output thread. A slow Icecast server, or a filesystem frozen by a VM backup, dropped audio on every output sharing that thread.",
      "A slow disk or network output holding everything up.",
      "The host is overloaded.",
    ],
    fixes: [
      "Run the bundled rtl_airband (fork v7.4.1 or newer) and leave the device's USB transfer size blank.",
      "Look for file-write or streaming errors at the same time: they're usually the cause.",
      "Check host load and disk speed.",
    ],
    match: { metrics: ["output_overrun_count"], patterns: [/queue overrun/i] },
  },
  {
    id: "udp-stream",
    category: "Streaming & outputs",
    title: "UDP stream problems",
    summary: "A UDP stream output couldn't send, or dropped packets.",
    causes: ["The destination host name doesn't resolve.", "A packet larger than the output's buffer."],
    fixes: ["Check the output's destination address and port.", "If packets are dropped for size, report it with the output's settings."],
    match: { metrics: ["udp_stream_dropped_packet_count"], patterns: [/udp_stream:/i] },
  },
  {
    id: "pulse",
    category: "Streaming & outputs",
    title: "PulseAudio problems",
    summary: "A PulseAudio output couldn't connect to the sound server, or lost it.",
    causes: [
      "The bundled rtl_airband is built without PulseAudio: pulse outputs need your own build.",
      "The PulseAudio server isn't running or isn't reachable by the unit's user.",
    ],
    fixes: ["Check the server address on the output.", "Make sure the PulseAudio server accepts connections from the user the instance runs as."],
    match: { metrics: ["pulse_disconnect_count"], patterns: [/pulse: /i] },
  },
  {
    id: "rdio-scanner",
    category: "Streaming & outputs",
    title: "rdio-scanner upload problems",
    summary: "Recordings couldn't be uploaded to rdio-scanner, or the upload queue overflowed and dropped some.",
    causes: [
      "Wrong server URL or API key.",
      "The rdio-scanner server is down or unreachable.",
      "An outage long enough to fill the upload queue.",
    ],
    fixes: [
      "Check the output's URL and API key (the HTTP status in the log line helps: 401/403 means the key, 404 the URL).",
      "Make sure the system/talkgroup IDs exist in rdio-scanner.",
      "Check the server is reachable from this host.",
    ],
    match: { metrics: ["rdio_scanner_upload_failure_count", "rdio_scanner_queue_drop_count"], patterns: [/rdio_scanner:/i] },
  },

  // ---- Recording files ----
  {
    id: "file-write",
    category: "Recording files",
    title: "Can't write recordings",
    summary: "A file output couldn't create or write its recordings, and may have disabled itself.",
    causes: [
      "The directory doesn't exist, or the user the instance runs as can't write to it.",
      "The disk is full.",
      "A network mount went away.",
    ],
    fixes: [
      "Create the directory and give the instance's user write access (`ls -ld <dir>`).",
      "Check free space (`df -h`).",
      "Restart the instance once fixed: a disabled output stays off until then.",
    ],
    match: {
      metrics: ["file_write_failure_count"],
      patterns: [
        /Cannot (write to|open output file)/i,
        /Could not (create directory|rename|delete)/i,
        /Problem writing/i,
        /Short write/i,
        /dated subdirectory/i,
        /Output disabled/i,
        /post_write_script/i,
      ],
    },
  },

  // ---- Sockets & ports ----
  {
    id: "control-socket",
    category: "Sockets & ports",
    title: "Control socket problems",
    summary: "The control socket (live readings and Apply live) couldn't start, or refused the panel.",
    causes: [
      "The unit runs as a different user from the panel (\"rejected connection from a different uid\").",
      "The socket's directory doesn't exist or isn't writable, or the path is too long.",
    ],
    fixes: [
      "Make the instance's unit run as the panel's user (User=/Group=); the instance page's Service account section shows it.",
      "Check control_socket_path points into a directory that exists and that user can write.",
    ],
    match: { patterns: [/control_socket:/i] },
  },
  {
    id: "port-in-use",
    category: "Sockets & ports",
    title: "Stats or mixer socket couldn't start",
    summary: "stats_http or mixer_remote couldn't bind its port or socket path.",
    causes: ["Another instance (or program) already uses the same port or path.", "An invalid bind address."],
    fixes: ["Give each instance its own stats_http port and mixer_remote paths.", "Check what holds the port: `ss -ltnp | grep <port>`."],
    match: { patterns: [/stats_http:/i, /mixer_remote:/i] },
  },

  // Last: a catch-all for crash lines, so a more specific entry wins first.
  {
    id: "crash",
    category: "Service",
    title: "Crash or out of memory",
    summary: "rtl_airband crashed or ran out of memory.",
    causes: [
      "The host is short on memory (many channels with MP3 outputs on a small board).",
      "A bug in rtl_airband.",
    ],
    fixes: [
      "Check free memory (`free -h`) and whether other services are using it.",
      "Reduce the load: fewer channels or outputs per instance, lower bitrates.",
      "If it repeats with enough memory, report it with the log lines around the crash and the instance's config (with credentials removed).",
    ],
    match: { patterns: [/out of memory/i, /segmentation fault|segfault|core[- ]dump|\/SEGV|\/ABRT/i, /calloc\(|realloc\(/] },
  },
];

const metricOf = (e: ErrorLogEvent): string | null => (typeof e.detail?.metric === "string" ? e.detail.metric : null);

/** The guide entry for an event, or null for restart markers and anything the catalog doesn't cover. */
export function guideFor(e: ErrorLogEvent): GuideEntry | null {
  if (isMarker(e) && e.kind !== "unexpected-restart") return null;
  const metric = metricOf(e);
  for (const entry of ERROR_GUIDE) {
    const m = entry.match;
    if (m.kinds?.includes(e.kind)) return entry;
    if (e.kind === "counter" && metric && m.metrics?.includes(metric)) return entry;
    if (e.kind === "log" && m.patterns?.some((p) => p.test(e.message))) return entry;
  }
  return null;
}

/** How many of these events each guide entry covers, by entry id. */
export function guideCounts(events: readonly ErrorLogEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    const g = guideFor(e);
    if (g) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
  }
  return counts;
}
