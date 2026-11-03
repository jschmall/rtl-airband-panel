//! Fix guidance for every validation issue code, shown next to the issue
//! in the editor: `summary` as a tooltip, `detail` when the user expands it.
//! The issue's own message carries the specifics (which values, which bin);
//! these say what it means and how to fix it. A test keeps this table in
//! step with the codes the checks emit, and exports it to the frontend.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IssueHint {
    pub code: &'static str,
    /// One sentence: the fix.
    pub summary: &'static str,
    /// Why it matters and how to fix it, in a few sentences.
    pub detail: &'static str,
}

const fn h(code: &'static str, summary: &'static str, detail: &'static str) -> IssueHint {
    IssueHint { code, summary, detail }
}

/// Looks up the hint for an issue code.
pub fn issue_hint(code: &str) -> Option<&'static IssueHint> {
    ISSUE_HINTS.iter().find(|hint| hint.code == code)
}

pub const ISSUE_HINTS: &[IssueHint] = &[
    // --- Top-level settings ---
    h(
        "fft-size-invalid",
        "Set FFT size to a power of two between 256 and 8192 (e.g. 512, 1024, 2048), or leave it blank for 512.",
        "rtl_airband refuses to start with any other FFT size. Bigger values give narrower FFT bins (sample rate ÷ FFT size), which helps channels that sit close together, at the cost of more CPU.",
    ),
    h(
        "shout-metadata-delay-out-of-range",
        "Set Shout metadata delay to a whole number of seconds from 0 to 32, or leave it blank for the default of 3.",
        "The delay is capped by the size of rtl_airband's tag queue, and it won't start with a value outside 0-32.",
    ),
    h(
        "stats-http-address-and-port-must-be-set-together",
        "Fill in both Stats HTTP address and Stats HTTP port, or clear both.",
        "The stats HTTP endpoint needs an address to bind and a port to listen on, so rtl_airband rejects a config that sets only one. Use 0.0.0.0 to listen on every interface, or 127.0.0.1 for this machine only. The endpoint serves the stats file, so Stats filepath must also be set.",
    ),
    h(
        "stats-http-port-out-of-range",
        "Use a TCP port from 1 to 65535 that nothing else on this machine is using.",
        "Ports below 1024 need root, and generated instance units run as the panel's user, so a port of 1024 or above is the safe choice.",
    ),
    h(
        "control-socket-path-empty",
        "Enter a path for the control socket (e.g. /run/rtl_airband/<instance>.sock) or clear the field.",
        "A blank path isn't treated as unset. rtl_airband needs a real path to create the socket that the panel's Apply live uses. Each instance needs its own path, in a directory the unit's Service user can write to.",
    ),
    h(
        "stats-update-interval-non-positive",
        "Set stats_update_interval to a number of seconds greater than 0, or remove it to use the default.",
        "It sets how often rtl_airband rewrites the stats file. rtl_airband rejects 0 or a negative value at startup.",
    ),
    h(
        "split-file-times-invalid",
        "Make split_min_file_time at least 1, split_max_file_time larger than split_min_file_time, and split_max_idle_time larger than 0.",
        "These settings control how split_on_transmission cuts recordings into files: the shortest file, the longest file, and how long silence can last before a file is closed. When set on an output they override the global values, and any setting left out falls back to the global value (or the default). rtl_airband refuses to start if the combined values don't meet all three rules.",
    ),
    h(
        "split-tx-drop-invalid",
        "Set split_tx_drop_shorter_than to 0 (keep every recording) or to a number of seconds below split_max_file_time.",
        "Split recordings of a transmission shorter than this are deleted instead of kept, which filters out key-ups and noise bursts. It's compared with the longest file length, so it has to be smaller than split_max_file_time (the output's own value, else the global one, else 3600). rtl_airband refuses to start otherwise.",
    ),
    h(
        "unknown-setting-preserved",
        "Nothing needs fixing unless the setting is a typo. Check its name against the RTLSDR-Airband docs.",
        "The panel only edits settings it models. Anything else is written back exactly as it was. If the name is misspelled, rtl_airband may ignore it or refuse to start. If it's a real setting the panel doesn't model yet, it keeps working, but you can only change it by editing the .conf file directly.",
    ),
    h(
        "needs-fork-feature",
        "Run this instance on the bundled jschmall/RTLSDR-Airband build, or remove the setting.",
        "This instance's rtl_airband build doesn't have the feature this setting needs, so the setting is ignored (for a mixer_remote output, rtl_airband won't start at all). New instances use the bundled fork build automatically. An existing instance keeps whatever binary its systemd unit's ExecStart runs.",
    ),
    // --- Devices ---
    h(
        "device-type-unsupported",
        "Choose rtlsdr or soapysdr as the device type (mirisdr only works on older rtl_airband builds).",
        "rtl_airband only has drivers for these types and won't start with any other type. Most USB dongles are rtlsdr. Use soapysdr for anything else SoapySDR supports (Airspy, HackRF, SDRplay…). The bundled build has SoapySDR turned off, so a soapysdr device needs an rtl_airband you've built yourself. mirisdr was removed in upstream v7.0.0 (fork v7.1.0), so it only works with an older build.",
    ),
    h(
        "device-gain-required",
        "Set a gain for this device (e.g. 25 dB), and adjust it later while watching signal levels.",
        "rtl_airband needs a fixed gain for rtlsdr (and mirisdr) devices. Only soapysdr devices can leave it out (to use AGC). Start in the middle of the tuner's range and turn it down if strong nearby signals overload the dongle (noise rises across the whole band).",
    ),
    h(
        "device-string-required",
        "Enter a Device string such as driver=rtlsdr,serial=00000001 or driver=airspy.",
        "A soapysdr device is chosen by its SoapySDR device string, not by serial or index. Run SoapySDRUtil --find on this machine to list devices and their strings.",
    ),
    h(
        "device-centerfreq-required",
        "Set Center frequency to a value near the middle of this device's channels, or switch the device to scan mode.",
        "In multichannel mode the dongle stays on one center frequency and demodulates every channel inside the captured window around it. Each channel must be within about ±45% of the sample rate of the center frequency.",
    ),
    h(
        "device-serial-or-index-required",
        "Set the dongle's Serial (preferred) or its Index.",
        "rtl_airband needs to know which dongle to open. A serial survives reboots and USB re-plugging, while an index can change. Run rtl_test or rtl_eeprom to see serials, and use rtl_eeprom -s to give dongles unique serials if they share one.",
    ),
    h(
        "device-sample-rate-too-low",
        "Raise the sample rate well above 16000 Hz (typical rtlsdr values are 1,024,000 to 2,560,000), or leave it blank for 2,560,000.",
        "rtl_airband demodulates audio at 16 kHz, so the device must capture faster than that. In multichannel mode the sample rate also sets how wide a band the channels can be spread across.",
    ),
    h(
        "device-sample-rate-unsupported",
        "Pick a sample rate from 225,001 to 300,000 Hz or from 900,001 to 3,200,000 Hz (2,400,000 or 2,560,000 are safe choices).",
        "librtlsdr can't run RTL2832U dongles between 300,001 and 900,000 Hz and fails when the device opens. Above about 2.4-2.56 MHz many dongles start dropping samples.",
    ),
    h(
        "device-buffers-invalid",
        "Set Buffers to 1 or more, or leave it blank for the default.",
        "This is how many USB transfer buffers rtl_airband keeps for the dongle. Left blank, fork v7.2.0 and newer pick enough to keep about 3.2 MB in flight whatever the transfer size; older builds use 10.",
    ),
    h(
        "device-buffer-size-invalid",
        "Use a multiple of 512 bytes up to 16777216, or leave USB transfer size blank to let rtl_airband size it.",
        "librtlsdr needs USB transfers in 512-byte multiples, and rtl_airband won't start with any other value. Left blank, fork v7.2.0 and newer size each transfer to half an audio batch (62.5 ms) for the sample rate. 320000 with Buffers 10 restores the old fixed sizing.",
    ),
    h(
        "device-num-buffers-invalid",
        "Set Num buffers to 1 or more, or leave it blank for the default of 10.",
        "mirisdr devices (on builds older than upstream v7.0.0, which still have that driver) need at least one sample buffer to stream into.",
    ),
    h(
        "device-driver-not-built",
        "Change the device type, or point this instance at an rtl_airband built with this driver.",
        "A fork build lists the optional drivers it was compiled with on its -v Features line, and this one doesn't have the driver for this device's type, so rtl_airband won't start. The bundled build has rtlsdr only: SoapySDR is turned off, and upstream v7.0.0 (fork v7.1.0) removed mirisdr. Build rtl_airband yourself with the driver and set the instance's binary to it, or disable this device.",
    ),
    h(
        "auto-ppm-settings-ignored",
        "Turn on Automatic PPM correction (or add auto_ppm = false to set it up), or remove the auto_ppm_* settings.",
        "rtl_airband only reads auto_ppm_interval, auto_ppm_max_ppm and auto_ppm_max_step when the device has an auto_ppm setting, so without one they do nothing.",
    ),
    h(
        "auto-ppm-driver-unsupported",
        "Remove auto_ppm from this device; only rtlsdr devices support it.",
        "Automatic PPM correction needs a driver that can read back and change the correction while running, which only rtlsdr has. rtl_airband won't start with auto_ppm on any other device type, even when it's set to false.",
    ),
    h(
        "auto-ppm-param-out-of-range",
        "Use a whole number in range: interval 5-86400 seconds, max ppm 1-100, max step 1-100. Leave blank for the defaults (30, 100, 5).",
        "The interval is how often auto_ppm re-measures, max ppm caps the correction it may ever set, and max step caps one adjustment. rtl_airband refuses to start with a value outside these limits.",
    ),
    h(
        "auto-ppm-correction-outside-limit",
        "Bring Correction within ±auto_ppm_max_ppm, or raise auto_ppm_max_ppm (up to 100).",
        "With auto_ppm set (on or off), the configured correction is where auto_ppm starts, and it may never go past auto_ppm_max_ppm. rtl_airband refuses to start if the starting correction is already outside that limit.",
    ),
    h(
        "device-reserve-channels-negative",
        "Set Reserve channels to 0 or more, or leave it blank.",
        "Reserve channels sets aside empty channel slots, so channels can be added later with Apply live instead of a restart. It can't be negative.",
    ),
    h(
        "device-reserve-channels-scan-unsupported",
        "Clear Reserve channels on this device, or set it to 0.",
        "A scan-mode device always has exactly one channel, so there's nothing to reserve. To scan more frequencies, add them to that channel's frequency list.",
    ),
    h(
        "device-bandwidth-negative",
        "Set Tuner bandwidth to 0 or leave it blank for automatic, or enter a positive bandwidth in Hz.",
        "This sets the tuner's IF filter width. Automatic (0) is right for almost every setup. A narrower filter can reject a strong signal just outside your channels.",
    ),
    h(
        "frequency-out-of-window",
        "Move the device's Center frequency toward the middle of its channels, raise the sample rate, or move this channel to another device.",
        "A device only hears about ±45% of its sample rate around its center frequency (±1.152 MHz at the default 2.56 MSPS), and the edges of that range are filtered off. rtl_airband starts anyway, but this channel will be faint or silent. If the channels are too far apart to fit in one window, split them across dongles or use scan mode.",
    ),
    h(
        "fft-bin-collision",
        "Raise FFT size (to narrow the bins) or nudge the device's Center frequency so the two channels land in different FFT bins.",
        "rtl_airband picks out each channel by the FFT bin its frequency falls in. Each bin is sample rate ÷ FFT size wide (5 kHz at the defaults). Two different frequencies in the same bin both get the audio of whichever one the bin centers on. rtl_airband doesn't detect this itself, so the panel blocks the save. Doubling FFT size halves the bin width. Moving the center frequency by half a bin also often separates them.",
    ),
    h(
        "scan-mode-single-channel",
        "Merge this device's channels into one scan channel with every frequency in its list, or switch the device to multichannel mode.",
        "A scan-mode device retunes the dongle from frequency to frequency, so it only ever demodulates one channel. All the frequencies to scan go in that one channel's Frequencies list.",
    ),
    h(
        "scan-mode-channel-shape-mismatch",
        "Make the device mode match its channels: scan mode with one channel that has a list of frequencies, or multichannel mode with single-frequency channels.",
        "Scan-mode channels have a list of frequencies (freqs) and multichannel channels have one frequency (freq). rtl_airband rejects a config that mixes the two. Change the device's Mode, or recreate the channel as the other kind.",
    ),
    h(
        "scan-freqs-empty",
        "Add at least one frequency to this scan channel's Frequencies list.",
        "A scan channel with no frequencies has nothing to tune to, and rtl_airband won't start.",
    ),
    h(
        "scan-list-too-short",
        "Give this list one entry per scanned frequency, in the same order as Frequencies, or use a single value that applies to all of them.",
        "In scan mode, lists such as labels, modulations, squelch and CTCSS are matched to Frequencies by position. rtl_airband refuses to start if a list is shorter than the frequency list.",
    ),
    h(
        "scan-list-too-long",
        "Remove the extra entries at the end so the list matches Frequencies one-to-one.",
        "Entries past the last frequency are never used. This usually means a frequency was removed but its label or setting wasn't, which can also leave the remaining entries out of step with their frequencies.",
    ),
    h(
        "no-active-outputs",
        "Add an output to this channel, re-enable one, or disable the channel.",
        "rtl_airband refuses to start if a channel has nowhere to send its audio. Every enabled channel needs at least one output that isn't disabled.",
    ),
    h(
        "no-active-channels",
        "Add a channel to this device, re-enable one, or disable the device.",
        "rtl_airband refuses to start if an enabled device has no enabled channels.",
    ),
    h(
        "no-active-devices",
        "Add a device, or re-enable at least one.",
        "rtl_airband needs at least one device that isn't disabled. To take the whole instance offline, stop its service instead.",
    ),
    h(
        "no-active-mixer-outputs",
        "Add an output to this mixer, re-enable one, or disable the mixer.",
        "rtl_airband refuses to start if an enabled mixer has nowhere to send its mixed audio. If you disable the mixer, also remove or disable the channel outputs that route into it.",
    ),
    // --- Channels ---
    h(
        "ctcss-non-positive",
        "Enter the channel's CTCSS tone in Hz (e.g. 100.0), or clear the field to turn CTCSS off.",
        "A CTCSS value of 0 or below is ignored, so squelch opens for any signal, not just the one with the tone. In a scan channel's per-frequency list, 0.0 is the correct way to turn CTCSS off for one frequency and isn't flagged.",
    ),
    h(
        "ctcss-near-standard-tone",
        "Use the standard tone this value is close to (it's named in the message).",
        "CTCSS detection is precise, so a tone that's off by a fraction of a Hz never matches and squelch stays closed. Standard tones run from 67.0 to 254.1 Hz. Check the agency's published tone.",
    ),
    h(
        "lowpass-below-highpass",
        "Raise Lowpass above Highpass, or set either one to 0 to turn that filter off.",
        "Highpass removes audio below its cutoff and lowpass removes audio above its cutoff. With lowpass lower than highpass nothing gets through, so rtl_airband rejects it. Voice is roughly 100-2500 Hz, the default range.",
    ),
    h(
        "modulation-unrecognized",
        "Set modulation to am (airband) or nfm (narrowband FM), or leave it blank for am.",
        "rtl_airband only demodulates AM and NFM, and refuses to start with any other modulation. VHF/UHF civil and military aviation uses AM. Most public-safety and business radio uses NFM.",
    ),
    h(
        "ampfactor-negative",
        "Set Ampfactor to a positive value (1.0 leaves the audio unchanged), or leave it blank.",
        "Ampfactor multiplies this channel's output volume: 2.0 doubles it and 0.5 halves it. A negative value isn't valid.",
    ),
    h(
        "squelch-threshold-positive",
        "Use a negative dBFS level (e.g. -40), or 0 for automatic squelch.",
        "The squelch threshold is a signal level in dBFS, where 0 is the loudest the dongle can measure, so real thresholds are negative. Squelch opens when the signal is stronger (closer to 0) than the threshold. A positive value could never be reached.",
    ),
    h(
        "squelch-snr-threshold-invalid",
        "Use a signal-to-noise ratio in dB of 0 or more (e.g. 9.0), or -1 to keep the default.",
        "SNR squelch opens when the signal is this many dB above the noise floor. 0 keeps squelch always open. -1 is the only allowed negative value and means \"use the default\".",
    ),
    h(
        "squelch-threshold-and-snr-threshold-both-set",
        "Keep only one of Squelch threshold or Squelch SNR threshold on this channel and clear the other.",
        "The two are different ways of deciding when squelch opens: a fixed signal level, or a margin above the noise floor. rtl_airband only uses one of them, so setting both hides which one applies. SNR squelch copes better when the noise floor changes.",
    ),
    h(
        "squelch-deprecated",
        "Replace squelch with Squelch threshold (dBFS) or Squelch SNR threshold (dB).",
        "The old squelch setting used a different scale and is now ignored, so this channel runs on automatic squelch. Retune it with one of the current settings and remove the old one.",
    ),
    h(
        "notch-q-non-positive",
        "Set Notch Q to a positive value (default 10.0), or leave it blank.",
        "Q sets how narrow the notch filter is: higher values cut a narrower band around the notch frequency. 0 or below isn't a valid filter.",
    ),
    h(
        "enabled-false-with-disable",
        "Nothing is broken. Clear Enabled or Disable so the intent is clear.",
        "Disable removes the item from what rtl_airband loads, so Enabled has no effect. Use Disable to remove it until the next restart. On the fork, use Enabled = off to keep it loaded but silent, so Apply live can turn it back on.",
    ),
    // --- Outputs ---
    h(
        "file-output-continuous-and-split-on-transmission",
        "Turn off either Continuous or Split on transmission on this file output.",
        "Continuous records all audio, silence included, into rolling files. Split on transmission writes a new file for each transmission. A file output can only do one, so rtl_airband rejects both. To do both, add a second file output.",
    ),
    h(
        "split-settings-ignored-without-split-on-transmission",
        "Turn on Split on transmission for this output, or remove its split_* settings.",
        "split_*_time, split_tx_drop_shorter_than and split_include_transmission_start only control how per-transmission files are cut. Without split_on_transmission they do nothing, which usually means the setting was meant for another output.",
    ),
    h(
        "send-tx-tags-not-supported-on-scan-mode",
        "Turn off Send tx tags on this output and turn on Send scan freq tags instead.",
        "Tx tags put the channel's fixed frequency and label in the stream's Now Playing. A scan channel's frequency changes as it scans, and Send scan freq tags updates the title with whichever frequency is active.",
    ),
    h(
        "rdio-scanner-requires-split-on-transmission",
        "Turn on Split on transmission for this file output, or turn off Upload to rdio-scanner.",
        "rdio-scanner receives one recording per call. Only split_on_transmission produces a finished file for each transmission that can be uploaded.",
    ),
    h(
        "rdio-scanner-not-supported-on-scan-mode",
        "Move rdio-scanner uploads to a multichannel channel, or turn off Upload to rdio-scanner here.",
        "Talkgroup ID and the other rdio-scanner fields are set once per output, but a scan channel keeps changing frequency, so every call would be filed under the same talkgroup. Give each frequency you want uploaded its own multichannel channel.",
    ),
    h(
        "rdio-scanner-invalid-timeout",
        "Set Timeout to a number of milliseconds greater than 0 (default 5000), or leave it blank.",
        "With 0, an upload would never time out (libcurl's behavior), and a stalled server would block the upload queue forever.",
    ),
    h(
        "rdio-scanner-invalid-max-retries",
        "Set Max retries to 0 or more (default 2), or leave it blank.",
        "This is how many more times a failed upload is tried before it's dropped. 0 means try only once.",
    ),
    h(
        "rdio-scanner-invalid-queue-depth",
        "Set Rdio-scanner queue depth to 1 or more (default 64), or leave it blank.",
        "This is how many finished recordings can wait to upload before new ones are dropped. Raise it if uploads fall behind during busy periods.",
    ),
    h(
        "udp-stream-sample-rate-non-positive",
        "Set the UDP stream's sample rate to a positive value in Hz (e.g. 16000), or leave it blank.",
        "The audio is resampled to this rate before it's sent, so it has to be a real rate. It should match what the receiving program expects.",
    ),
    h(
        "post-write-script-runs-arbitrary-command",
        "Make sure you trust this script and everyone who can edit this config, then dismiss.",
        "rtl_airband runs the post-write script as a shell command, as the instance's service user, after every recording it finishes. Anyone who can edit this config can run commands on this machine. This is a reminder, not an error.",
    ),
    // --- Mixers ---
    h(
        "mixer-reference-not-found",
        "Choose a mixer that exists in Mixers as this output's Mixer name, or add a mixer with this exact name.",
        "A mixer output sends the channel's audio into a mixer by name. Names are case-sensitive, and rtl_airband won't start if the mixer doesn't exist (for example, it was renamed or deleted).",
    ),
    h(
        "mixer-unused",
        "Route at least one channel into this mixer (add an output of type mixer that names it), or disable or delete the mixer.",
        "rtl_airband exits at startup if a mixer has no inputs, since it would never produce audio.",
    ),
    h(
        "mixer-output-rawfile-not-allowed",
        "Use a file output (MP3) for this mixer instead of rawfile.",
        "A mixer's audio is already demodulated and mixed, and rawfile records raw I/Q samples, which a mixer doesn't have. rtl_airband rejects rawfile here.",
    ),
    h(
        "mixer-output-split-on-transmission-not-allowed",
        "Turn off Split on transmission on this mixer output (use Continuous or a plain file), or record per transmission from each channel instead.",
        "A mixer combines several channels and has no single transmission to split on, so rtl_airband rejects it. Put the split_on_transmission file output on each channel instead.",
    ),
    h(
        "mixer-output-split-settings-not-allowed",
        "Remove the split_* settings from this mixer output.",
        "Mixer outputs can't use split_on_transmission, so the settings that control its file splitting aren't allowed either, and rtl_airband rejects them.",
    ),
    h(
        "mixer-output-pulse-stream-name-required",
        "Set a Stream name on this PulseAudio output.",
        "A channel's PulseAudio stream is named after its frequency by default, but a mixer has no frequency, so rtl_airband needs a name for it.",
    ),
    h(
        "mixer-output-balance-out-of-range",
        "Set Balance between -1.0 (full left) and 1.0 (full right); 0.0 is centered.",
        "Balance places this channel in the mixer's stereo output. Values outside the range are rejected.",
    ),
    h(
        "mixer-reserve-inputs-negative",
        "Set Reserve inputs to 0 or more, or leave it blank.",
        "Reserve inputs sets aside empty input slots, so channels can be routed into this mixer later with Apply live instead of a restart. It can't be negative.",
    ),
    h(
        "mixer-remote-input-listen-path-empty",
        "Enter the listen path this remote input receives on (the path the sending instance's mixer_remote output names).",
        "Remote inputs carry audio from a mixer_remote output in another rtl_airband instance on this machine. They meet at this path, so it must be set and must match the sender's destination path exactly.",
    ),
    h(
        "mixer-remote-input-stream-id-negative",
        "Set Stream ID to 0 or more.",
        "The stream ID tells apart the different senders that share one listen path. It has to match the sender's stream ID.",
    ),
    h(
        "mixer-remote-input-balance-out-of-range",
        "Set Balance between -1.0 (full left) and 1.0 (full right); 0.0 is centered.",
        "Balance places this remote input in the mixer's stereo output. Values outside the range are rejected.",
    ),
    h(
        "mixer-remote-input-duplicate-stream-id",
        "Give each remote input on the same listen path a different Stream ID, and update the sending instance's mixer_remote output to match.",
        "One listener receives everything on a listen path and sorts it by stream ID, across all mixers in this config. If two inputs share an ID, their audio would be mixed together.",
    ),
    h(
        "mixer-remote-output-stream-id-negative",
        "Set Stream ID to 0 or more, matching the receiving instance's remote input.",
        "The receiving mixer uses the stream ID to tell this sender apart from others on the same listen path.",
    ),
    // --- Number formats ---
    h(
        "not-whole-number",
        "Remove the decimal part. This setting only takes whole numbers.",
        "rtl_airband reads this setting as an integer and refuses a value with a fractional part (e.g. 10.5).",
    ),
];

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    /// Every kebab-case string literal in the checks: the issue codes they
    /// emit (passed directly, through a `CODE` const, or as an argument).
    fn emitted_codes() -> BTreeSet<String> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/checks");
        let mut codes = BTreeSet::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            for literal in text.split('"').skip(1).step_by(2) {
                let is_code = literal.contains('-')
                    && literal.split('-').all(|part| {
                        !part.is_empty() && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                    });
                if is_code {
                    codes.insert(literal.to_string());
                }
            }
        }
        codes
    }

    #[test]
    fn every_emitted_code_has_exactly_one_hint() {
        let hinted: Vec<&str> = ISSUE_HINTS.iter().map(|h| h.code).collect();
        let unique: BTreeSet<&str> = hinted.iter().copied().collect();
        assert_eq!(unique.len(), hinted.len(), "duplicate codes in ISSUE_HINTS");

        let emitted = emitted_codes();
        let hinted: BTreeSet<String> = unique.into_iter().map(String::from).collect();
        let missing: Vec<_> = emitted.difference(&hinted).collect();
        let stale: Vec<_> = hinted.difference(&emitted).collect();
        assert!(missing.is_empty(), "codes with no hint: {missing:?}");
        assert!(stale.is_empty(), "hints for codes no check emits: {stale:?}");
    }

    #[test]
    fn hints_are_filled_in() {
        for hint in ISSUE_HINTS {
            assert!(!hint.summary.trim().is_empty() && !hint.detail.trim().is_empty(), "{} is blank", hint.code);
        }
        assert_eq!(issue_hint("fft-bin-collision").map(|h| h.code), Some("fft-bin-collision"));
        assert!(issue_hint("request-failed").is_none());
    }

    /// Writes the table next to the ts-rs bindings, keyed by code.
    #[test]
    fn export_typescript_issue_hints() {
        let Some(dir) = std::env::var_os("TS_RS_EXPORT_DIR") else { return };
        let q = |s: &str| serde_json::to_string(s).unwrap();
        let mut text = String::from(
            "// Generated from crates/airband-validate/src/hints.rs. Do not edit this file manually.\n\
             export interface IssueHint {\n  summary: string;\n  detail: string;\n}\n\n\
             export const ISSUE_HINTS: Readonly<Record<string, IssueHint>> = {\n",
        );
        for hint in ISSUE_HINTS {
            text.push_str(&format!(
                "  {}: {{\n    summary: {},\n    detail: {},\n  }},\n",
                q(hint.code),
                q(hint.summary),
                q(hint.detail)
            ));
        }
        text.push_str("};\n");
        let path = std::path::Path::new(&dir).join("issue-hints.ts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(path, text).unwrap();
    }
}
