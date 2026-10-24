//! Per-SDR hardware health for the Hardware page: each instance's devices,
//! joined from its config (what it should be running) and its control
//! socket's `status` reply (what it is running, fork v6.4.0+), plus the
//! figures derived from them (headroom, noise floor, frequency error,
//! counter rates). Instances without a reachable `status` still list their
//! devices from config, marked not live with the reason.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use airband_config::domain::{Channel, Device, NumberOrString, RtlAirbandConfig};
use airband_supervisor::control_socket::{DeviceStatus, StatusReport, StatusResult};
use airband_supervisor::{ActiveState, ControlSocketClient};
use serde::Serialize;
use ts_rs::TS;

use crate::service::InstanceService;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    #[ts(type = "number")]
    pub sampled_at_ms: u64,
    pub instances: Vec<InstanceHardware>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct InstanceHardware {
    pub name: String,
    /// True when `devices` carries live readings from the control socket.
    pub live: bool,
    /// Why the readings aren't live: "no-control-socket", "not-running",
    /// "unsupported" (rtl_airband older than fork v6.4.0), "unreachable",
    /// "protocol-error" or "config-error".
    pub reason: Option<String>,
    pub detail: Option<String>,
    /// rtl_airband version the instance reported.
    pub version: Option<String>,
    pub devices: Vec<SdrHealth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SdrHealth {
    /// Index among the config's non-disabled devices: what rtl_airband,
    /// its stats file and its control socket call `device`.
    pub index: u32,
    /// The config's `type` (rtlsdr, soapysdr, ...).
    pub driver: String,
    pub serial: Option<String>,
    pub device_string: Option<String>,
    /// "multichannel" or "scan".
    pub mode: String,
    /// rtl_airband's input state (running, failed, ...), when live.
    pub state: Option<String>,
    pub center_freq_hz: Option<f64>,
    pub sample_rate_hz: Option<f64>,
    /// Tuner filter bandwidth; None means the driver's automatic default.
    pub tuner_bandwidth_hz: Option<f64>,
    /// Gain in dB: the applied value when live, else the configured one.
    pub gain_db: Option<f64>,
    /// The configured gain when it isn't a single number (e.g. SoapySDR
    /// per-element "LNA=20,VGA=10").
    pub gain_text: Option<String>,
    pub correction: Option<f64>,
    /// "ppm", or "Hz" for mirisdr.
    pub correction_unit: String,
    /// Strongest ADC sample over the last ~1 s, dB relative to full scale.
    pub peak_dbfs: Option<f64>,
    /// How far below clipping the peak sits (-peak_dbfs, never negative).
    pub headroom_db: Option<f64>,
    pub clipped_samples: Option<f64>,
    pub clipped_per_sec: Option<f64>,
    /// Median noise level across the device's enabled channels.
    pub noise_floor_dbfs: Option<f64>,
    /// Median carrier offset across channels that have had a transmission,
    /// in parts per million of each channel's frequency.
    pub freq_error_ppm: Option<f64>,
    /// How many channel frequencies the median was taken over.
    pub freq_error_samples: u32,
    /// `correction` that would cancel freq_error_ppm (ppm drivers only).
    pub suggested_correction: Option<f64>,
    pub buffer_overflows: Option<f64>,
    pub overflows_per_sec: Option<f64>,
    pub output_overruns: Option<f64>,
    pub retune_failures: Option<f64>,
    pub channels: Vec<ChannelHealth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHealth {
    /// Index among the device's non-disabled channels.
    pub channel: u32,
    pub freq_hz: f64,
    pub label: Option<String>,
    pub modulation: Option<String>,
    pub enabled: bool,
    /// The frequency the channel is tuned to (always true outside scan mode).
    pub active: bool,
    pub squelch_open: bool,
    pub noise_dbfs: Option<f64>,
    pub signal_dbfs: Option<f64>,
    pub snr_db: Option<f64>,
    pub freq_offset_hz: Option<f64>,
    pub freq_offset_ppm: Option<f64>,
}

/// Counter readings from the previous sample, for per-second rates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CounterSample {
    pub at: Instant,
    pub buffer_overflows: u64,
    pub clipped_samples: u64,
}

fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 1 { values[mid] } else { (values[mid - 1] + values[mid]) / 2.0 })
}

/// Per-second rate between two cumulative counter readings; None across a
/// restart (the counter went backwards) or a zero-length interval.
fn rate(now: u64, now_at: Instant, prev: u64, prev_at: Instant) -> Option<f64> {
    let secs = now_at.checked_duration_since(prev_at)?.as_secs_f64();
    (now >= prev && secs > 0.0).then(|| (now - prev) as f64 / secs)
}

fn config_gain(device: &Device) -> (Option<f64>, Option<String>) {
    match &device.gain {
        Some(NumberOrString::Number(n)) => (Some(*n), None),
        Some(NumberOrString::String(s)) => (s.trim().parse().ok(), s.trim().parse::<f64>().is_err().then(|| s.clone())),
        None => (None, None),
    }
}

/// (freq, label, modulation) of one configured frequency; a scan channel has several.
type ConfiguredFreq = (f64, Option<String>, Option<String>);

/// One entry per frequency of the device's non-disabled channels, from config.
fn config_channels(device: &Device) -> Vec<ChannelHealth> {
    let mut out = Vec::new();
    for (index, channel) in device.channels.iter().filter(|c| !channel_disabled(c)).enumerate() {
        let (freqs, enabled): (Vec<ConfiguredFreq>, bool) = match channel {
            Channel::Multichannel(c) => {
                (vec![(c.freq, c.label.clone(), c.modulation.clone())], c.enabled != Some(false))
            }
            Channel::Scan(c) => (
                c.freqs
                    .iter()
                    .enumerate()
                    .map(|(i, f)| {
                        let label = c.labels.as_ref().and_then(|l| l.get(i).cloned());
                        let modulation =
                            c.modulations.as_ref().and_then(|m| m.get(i).cloned()).or_else(|| c.modulation.clone());
                        (*f, label, modulation)
                    })
                    .collect(),
                c.enabled != Some(false),
            ),
        };
        for (k, (freq_hz, label, modulation)) in freqs.into_iter().enumerate() {
            out.push(ChannelHealth {
                channel: index as u32,
                freq_hz,
                label,
                modulation,
                enabled,
                active: k == 0,
                squelch_open: false,
                noise_dbfs: None,
                signal_dbfs: None,
                snr_db: None,
                freq_offset_hz: None,
                freq_offset_ppm: None,
            });
        }
    }
    out
}

fn channel_disabled(channel: &Channel) -> bool {
    match channel {
        Channel::Multichannel(c) => c.disable == Some(true),
        Channel::Scan(c) => c.disable == Some(true),
    }
}

/// The config's view of one device: everything is "as configured", no
/// live readings.
fn config_sdr(index: u32, device: &Device) -> SdrHealth {
    let (gain_db, gain_text) = config_gain(device);
    SdrHealth {
        index,
        driver: device.device_type.clone(),
        serial: device.serial.clone(),
        device_string: device.device_string.clone(),
        mode: device.mode.map(|m| m.as_str().to_string()).unwrap_or_else(|| "multichannel".into()),
        state: None,
        center_freq_hz: device.centerfreq,
        sample_rate_hz: device.sample_rate,
        tuner_bandwidth_hz: device.bandwidth.filter(|b| *b > 0.0),
        gain_db,
        gain_text,
        correction: device.correction,
        correction_unit: if device.device_type == "mirisdr" { "Hz" } else { "ppm" }.into(),
        peak_dbfs: None,
        headroom_db: None,
        clipped_samples: None,
        clipped_per_sec: None,
        noise_floor_dbfs: None,
        freq_error_ppm: None,
        freq_error_samples: 0,
        suggested_correction: None,
        buffer_overflows: None,
        overflows_per_sec: None,
        output_overruns: None,
        retune_failures: None,
        channels: config_channels(device),
    }
}

/// Overlays one device's live `status` onto its config view and derives
/// the summary figures.
fn apply_status(sdr: &mut SdrHealth, status: &DeviceStatus, now: Instant, prev: Option<&CounterSample>) {
    sdr.state = Some(status.state.clone());
    sdr.mode = status.mode.clone();
    sdr.center_freq_hz = Some(status.centerfreq as f64);
    sdr.sample_rate_hz = Some(status.sample_rate as f64);
    if let Some(bw) = status.bandwidth {
        sdr.tuner_bandwidth_hz = (bw > 0).then_some(bw as f64);
    }
    if status.gain.is_some() {
        sdr.gain_db = status.gain;
    }
    if status.correction.is_some() {
        sdr.correction = status.correction;
    }
    sdr.peak_dbfs = status.peak_dbfs;
    sdr.headroom_db = status.peak_dbfs.map(|p| (-p).max(0.0));
    sdr.clipped_samples = Some(status.clipped_samples as f64);
    sdr.buffer_overflows = Some(status.buffer_overflows as f64);
    sdr.output_overruns = Some(status.output_overruns as f64);
    sdr.retune_failures = Some(status.retune_failures as f64);
    if let Some(prev) = prev {
        sdr.clipped_per_sec = rate(status.clipped_samples, now, prev.clipped_samples, prev.at);
        sdr.overflows_per_sec = rate(status.buffer_overflows, now, prev.buffer_overflows, prev.at);
    }

    let mut channels = Vec::new();
    for ch in &status.channels {
        for (k, f) in ch.freqs.iter().enumerate() {
            let configured = sdr.channels.iter().find(|c| c.channel == ch.index && c.freq_hz == f.freq as f64);
            let freq_hz = f.freq as f64;
            channels.push(ChannelHealth {
                channel: ch.index,
                freq_hz,
                label: f.label.clone().or_else(|| configured.and_then(|c| c.label.clone())),
                modulation: Some(f.modulation.clone()),
                enabled: ch.enabled,
                active: k as u32 == ch.freq_idx,
                squelch_open: ch.squelch_open && k as u32 == ch.freq_idx,
                noise_dbfs: f.noise_dbfs,
                signal_dbfs: f.signal_dbfs,
                snr_db: f.signal_dbfs.zip(f.noise_dbfs).map(|(s, n)| s - n),
                freq_offset_hz: f.freq_offset_hz,
                freq_offset_ppm: f.freq_offset_hz.filter(|_| freq_hz > 0.0).map(|o| o / freq_hz * 1e6),
            });
        }
    }
    sdr.channels = channels;

    sdr.noise_floor_dbfs =
        median(sdr.channels.iter().filter(|c| c.enabled && c.active).filter_map(|c| c.noise_dbfs).collect());
    let ppms: Vec<f64> = sdr.channels.iter().filter_map(|c| c.freq_offset_ppm).collect();
    sdr.freq_error_samples = ppms.len() as u32;
    sdr.freq_error_ppm = median(ppms);
    // A carrier received high means the tuner's oscillator runs slow: a
    // correction that raises the tuned frequency by the same ppm cancels it.
    sdr.suggested_correction = match (sdr.correction_unit.as_str(), sdr.freq_error_ppm) {
        ("ppm", Some(err)) => Some((sdr.correction.unwrap_or(0.0) - err).round()),
        _ => None,
    };
}

/// Joins an instance's config with its `status` reply (if any). `prev`
/// holds the previous counter readings per device index and is updated.
pub fn derive_devices(
    config: &RtlAirbandConfig,
    report: Option<&StatusReport>,
    now: Instant,
    prev: &mut HashMap<u32, CounterSample>,
) -> Vec<SdrHealth> {
    let mut sdrs: Vec<SdrHealth> = config
        .devices
        .iter()
        .filter(|d| d.disable != Some(true))
        .enumerate()
        .map(|(i, d)| config_sdr(i as u32, d))
        .collect();
    let Some(report) = report else { return sdrs };
    for status in &report.devices {
        let Some(sdr) = sdrs.get_mut(status.index as usize) else { continue };
        apply_status(sdr, status, now, prev.get(&status.index));
        prev.insert(
            status.index,
            CounterSample {
                at: now,
                buffer_overflows: status.buffer_overflows,
                clipped_samples: status.clipped_samples,
            },
        );
    }
    sdrs
}

pub struct HardwareService {
    instances: Arc<InstanceService>,
    client: ControlSocketClient,
    counters: Mutex<HashMap<String, HashMap<u32, CounterSample>>>,
}

impl HardwareService {
    pub fn new(instances: Arc<InstanceService>, timeout: Duration) -> Self {
        HardwareService { instances, client: ControlSocketClient::new(timeout), counters: Mutex::default() }
    }

    pub async fn snapshot(&self) -> Result<HardwareSnapshot, crate::error::ApiError> {
        let health = self.instances.all_health().await?;
        let results = futures::future::join_all(health.into_iter().map(|(name, status)| async move {
            let config = self.instances.configs.read(&name).await.map(|c| c.config);
            let socket = config.as_ref().ok().and_then(|c| c.control_socket_path.clone()).map(PathBuf::from);
            let reply = match &socket {
                Some(path) => Some(self.client.status(path).await),
                None => None,
            };
            (name, status.active_state, config, reply, Instant::now())
        }))
        .await;

        let mut counters = self.counters.lock().unwrap();
        counters.retain(|name, _| results.iter().any(|r| &r.0 == name));
        let instances = results
            .into_iter()
            .map(|(name, active, config, reply, at)| {
                let prev = counters.entry(name.clone()).or_default();
                instance_hardware(name, active, config.as_deref().map_err(|e| e.to_string()), reply, at, prev)
            })
            .collect();
        let sampled_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        Ok(HardwareSnapshot { sampled_at_ms, instances })
    }
}

fn instance_hardware(
    name: String,
    active: ActiveState,
    config: Result<&RtlAirbandConfig, String>,
    reply: Option<StatusResult>,
    now: Instant,
    prev: &mut HashMap<u32, CounterSample>,
) -> InstanceHardware {
    let not_live = |reason: &str, detail: Option<String>, devices| InstanceHardware {
        name: name.clone(),
        live: false,
        reason: Some(reason.into()),
        detail,
        version: None,
        devices,
    };
    let config = match config {
        Ok(c) => c,
        Err(e) => return not_live("config-error", Some(e), Vec::new()),
    };
    let from_config = |prev: &mut HashMap<u32, CounterSample>| derive_devices(config, None, now, prev);
    match reply {
        None => not_live("no-control-socket", None, from_config(prev)),
        Some(StatusResult::Ok(report)) => InstanceHardware {
            name: name.clone(),
            live: true,
            reason: None,
            detail: None,
            version: Some(report.version.clone()),
            devices: derive_devices(config, Some(&report), now, prev),
        },
        Some(StatusResult::Unsupported) => not_live("unsupported", None, from_config(prev)),
        Some(StatusResult::Unreachable { reason }) => {
            let why = if active == ActiveState::Active { "unreachable" } else { "not-running" };
            not_live(why, Some(reason), from_config(prev))
        }
        Some(StatusResult::ProtocolError { message }) => not_live("protocol-error", Some(message), from_config(prev)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use airband_supervisor::control_socket::{ChannelStatus, FreqStatus};

    fn config(devices: &str) -> RtlAirbandConfig {
        let text = format!(
            "multiple_demod_threads = false;\nmultiple_output_threads = false;\nstats_filepath = \"/tmp/s\";\nlocaltime = false;\n{devices}"
        );
        airband_config::parse_config_file(&text).expect("test config parses")
    }

    fn freq(hz: i64, noise: Option<f64>, offset: Option<f64>) -> FreqStatus {
        FreqStatus {
            freq: hz,
            label: None,
            modulation: "am".into(),
            noise_dbfs: noise,
            signal_dbfs: noise.map(|n| n + 3.0),
            freq_offset_hz: offset,
            freq_offset_updates: offset.map_or(0, |_| 4),
        }
    }

    fn device(index: u32, channels: Vec<ChannelStatus>) -> DeviceStatus {
        DeviceStatus {
            index,
            driver: Some("rtlsdr".into()),
            state: "running".into(),
            mode: "multichannel".into(),
            centerfreq: 120_000_000,
            sample_rate: 2_560_000,
            gain: Some(33.8),
            correction: Some(1.0),
            bandwidth: Some(0),
            peak_dbfs: Some(-4.5),
            clipped_samples: 100,
            buffer_overflows: 2,
            buffer_underruns: 0,
            retune_failures: 0,
            output_overruns: 0,
            channels,
        }
    }

    fn channel(index: u32, freqs: Vec<FreqStatus>) -> ChannelStatus {
        ChannelStatus { index, enabled: true, freq_idx: 0, squelch_open: false, freqs }
    }

    const TWO_DEVICES: &str = r#"
devices: (
  { type = "rtlsdr"; serial = "skip"; disable = true; gain = 10; centerfreq = 100.0;
    channels: ( { freq = 100.1; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "a"; } ); } ); },
  { type = "rtlsdr"; serial = "00000002"; gain = 33.8; centerfreq = 120.0; correction = 1;
    channels: (
      { freq = 120.1; label = "Ground"; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "b"; } ); },
      { freq = 120.2; disable = true; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "c"; } ); },
      { freq = 120.3; label = "Tower"; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "d"; } ); },
      { freq = 120.4; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "e"; } ); }
    ); }
);
"#;

    #[test]
    fn config_only_view_skips_disabled_devices_and_channels() {
        let sdrs = derive_devices(&config(TWO_DEVICES), None, Instant::now(), &mut HashMap::new());
        assert_eq!(sdrs.len(), 1);
        let sdr = &sdrs[0];
        assert_eq!((sdr.index, sdr.serial.as_deref(), sdr.gain_db), (0, Some("00000002"), Some(33.8)));
        assert_eq!(sdr.center_freq_hz, Some(120_000_000.0));
        let freqs: Vec<(u32, f64)> = sdr.channels.iter().map(|c| (c.channel, c.freq_hz)).collect();
        assert_eq!(freqs, [(0, 120_100_000.0), (1, 120_300_000.0), (2, 120_400_000.0)]);
        assert_eq!(sdr.channels[1].label.as_deref(), Some("Tower"));
        assert_eq!((sdr.peak_dbfs, sdr.noise_floor_dbfs, sdr.freq_error_ppm), (None, None, None));
    }

    #[test]
    fn live_status_derives_headroom_noise_floor_and_median_ppm() {
        let report = StatusReport {
            version: "v6.4.0".into(),
            devices: vec![device(
                0,
                vec![
                    // +120 Hz at 120.1 MHz = +0.999 ppm
                    channel(0, vec![freq(120_100_000, Some(-40.0), Some(120.0))]),
                    // +1.2 ppm
                    channel(1, vec![freq(120_300_000, Some(-30.0), Some(144.36))]),
                    // a wild outlier the median ignores
                    channel(2, vec![freq(120_400_000, Some(-35.0), Some(2000.0))]),
                ],
            )],
        };
        let sdrs = derive_devices(&config(TWO_DEVICES), Some(&report), Instant::now(), &mut HashMap::new());
        let sdr = &sdrs[0];
        assert_eq!(sdr.headroom_db, Some(4.5));
        assert_eq!(sdr.noise_floor_dbfs, Some(-35.0));
        assert_eq!(sdr.freq_error_samples, 3);
        assert!((sdr.freq_error_ppm.unwrap() - 1.2).abs() < 1e-3, "{:?}", sdr.freq_error_ppm);
        // correction 1 ppm, carrier still reads +1.2 ppm high -> 1 - 1.2 = -0.2 -> 0
        assert_eq!(sdr.suggested_correction, Some(-0.0));
        assert_eq!(sdr.channels[0].label.as_deref(), Some("Ground"), "label falls back to the config's");
        assert_eq!(sdr.channels[1].snr_db, Some(3.0));
    }

    #[test]
    fn rates_come_from_the_previous_sample_and_reset_on_restart() {
        let cfg = config(TWO_DEVICES);
        let t0 = Instant::now();
        let mut prev = HashMap::new();
        let mut report = StatusReport { version: "v".into(), devices: vec![device(0, vec![])] };
        let first = derive_devices(&cfg, Some(&report), t0, &mut prev);
        assert_eq!(first[0].overflows_per_sec, None, "no previous sample yet");

        report.devices[0].buffer_overflows = 12;
        report.devices[0].clipped_samples = 2100;
        let second = derive_devices(&cfg, Some(&report), t0 + Duration::from_secs(2), &mut prev);
        assert_eq!(second[0].overflows_per_sec, Some(5.0));
        assert_eq!(second[0].clipped_per_sec, Some(1000.0));

        report.devices[0].buffer_overflows = 0; // the instance restarted
        let third = derive_devices(&cfg, Some(&report), t0 + Duration::from_secs(3), &mut prev);
        assert_eq!(third[0].overflows_per_sec, None);
    }

    #[test]
    fn scan_channels_mark_the_tuned_frequency() {
        let cfg = config(
            r#"
devices: ( { type = "rtlsdr"; index = 0; gain = 20; mode = "scan";
  channels: ( { freqs = ( 130.1, 130.2 ); labels = ( "A", "B" );
                outputs: ( { type = "file"; directory = "/tmp"; filename_template = "s"; } ); } ); } );
"#,
        );
        let mut status = device(
            0,
            vec![channel(0, vec![freq(130_100_000, Some(-40.0), None), freq(130_200_000, Some(-20.0), None)])],
        );
        status.mode = "scan".into();
        status.channels[0].freq_idx = 1;
        status.channels[0].squelch_open = true;
        let report = StatusReport { version: "v".into(), devices: vec![status] };
        let sdrs = derive_devices(&cfg, Some(&report), Instant::now(), &mut HashMap::new());
        let chans = &sdrs[0].channels;
        assert_eq!((chans[0].active, chans[0].squelch_open), (false, false));
        assert_eq!((chans[1].active, chans[1].squelch_open), (true, true));
        assert_eq!(chans[1].label.as_deref(), Some("B"));
        assert_eq!(sdrs[0].noise_floor_dbfs, Some(-20.0), "only the tuned frequency counts toward the floor");
        assert_eq!(sdrs[0].freq_error_ppm, None);
    }

    #[test]
    fn mirisdr_gets_no_ppm_suggestion() {
        let cfg = config(
            r#"
devices: ( { type = "mirisdr"; index = 0; gain = 20; centerfreq = 120.0; correction = 50;
  channels: ( { freq = 120.1; outputs: ( { type = "file"; directory = "/tmp"; filename_template = "m"; } ); } ); } );
"#,
        );
        let report = StatusReport {
            version: "v".into(),
            devices: vec![device(0, vec![channel(0, vec![freq(120_100_000, Some(-40.0), Some(120.0))])])],
        };
        let sdrs = derive_devices(&cfg, Some(&report), Instant::now(), &mut HashMap::new());
        assert_eq!(sdrs[0].correction_unit, "Hz");
        assert!(sdrs[0].freq_error_ppm.is_some());
        assert_eq!(sdrs[0].suggested_correction, None);
    }
}
