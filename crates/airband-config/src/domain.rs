//! JSON domain model for an RTLSDR-Airband instance config. Port of
//! backend/parser/src/domain.ts, which documents every field in detail;
//! comments here focus on what differs or is new.
//!
//! Field names mirror the .conf keys (snake_case). `centerfreq`,
//! `sample_rate` (device), `freq`/`freqs`, and channel `bandwidth` are
//! canonicalized to integer Hz, following upstream's parse_anynum2int()
//! (a float literal is MHz, an int literal is Hz).
//!
//! New vs the TS model:
//! - `unknown_settings` on every group: settings the panel does not model
//!   are kept verbatim (as AST) and written back unchanged, instead of
//!   being silently dropped on save.
//! - RTLSDR-Airband v5.5/v6.3 fields: `stats_update_interval`, the
//!   `split_*_file_time` settings, and `split_include_transmission_start`.

use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::ast::Setting;

/// A field that may be a single number or one value per scanned frequency.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumberOrList {
    One(f64),
    Many(Vec<f64>),
}

/// A field that may be a number or a string, e.g. SoapySDR `gain`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumberOrString {
    Number(f64),
    String(String),
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RtlAirbandConfig {
    pub multiple_demod_threads: bool,
    pub multiple_output_threads: bool,
    pub stats_filepath: String,
    pub localtime: bool,
    pub fft_size: Option<f64>,
    pub pidfile: Option<String>,
    pub log_scan_activity: Option<bool>,
    pub shout_metadata_delay: Option<f64>,
    pub tau: Option<f64>,
    pub stats_http_address: Option<String>,
    pub stats_http_port: Option<f64>,
    pub rdio_scanner_queue_depth: Option<f64>,
    pub control_socket_path: Option<String>,
    /// Seconds between stats_filepath rewrites; must be > 0. Defaults to 15.
    pub stats_update_interval: Option<f64>,
    /// Global default for file outputs; must be >= 1.0. Defaults to 1.0.
    pub split_min_file_time: Option<f64>,
    /// Global default for file outputs; must be > split_min_file_time. Defaults to 3600.
    pub split_max_file_time: Option<f64>,
    /// Global default for file outputs; must be > 0. Defaults to 0.5.
    pub split_max_idle_time: Option<f64>,
    /// Global default for file outputs. Defaults to false.
    pub split_include_transmission_start: Option<bool>,
    pub devices: Vec<Device>,
    pub mixers: Option<Vec<Mixer>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceMode {
    Multichannel,
    Scan,
}

impl DeviceMode {
    pub fn as_str(self) -> &'static str {
        match self {
            DeviceMode::Multichannel => "multichannel",
            DeviceMode::Scan => "scan",
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Device {
    #[serde(rename = "type")]
    pub device_type: String,
    pub serial: Option<String>,
    pub index: Option<f64>,
    pub gain: Option<NumberOrString>,
    pub centerfreq: Option<f64>,
    pub sample_rate: Option<f64>,
    pub correction: Option<f64>,
    /// rtlsdr tuner bandwidth, literal int Hz (no float-means-MHz shorthand).
    pub bandwidth: Option<f64>,
    pub mode: Option<DeviceMode>,
    pub reserve_channels: Option<f64>,
    pub disable: Option<bool>,
    pub tau: Option<f64>,
    pub buffers: Option<f64>,
    pub num_buffers: Option<f64>,
    pub device_string: Option<String>,
    pub channel: Option<f64>,
    pub antenna: Option<String>,
    pub channels: Vec<Channel>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Channel {
    Multichannel(MultichannelChannel),
    Scan(ScanChannel),
}

impl Channel {
    pub fn outputs(&self) -> &[Output] {
        match self {
            Channel::Multichannel(c) => &c.outputs,
            Channel::Scan(c) => &c.outputs,
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MultichannelChannel {
    pub freq: f64,
    pub label: Option<String>,
    pub bandwidth: Option<f64>,
    pub ampfactor: Option<f64>,
    pub afc: Option<f64>,
    pub modulation: Option<String>,
    pub ctcss: Option<f64>,
    pub notch: Option<f64>,
    pub notch_q: Option<f64>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub tau: Option<f64>,
    pub squelch_threshold: Option<f64>,
    pub squelch_snr_threshold: Option<f64>,
    pub disable: Option<bool>,
    pub enabled: Option<bool>,
    pub outputs: Vec<Output>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScanChannel {
    pub freqs: Vec<f64>,
    pub labels: Option<Vec<String>>,
    pub modulation: Option<String>,
    pub modulations: Option<Vec<String>>,
    pub bandwidth: Option<NumberOrList>,
    pub ampfactor: Option<NumberOrList>,
    pub afc: Option<f64>,
    pub ctcss: Option<NumberOrList>,
    pub notch: Option<NumberOrList>,
    pub notch_q: Option<NumberOrList>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub tau: Option<f64>,
    pub squelch_threshold: Option<NumberOrList>,
    pub squelch_snr_threshold: Option<NumberOrList>,
    pub disable: Option<bool>,
    pub enabled: Option<bool>,
    pub outputs: Vec<Output>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mixer {
    pub name: String,
    pub disable: Option<bool>,
    pub enabled: Option<bool>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub reserve_inputs: Option<f64>,
    pub remote_inputs: Option<Vec<MixerRemoteInput>>,
    /// A mixer's own outputs cannot themselves be of type "mixer".
    pub outputs: Vec<Output>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MixerRemoteInput {
    pub listen_path: String,
    pub stream_id: f64,
    pub ampfactor: Option<f64>,
    pub balance: Option<f64>,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

// Variants are config data edited in place; boxing them would only add noise.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Output {
    #[serde(rename = "pulse")]
    Pulse(PulseOutput),
    #[serde(rename = "file")]
    File(FileOutput),
    #[serde(rename = "rawfile")]
    RawFile(RawFileOutput),
    #[serde(rename = "icecast")]
    Icecast(IcecastOutput),
    #[serde(rename = "udp_stream")]
    UdpStream(UdpStreamOutput),
    #[serde(rename = "mixer")]
    Mixer(MixerOutput),
    #[serde(rename = "mixer_remote")]
    MixerRemote(MixerRemoteOutput),
}

impl Output {
    pub fn type_name(&self) -> &'static str {
        match self {
            Output::Pulse(_) => "pulse",
            Output::File(_) => "file",
            Output::RawFile(_) => "rawfile",
            Output::Icecast(_) => "icecast",
            Output::UdpStream(_) => "udp_stream",
            Output::Mixer(_) => "mixer",
            Output::MixerRemote(_) => "mixer_remote",
        }
    }

    pub fn disable(&self) -> Option<bool> {
        match self {
            Output::Pulse(o) => o.disable,
            Output::File(o) => o.disable,
            Output::RawFile(o) => o.disable,
            Output::Icecast(o) => o.disable,
            Output::UdpStream(o) => o.disable,
            Output::Mixer(o) => o.disable,
            Output::MixerRemote(o) => o.disable,
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PulseOutput {
    pub server: Option<String>,
    pub sink: Option<String>,
    pub name: Option<String>,
    pub stream_name: Option<String>,
    pub continuous: Option<bool>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileOutput {
    pub directory: String,
    pub filename_template: String,
    pub continuous: Option<bool>,
    pub split_on_transmission: Option<bool>,
    pub min_rx_seconds: Option<f64>,
    pub include_freq: Option<bool>,
    pub append: Option<bool>,
    pub dated_subdirectories: Option<bool>,
    pub post_write_script: Option<String>,
    /// RTLSDR-Airband v5.5/v6.3 split-file settings (also on rawfile):
    /// each falls back to the global setting of the same name, and only
    /// takes effect with `split_on_transmission`.
    pub split_min_file_time: Option<f64>,
    pub split_max_file_time: Option<f64>,
    pub split_max_idle_time: Option<f64>,
    pub split_include_transmission_start: Option<bool>,
    pub rdio_scanner: Option<RdioScannerConfig>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RdioScannerConfig {
    pub server: String,
    pub port: f64,
    pub use_tls: Option<bool>,
    pub api_key: String,
    pub system_id: Option<f64>,
    pub system_label: Option<String>,
    pub talkgroup_id: f64,
    pub talkgroup_label: Option<String>,
    pub talkgroup_tag: Option<String>,
    pub talkgroup_group: Option<String>,
    pub source_id: Option<f64>,
    pub delete_after_upload: Option<bool>,
    pub timeout_ms: Option<f64>,
    pub max_retries: Option<f64>,
    /// Panel-only: when true the whole block is omitted from the written
    /// .conf, while the values are kept in the JSON model.
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawFileOutput {
    pub directory: String,
    pub filename_template: String,
    pub continuous: Option<bool>,
    pub split_on_transmission: Option<bool>,
    pub include_freq: Option<bool>,
    pub append: Option<bool>,
    pub dated_subdirectories: Option<bool>,
    pub split_min_file_time: Option<f64>,
    pub split_max_file_time: Option<f64>,
    pub split_max_idle_time: Option<f64>,
    pub split_include_transmission_start: Option<bool>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    Auto,
    AutoNoPlain,
    Transport,
    Upgrade,
    Disabled,
}

impl TlsMode {
    pub const ALL: [TlsMode; 5] =
        [TlsMode::Auto, TlsMode::AutoNoPlain, TlsMode::Transport, TlsMode::Upgrade, TlsMode::Disabled];

    pub fn as_str(self) -> &'static str {
        match self {
            TlsMode::Auto => "auto",
            TlsMode::AutoNoPlain => "auto_no_plain",
            TlsMode::Transport => "transport",
            TlsMode::Upgrade => "upgrade",
            TlsMode::Disabled => "disabled",
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IcecastOutput {
    pub server: String,
    pub port: f64,
    pub mountpoint: String,
    pub username: String,
    pub password: String,
    pub name: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub send_scan_freq_tags: Option<bool>,
    pub send_tx_tags: Option<bool>,
    /// Errors at startup when rtl_airband was built against a libshout
    /// without TLS support (RTLSDR-Airband v6.3).
    pub tls: Option<TlsMode>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UdpStreamOutput {
    pub dest_address: String,
    /// A port number or a named service, kept as a string either way.
    pub dest_port: String,
    /// 8, 16 or 32.
    pub bit_depth: Option<f64>,
    pub sample_rate: Option<f64>,
    pub continuous: Option<bool>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MixerOutput {
    pub name: String,
    pub ampfactor: Option<f64>,
    pub balance: Option<f64>,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MixerRemoteOutput {
    pub dest_path: String,
    pub stream_id: f64,
    pub disable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown_settings: Vec<Setting>,
}
