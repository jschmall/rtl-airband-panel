//! AST <-> domain model mapping. Port of backend/parser/src/mapper.ts and
//! ast-utils.ts: same field handling, same check order, same error text.
//!
//! The one intentional difference: settings the domain model does not know
//! are collected into each group's `unknown_settings` and written back
//! (after the group's known scalar fields, before its nested lists),
//! instead of being dropped.

use crate::ast::{Bracket, ConfigFile, Scalar, ScalarType, ScalarValue, Setting, Value};
use crate::domain::*;
use crate::error::ConfigError;
use crate::jsnum;

type Result<T> = std::result::Result<T, ConfigError>;

/// Read access to one group's settings that remembers which were consumed,
/// so the rest can be kept as `unknown_settings`.
struct Reader<'a> {
    members: &'a [Setting],
    used: Vec<bool>,
    path: String,
}

fn type_name_list(names: &[&str]) -> String {
    names.join(", ")
}

/// Replicates RTLSDR-Airband's parse_anynum2int(): a float literal is MHz
/// and gets scaled to Hz, an int literal is already Hz.
fn to_hz(s: &Scalar, name: &str, path: &str) -> Result<f64> {
    match (s.ty, &s.value) {
        (ScalarType::Float, ScalarValue::Number(n)) => Ok(jsnum::js_round(n * 1e6)),
        (ScalarType::Int | ScalarType::Int64, ScalarValue::Number(n)) => Ok(*n),
        _ => Err(ConfigError::domain(format!("Expected '{name}' to be numeric"), path)),
    }
}

impl<'a> Reader<'a> {
    fn new(members: &'a [Setting], path: impl Into<String>) -> Reader<'a> {
        Reader { members, used: vec![false; members.len()], path: path.into() }
    }

    fn err(&self, message: impl Into<String>) -> ConfigError {
        ConfigError::domain(message, self.path.clone())
    }

    fn has(&self, name: &str) -> bool {
        self.members.iter().any(|m| m.name == name)
    }

    fn find(&mut self, name: &str) -> Option<&'a Setting> {
        let idx = self.members.iter().position(|m| m.name == name)?;
        self.used[idx] = true;
        Some(&self.members[idx])
    }

    fn unknown(&self) -> Vec<Setting> {
        self.members.iter().zip(&self.used).filter(|(_, used)| !**used).map(|(m, _)| m.clone()).collect()
    }

    fn require_value(&mut self, name: &str) -> Result<&'a Value> {
        match self.find(name) {
            Some(s) => Ok(&s.value),
            None => Err(self.err(format!("Missing required field '{name}'"))),
        }
    }

    fn require_scalar(&mut self, name: &str) -> Result<&'a Scalar> {
        match self.require_value(name)? {
            Value::Scalar(s) => Ok(s),
            _ => Err(self.err(format!("Expected '{name}' to be a scalar"))),
        }
    }

    fn optional_scalar(&mut self, name: &str) -> Result<Option<&'a Scalar>> {
        match self.find(name) {
            None => Ok(None),
            Some(Setting { value: Value::Scalar(s), .. }) => Ok(Some(s)),
            Some(_) => Err(self.err(format!("Expected '{name}' to be a scalar"))),
        }
    }

    fn scalar_string(&self, s: &Scalar, name: &str) -> Result<String> {
        match (s.ty, &s.value) {
            (ScalarType::String, ScalarValue::String(v)) => Ok(v.clone()),
            _ => Err(self.err(format!("Expected '{name}' to be a string"))),
        }
    }

    fn scalar_number(&self, s: &Scalar, name: &str) -> Result<f64> {
        s.as_number().ok_or_else(|| self.err(format!("Expected '{name}' to be numeric")))
    }

    fn scalar_bool(&self, s: &Scalar, name: &str) -> Result<bool> {
        match (s.ty, &s.value) {
            (ScalarType::Bool, ScalarValue::Bool(b)) => Ok(*b),
            _ => Err(self.err(format!("Expected '{name}' to be a boolean"))),
        }
    }

    fn require_string(&mut self, name: &str) -> Result<String> {
        let s = self.require_scalar(name)?;
        self.scalar_string(s, name)
    }

    fn optional_string(&mut self, name: &str) -> Result<Option<String>> {
        self.optional_scalar(name)?.map(|s| self.scalar_string(s, name)).transpose()
    }

    fn require_number(&mut self, name: &str) -> Result<f64> {
        let s = self.require_scalar(name)?;
        self.scalar_number(s, name)
    }

    fn optional_number(&mut self, name: &str) -> Result<Option<f64>> {
        self.optional_scalar(name)?.map(|s| self.scalar_number(s, name)).transpose()
    }

    fn require_hz(&mut self, name: &str) -> Result<f64> {
        let s = self.require_scalar(name)?;
        to_hz(s, name, &self.path)
    }

    fn optional_hz(&mut self, name: &str) -> Result<Option<f64>> {
        self.optional_scalar(name)?.map(|s| to_hz(s, name, &self.path)).transpose()
    }

    fn require_bool(&mut self, name: &str) -> Result<bool> {
        let s = self.require_scalar(name)?;
        self.scalar_bool(s, name)
    }

    fn optional_bool(&mut self, name: &str) -> Result<Option<bool>> {
        self.optional_scalar(name)?.map(|s| self.scalar_bool(s, name)).transpose()
    }

    fn require_list(&mut self, name: &str) -> Result<&'a [Value]> {
        match self.require_value(name)? {
            Value::List { items, .. } => Ok(items),
            _ => Err(self.err(format!("Expected '{name}' to be a list"))),
        }
    }

    fn optional_list(&mut self, name: &str) -> Result<Option<&'a [Value]>> {
        match self.find(name) {
            None => Ok(None),
            Some(Setting { value: Value::List { items, .. }, .. }) => Ok(Some(items)),
            Some(_) => Err(self.err(format!("Expected '{name}' to be a list"))),
        }
    }

    fn optional_group(&mut self, name: &str) -> Result<Option<&'a [Setting]>> {
        match self.find(name) {
            None => Ok(None),
            Some(Setting { value: Value::Group { members }, .. }) => Ok(Some(members)),
            Some(_) => Err(self.err(format!("Expected '{name}' to be a group"))),
        }
    }

    fn require_hz_list(&mut self, name: &str) -> Result<Vec<f64>> {
        let items = self.require_list(name)?;
        hz_items(items, name, &self.path)
    }

    fn optional_number_or_list(&mut self, name: &str) -> Result<Option<NumberOrList>> {
        match self.find(name).map(|s| &s.value) {
            None => Ok(None),
            Some(Value::List { items, .. }) => Ok(Some(NumberOrList::Many(number_items(items, name, &self.path)?))),
            Some(Value::Scalar(s)) => Ok(Some(NumberOrList::One(self.scalar_number(s, name)?))),
            Some(_) => Err(self.err(format!("Expected '{name}' to be a number or a list of numbers"))),
        }
    }

    fn optional_hz_or_list(&mut self, name: &str) -> Result<Option<NumberOrList>> {
        match self.find(name).map(|s| &s.value) {
            None => Ok(None),
            Some(Value::List { items, .. }) => Ok(Some(NumberOrList::Many(hz_items(items, name, &self.path)?))),
            Some(Value::Scalar(s)) => Ok(Some(NumberOrList::One(to_hz(s, name, &self.path)?))),
            Some(_) => Err(self.err(format!("Expected '{name}' to be a number or a list of numbers"))),
        }
    }

    fn optional_string_list(&mut self, name: &str) -> Result<Option<Vec<String>>> {
        let Some(items) = self.optional_list(name)? else { return Ok(None) };
        items
            .iter()
            .enumerate()
            .map(|(idx, item)| match item {
                Value::Scalar(Scalar { ty: ScalarType::String, value: ScalarValue::String(v), .. }) => Ok(v.clone()),
                _ => Err(ConfigError::domain(
                    format!("Expected '{name}' list item to be a string"),
                    format!("{}[{idx}]", self.path),
                )),
            })
            .collect::<Result<Vec<_>>>()
            .map(Some)
    }

    fn optional_number_or_string(&mut self, name: &str) -> Result<Option<NumberOrString>> {
        let Some(s) = self.optional_scalar(name)? else { return Ok(None) };
        match (s.ty, &s.value) {
            (ScalarType::String, ScalarValue::String(v)) => Ok(Some(NumberOrString::String(v.clone()))),
            (ScalarType::Int | ScalarType::Int64 | ScalarType::Float, ScalarValue::Number(n)) => {
                Ok(Some(NumberOrString::Number(*n)))
            }
            _ => Err(self.err(format!("Expected '{name}' to be a number or a string"))),
        }
    }
}

fn number_items(items: &[Value], name: &str, path: &str) -> Result<Vec<f64>> {
    items
        .iter()
        .enumerate()
        .map(|(idx, item)| match item {
            Value::Scalar(s) if s.as_number().is_some() => Ok(s.as_number().unwrap()),
            _ => {
                Err(ConfigError::domain(format!("Expected '{name}' list item to be numeric"), format!("{path}[{idx}]")))
            }
        })
        .collect()
}

fn hz_items(items: &[Value], name: &str, path: &str) -> Result<Vec<f64>> {
    items
        .iter()
        .enumerate()
        .map(|(idx, item)| match item {
            Value::Scalar(s) => to_hz(s, name, &format!("{path}[{idx}]")),
            _ => {
                Err(ConfigError::domain(format!("Expected '{name}' list item to be numeric"), format!("{path}[{idx}]")))
            }
        })
        .collect()
}

fn group_items<'a>(items: &'a [Value], path: &str) -> Result<Vec<&'a [Setting]>> {
    items
        .iter()
        .enumerate()
        .map(|(idx, item)| match item {
            Value::Group { members } => Ok(members.as_slice()),
            _ => Err(ConfigError::domain("Expected list item to be a group", format!("{path}[{idx}]"))),
        })
        .collect()
}

// ---------------------------------------------------------------- to domain

pub fn to_domain(ast: &ConfigFile) -> Result<RtlAirbandConfig> {
    let mut r = Reader::new(&ast.members, "$");
    let device_groups = group_items(r.require_list("devices")?, "$.devices")?;

    let multiple_demod_threads = r.require_bool("multiple_demod_threads")?;
    let multiple_output_threads = r.require_bool("multiple_output_threads")?;
    let stats_filepath = r.require_string("stats_filepath")?;
    let localtime = r.require_bool("localtime")?;
    let devices = device_groups
        .iter()
        .enumerate()
        .map(|(i, g)| to_device(g, format!("$.devices[{i}]")))
        .collect::<Result<Vec<_>>>()?;

    let mut config = RtlAirbandConfig {
        multiple_demod_threads,
        multiple_output_threads,
        stats_filepath,
        localtime,
        fft_size: r.optional_number("fft_size")?,
        pidfile: r.optional_string("pidfile")?,
        log_scan_activity: r.optional_bool("log_scan_activity")?,
        shout_metadata_delay: r.optional_number("shout_metadata_delay")?,
        tau: r.optional_number("tau")?,
        stats_http_address: r.optional_string("stats_http_address")?,
        stats_http_port: r.optional_number("stats_http_port")?,
        rdio_scanner_queue_depth: r.optional_number("rdio_scanner_queue_depth")?,
        control_socket_path: r.optional_string("control_socket_path")?,
        stats_update_interval: r.optional_number("stats_update_interval")?,
        split_min_file_time: r.optional_number("split_min_file_time")?,
        split_max_file_time: r.optional_number("split_max_file_time")?,
        split_max_idle_time: r.optional_number("split_max_idle_time")?,
        split_include_transmission_start: r.optional_bool("split_include_transmission_start")?,
        devices,
        mixers: None,
        unknown_settings: Vec::new(),
    };

    if let Some(mixers) = r.find("mixers") {
        let Value::Group { members } = &mixers.value else {
            return Err(ConfigError::domain("Expected 'mixers' to be a group", "$.mixers"));
        };
        config.mixers = Some(
            members
                .iter()
                .map(|m| {
                    let path = format!("$.mixers.{}", m.name);
                    match &m.value {
                        Value::Group { members } => to_mixer(members, &m.name, path),
                        _ => Err(ConfigError::domain(format!("Expected mixer '{}' to be a group", m.name), path)),
                    }
                })
                .collect::<Result<Vec<_>>>()?,
        );
    }
    config.unknown_settings = r.unknown();
    Ok(config)
}

fn to_device(g: &[Setting], path: String) -> Result<Device> {
    let mut r = Reader::new(g, path);
    let channel_groups = group_items(r.require_list("channels")?, &format!("{}.channels", r.path))?;
    let device_type = r.require_string("type")?;
    let channels = channel_groups
        .iter()
        .enumerate()
        .map(|(i, c)| to_channel(c, format!("{}.channels[{i}]", r.path)))
        .collect::<Result<Vec<_>>>()?;
    let mut device = Device {
        device_type,
        serial: r.optional_string("serial")?,
        index: r.optional_number("index")?,
        gain: r.optional_number_or_string("gain")?,
        centerfreq: r.optional_hz("centerfreq")?,
        sample_rate: r.optional_hz("sample_rate")?,
        correction: r.optional_number("correction")?,
        bandwidth: r.optional_number("bandwidth")?,
        mode: None,
        reserve_channels: None,
        disable: None,
        tau: None,
        buffers: None,
        num_buffers: None,
        device_string: None,
        channel: None,
        antenna: None,
        channels,
        unknown_settings: Vec::new(),
    };
    device.mode = match r.optional_string("mode")?.as_deref() {
        None => None,
        Some("multichannel") => Some(DeviceMode::Multichannel),
        Some("scan") => Some(DeviceMode::Scan),
        Some(other) => {
            return Err(r.err(format!(
                "Invalid mode value '{other}' (must be one of: {})",
                type_name_list(&["multichannel", "scan"])
            )));
        }
    };
    device.reserve_channels = r.optional_number("reserve_channels")?;
    device.disable = r.optional_bool("disable")?;
    device.tau = r.optional_number("tau")?;
    device.buffers = r.optional_number("buffers")?;
    device.num_buffers = r.optional_number("num_buffers")?;
    device.device_string = r.optional_string("device_string")?;
    device.channel = r.optional_number("channel")?;
    device.antenna = r.optional_string("antenna")?;
    device.unknown_settings = r.unknown();
    Ok(device)
}

fn to_channel(g: &[Setting], path: String) -> Result<Channel> {
    let r = Reader::new(g, path);
    let (has_freqs, has_freq) = (r.has("freqs"), r.has("freq"));
    if has_freqs == has_freq {
        return Err(r.err("Channel must have exactly one of 'freq' (multichannel) or 'freqs' (scan mode)"));
    }
    if has_freqs {
        to_scan_channel(r).map(Channel::Scan)
    } else {
        to_multichannel_channel(r).map(Channel::Multichannel)
    }
}

fn outputs_of(r: &mut Reader) -> Result<Vec<Output>> {
    let groups = group_items(r.require_list("outputs")?, &format!("{}.outputs", r.path))?;
    groups.iter().enumerate().map(|(i, o)| to_output(o, format!("{}.outputs[{i}]", r.path))).collect()
}

fn to_multichannel_channel(mut r: Reader) -> Result<MultichannelChannel> {
    let outputs_items = group_items(r.require_list("outputs")?, &format!("{}.outputs", r.path))?;
    let freq = r.require_hz("freq")?;
    let outputs = outputs_items
        .iter()
        .enumerate()
        .map(|(i, o)| to_output(o, format!("{}.outputs[{i}]", r.path)))
        .collect::<Result<Vec<_>>>()?;
    let mut c = MultichannelChannel {
        freq,
        label: r.optional_string("label")?,
        afc: r.optional_number("afc")?,
        modulation: r.optional_string("modulation")?,
        bandwidth: r.optional_hz("bandwidth")?,
        ampfactor: r.optional_number("ampfactor")?,
        ctcss: r.optional_number("ctcss")?,
        notch: r.optional_number("notch")?,
        notch_q: r.optional_number("notch_q")?,
        highpass: r.optional_number("highpass")?,
        lowpass: r.optional_number("lowpass")?,
        tau: r.optional_number("tau")?,
        squelch_threshold: r.optional_number("squelch_threshold")?,
        squelch_snr_threshold: r.optional_number("squelch_snr_threshold")?,
        disable: r.optional_bool("disable")?,
        enabled: r.optional_bool("enabled")?,
        outputs,
        unknown_settings: Vec::new(),
    };
    c.unknown_settings = r.unknown();
    Ok(c)
}

fn to_scan_channel(mut r: Reader) -> Result<ScanChannel> {
    let outputs_items = group_items(r.require_list("outputs")?, &format!("{}.outputs", r.path))?;
    let freqs = r.require_hz_list("freqs")?;
    let outputs = outputs_items
        .iter()
        .enumerate()
        .map(|(i, o)| to_output(o, format!("{}.outputs[{i}]", r.path)))
        .collect::<Result<Vec<_>>>()?;
    let mut c = ScanChannel {
        freqs,
        labels: r.optional_string_list("labels")?,
        modulation: r.optional_string("modulation")?,
        modulations: r.optional_string_list("modulations")?,
        bandwidth: r.optional_hz_or_list("bandwidth")?,
        ampfactor: r.optional_number_or_list("ampfactor")?,
        afc: r.optional_number("afc")?,
        ctcss: r.optional_number_or_list("ctcss")?,
        notch: r.optional_number_or_list("notch")?,
        notch_q: r.optional_number_or_list("notch_q")?,
        highpass: r.optional_number("highpass")?,
        lowpass: r.optional_number("lowpass")?,
        tau: r.optional_number("tau")?,
        squelch_threshold: r.optional_number_or_list("squelch_threshold")?,
        squelch_snr_threshold: r.optional_number_or_list("squelch_snr_threshold")?,
        disable: r.optional_bool("disable")?,
        enabled: r.optional_bool("enabled")?,
        outputs,
        unknown_settings: Vec::new(),
    };
    c.unknown_settings = r.unknown();
    Ok(c)
}

fn to_mixer(g: &[Setting], name: &str, path: String) -> Result<Mixer> {
    let mut r = Reader::new(g, path);
    let outputs = outputs_of(&mut r)?;
    if let Some(i) = outputs.iter().position(|o| matches!(o, Output::Mixer(_))) {
        return Err(ConfigError::domain(
            "A mixer's outputs cannot themselves be of type 'mixer'",
            format!("{}.outputs[{i}]", r.path),
        ));
    }
    let mut mixer = Mixer {
        name: name.to_string(),
        disable: r.optional_bool("disable")?,
        enabled: r.optional_bool("enabled")?,
        highpass: r.optional_number("highpass")?,
        lowpass: r.optional_number("lowpass")?,
        reserve_inputs: r.optional_number("reserve_inputs")?,
        remote_inputs: None,
        outputs,
        unknown_settings: Vec::new(),
    };
    if r.has("remote_inputs") {
        let groups = group_items(r.require_list("remote_inputs")?, &format!("{}.remote_inputs", r.path))?;
        mixer.remote_inputs = Some(
            groups
                .iter()
                .enumerate()
                .map(|(i, g)| to_mixer_remote_input(g, format!("{}.remote_inputs[{i}]", r.path)))
                .collect::<Result<Vec<_>>>()?,
        );
    }
    mixer.unknown_settings = r.unknown();
    Ok(mixer)
}

fn to_mixer_remote_input(g: &[Setting], path: String) -> Result<MixerRemoteInput> {
    let mut r = Reader::new(g, path);
    let mut out = MixerRemoteInput {
        listen_path: r.require_string("listen_path")?,
        stream_id: r.require_number("stream_id")?,
        ampfactor: r.optional_number("ampfactor")?,
        balance: r.optional_number("balance")?,
        label: r.optional_string("label")?,
        unknown_settings: Vec::new(),
    };
    out.unknown_settings = r.unknown();
    Ok(out)
}

fn to_output(g: &[Setting], path: String) -> Result<Output> {
    let mut r = Reader::new(g, path);
    let output_type = r.require_string("type")?;
    let output = match output_type.as_str() {
        "pulse" => Output::Pulse(PulseOutput {
            server: r.optional_string("server")?,
            sink: r.optional_string("sink")?,
            name: r.optional_string("name")?,
            stream_name: r.optional_string("stream_name")?,
            continuous: r.optional_bool("continuous")?,
            disable: r.optional_bool("disable")?,
            unknown_settings: Vec::new(),
        }),
        "file" => {
            let mut out = FileOutput {
                directory: r.require_string("directory")?,
                filename_template: r.require_string("filename_template")?,
                continuous: r.optional_bool("continuous")?,
                split_on_transmission: r.optional_bool("split_on_transmission")?,
                include_freq: r.optional_bool("include_freq")?,
                append: r.optional_bool("append")?,
                dated_subdirectories: r.optional_bool("dated_subdirectories")?,
                disable: r.optional_bool("disable")?,
                min_rx_seconds: r.optional_number("min_rx_seconds")?,
                post_write_script: r.optional_string("post_write_script")?,
                ..Default::default()
            };
            if let Some(g) = r.optional_group("rdio_scanner")? {
                out.rdio_scanner = Some(to_rdio_scanner(g, format!("{}.rdio_scanner", r.path))?);
            }
            out.split_min_file_time = r.optional_number("split_min_file_time")?;
            out.split_max_file_time = r.optional_number("split_max_file_time")?;
            out.split_max_idle_time = r.optional_number("split_max_idle_time")?;
            out.split_include_transmission_start = r.optional_bool("split_include_transmission_start")?;
            Output::File(out)
        }
        "rawfile" => Output::RawFile(RawFileOutput {
            directory: r.require_string("directory")?,
            filename_template: r.require_string("filename_template")?,
            continuous: r.optional_bool("continuous")?,
            split_on_transmission: r.optional_bool("split_on_transmission")?,
            include_freq: r.optional_bool("include_freq")?,
            append: r.optional_bool("append")?,
            dated_subdirectories: r.optional_bool("dated_subdirectories")?,
            disable: r.optional_bool("disable")?,
            split_min_file_time: r.optional_number("split_min_file_time")?,
            split_max_file_time: r.optional_number("split_max_file_time")?,
            split_max_idle_time: r.optional_number("split_max_idle_time")?,
            split_include_transmission_start: r.optional_bool("split_include_transmission_start")?,
            unknown_settings: Vec::new(),
        }),
        "icecast" => {
            let mut out = IcecastOutput {
                server: r.require_string("server")?,
                port: r.require_number("port")?,
                mountpoint: r.require_string("mountpoint")?,
                username: r.require_string("username")?,
                password: r.require_string("password")?,
                name: r.optional_string("name")?,
                genre: r.optional_string("genre")?,
                description: r.optional_string("description")?,
                send_scan_freq_tags: r.optional_bool("send_scan_freq_tags")?,
                send_tx_tags: r.optional_bool("send_tx_tags")?,
                ..Default::default()
            };
            if let Some(tls) = r.optional_string("tls")? {
                out.tls = Some(TlsMode::ALL.into_iter().find(|m| m.as_str() == tls).ok_or_else(|| {
                    let all: Vec<&str> = TlsMode::ALL.iter().map(|m| m.as_str()).collect();
                    r.err(format!("Invalid tls value '{tls}' (must be one of: {})", type_name_list(&all)))
                })?);
            }
            out.disable = r.optional_bool("disable")?;
            Output::Icecast(out)
        }
        "udp_stream" => {
            let dest_address = r.require_string("dest_address")?;
            // dest_port may be authored as an int or a string; normalize to string either way.
            let dest_port = match r.find("dest_port").map(|s| &s.value) {
                Some(Value::Scalar(s)) => match (&s.ty, &s.value) {
                    (ScalarType::String, ScalarValue::String(v)) => v.clone(),
                    (_, ScalarValue::Number(n)) => jsnum::to_js_string(*n),
                    _ => return Err(r.err("Expected 'dest_port' to be a string or number")),
                },
                _ => return Err(r.err("Missing required field 'dest_port'")),
            };
            let bit_depth = r.optional_number("bit_depth")?;
            if let Some(b) = bit_depth
                && ![8.0, 16.0, 32.0].contains(&b)
            {
                return Err(
                    r.err(format!("Invalid bit_depth value '{}' (must be one of: 8, 16, 32)", jsnum::to_js_string(b)))
                );
            }
            Output::UdpStream(UdpStreamOutput {
                dest_address,
                dest_port,
                bit_depth,
                sample_rate: r.optional_number("sample_rate")?,
                continuous: r.optional_bool("continuous")?,
                disable: r.optional_bool("disable")?,
                unknown_settings: Vec::new(),
            })
        }
        "mixer" => Output::Mixer(MixerOutput {
            name: r.require_string("name")?,
            ampfactor: r.optional_number("ampfactor")?,
            balance: r.optional_number("balance")?,
            disable: r.optional_bool("disable")?,
            unknown_settings: Vec::new(),
        }),
        "mixer_remote" => Output::MixerRemote(MixerRemoteOutput {
            dest_path: r.require_string("dest_path")?,
            stream_id: r.require_number("stream_id")?,
            disable: r.optional_bool("disable")?,
            unknown_settings: Vec::new(),
        }),
        other => return Err(r.err(format!("Unrecognized output type '{other}'"))),
    };
    let unknown = r.unknown();
    Ok(with_unknown(output, unknown))
}

fn with_unknown(mut output: Output, unknown: Vec<Setting>) -> Output {
    let slot = match &mut output {
        Output::Pulse(o) => &mut o.unknown_settings,
        Output::File(o) => &mut o.unknown_settings,
        Output::RawFile(o) => &mut o.unknown_settings,
        Output::Icecast(o) => &mut o.unknown_settings,
        Output::UdpStream(o) => &mut o.unknown_settings,
        Output::Mixer(o) => &mut o.unknown_settings,
        Output::MixerRemote(o) => &mut o.unknown_settings,
    };
    *slot = unknown;
    output
}

fn to_rdio_scanner(g: &[Setting], path: String) -> Result<RdioScannerConfig> {
    let mut r = Reader::new(g, path);
    let mut out = RdioScannerConfig {
        server: r.require_string("server")?,
        port: r.require_number("port")?,
        api_key: r.require_string("api_key")?,
        talkgroup_id: r.require_number("talkgroup_id")?,
        use_tls: r.optional_bool("use_tls")?,
        system_id: r.optional_number("system_id")?,
        system_label: r.optional_string("system_label")?,
        talkgroup_label: r.optional_string("talkgroup_label")?,
        talkgroup_tag: r.optional_string("talkgroup_tag")?,
        talkgroup_group: r.optional_string("talkgroup_group")?,
        source_id: r.optional_number("source_id")?,
        delete_after_upload: r.optional_bool("delete_after_upload")?,
        timeout_ms: r.optional_number("timeout_ms")?,
        max_retries: r.optional_number("max_retries")?,
        disable: None,
        unknown_settings: Vec::new(),
    };
    out.unknown_settings = r.unknown();
    Ok(out)
}

// -------------------------------------------------------------- from domain

/// Accumulates a group's settings in output order.
#[derive(Default)]
struct Members(Vec<Setting>);

impl Members {
    fn push(&mut self, name: &str, value: Value) -> &mut Self {
        self.0.push(Setting::new(name, value));
        self
    }
    fn string(&mut self, name: &str, v: &str) -> &mut Self {
        self.push(name, Value::Scalar(Scalar::string(v)))
    }
    fn opt_string(&mut self, name: &str, v: &Option<String>) -> &mut Self {
        if let Some(v) = v {
            self.string(name, v);
        }
        self
    }
    fn bool(&mut self, name: &str, v: bool) -> &mut Self {
        self.push(name, Value::Scalar(Scalar::bool(v)))
    }
    fn opt_bool(&mut self, name: &str, v: Option<bool>) -> &mut Self {
        if let Some(v) = v {
            self.bool(name, v);
        }
        self
    }
    fn int(&mut self, name: &str, v: f64) -> &mut Self {
        self.push(name, Value::Scalar(Scalar::int(v)))
    }
    fn opt_int(&mut self, name: &str, v: Option<f64>) -> &mut Self {
        if let Some(v) = v {
            self.int(name, v);
        }
        self
    }
    fn opt_float(&mut self, name: &str, v: Option<f64>) -> &mut Self {
        if let Some(v) = v {
            self.push(name, Value::Scalar(Scalar::float(v)));
        }
        self
    }
    fn opt_number_or_list(&mut self, name: &str, v: &Option<NumberOrList>, float: bool) -> &mut Self {
        let make = |n: f64| if float { Scalar::float(n) } else { Scalar::int(n) };
        match v {
            None => {}
            Some(NumberOrList::One(n)) => {
                self.push(name, Value::Scalar(make(*n)));
            }
            Some(NumberOrList::Many(ns)) => {
                self.push(name, list(ns.iter().map(|n| Value::Scalar(make(*n))).collect()));
            }
        }
        self
    }
    fn opt_string_list(&mut self, name: &str, v: &Option<Vec<String>>) -> &mut Self {
        if let Some(v) = v {
            self.push(name, list(v.iter().map(|s| Value::Scalar(Scalar::string(s))).collect()));
        }
        self
    }
    fn unknown(&mut self, settings: &[Setting]) -> &mut Self {
        self.0.extend(settings.iter().cloned());
        self
    }
    fn into_group(self) -> Value {
        Value::Group { members: self.0 }
    }
}

fn list(items: Vec<Value>) -> Value {
    Value::List { bracket: Bracket::Paren, items }
}

pub fn from_domain(config: &RtlAirbandConfig) -> ConfigFile {
    let mut m = Members::default();
    m.bool("multiple_demod_threads", config.multiple_demod_threads)
        .bool("multiple_output_threads", config.multiple_output_threads)
        .string("stats_filepath", &config.stats_filepath)
        .bool("localtime", config.localtime)
        .opt_int("fft_size", config.fft_size)
        .opt_string("pidfile", &config.pidfile)
        .opt_bool("log_scan_activity", config.log_scan_activity)
        .opt_int("shout_metadata_delay", config.shout_metadata_delay)
        .opt_int("tau", config.tau)
        .opt_string("stats_http_address", &config.stats_http_address)
        .opt_int("stats_http_port", config.stats_http_port)
        .opt_int("rdio_scanner_queue_depth", config.rdio_scanner_queue_depth)
        .opt_string("control_socket_path", &config.control_socket_path)
        .opt_float("stats_update_interval", config.stats_update_interval)
        .opt_float("split_min_file_time", config.split_min_file_time)
        .opt_float("split_max_file_time", config.split_max_file_time)
        .opt_float("split_max_idle_time", config.split_max_idle_time)
        .opt_bool("split_include_transmission_start", config.split_include_transmission_start)
        .unknown(&config.unknown_settings)
        .push("devices", list(config.devices.iter().map(device_from_domain).collect()));
    if let Some(mixers) = &config.mixers {
        m.push("mixers", Value::Group { members: mixers.iter().map(mixer_from_domain).collect() });
    }
    ConfigFile { members: m.0 }
}

fn number_or_string(v: &NumberOrString) -> Value {
    match v {
        NumberOrString::String(s) => Value::Scalar(Scalar::string(s)),
        NumberOrString::Number(n) if jsnum::is_integer(*n) => Value::Scalar(Scalar::int(*n)),
        NumberOrString::Number(n) => Value::Scalar(Scalar::float(*n)),
    }
}

fn device_from_domain(d: &Device) -> Value {
    let mut m = Members::default();
    m.string("type", &d.device_type).opt_string("serial", &d.serial).opt_int("index", d.index);
    if let Some(gain) = &d.gain {
        m.push("gain", number_or_string(gain));
    }
    m.opt_int("centerfreq", d.centerfreq)
        .opt_int("sample_rate", d.sample_rate)
        .opt_int("correction", d.correction)
        .opt_int("bandwidth", d.bandwidth);
    if let Some(mode) = d.mode {
        m.string("mode", mode.as_str());
    }
    m.opt_int("reserve_channels", d.reserve_channels)
        .opt_bool("disable", d.disable)
        .opt_int("tau", d.tau)
        .opt_int("buffers", d.buffers)
        .opt_int("num_buffers", d.num_buffers)
        .opt_string("device_string", &d.device_string)
        .opt_int("channel", d.channel)
        .opt_string("antenna", &d.antenna)
        .unknown(&d.unknown_settings)
        .push("channels", list(d.channels.iter().map(channel_from_domain).collect()));
    m.into_group()
}

fn channel_from_domain(c: &Channel) -> Value {
    let mut m = Members::default();
    match c {
        Channel::Multichannel(c) => {
            m.int("freq", c.freq)
                .opt_string("label", &c.label)
                .opt_int("bandwidth", c.bandwidth)
                .opt_float("ampfactor", c.ampfactor)
                .opt_int("afc", c.afc)
                .opt_string("modulation", &c.modulation)
                .opt_float("ctcss", c.ctcss)
                .opt_float("notch", c.notch)
                .opt_float("notch_q", c.notch_q)
                .opt_int("highpass", c.highpass)
                .opt_int("lowpass", c.lowpass)
                .opt_int("tau", c.tau)
                .opt_int("squelch_threshold", c.squelch_threshold)
                .opt_int("squelch_snr_threshold", c.squelch_snr_threshold)
                .opt_bool("disable", c.disable)
                .opt_bool("enabled", c.enabled)
                .unknown(&c.unknown_settings)
                .push("outputs", list(c.outputs.iter().map(output_from_domain).collect()));
        }
        Channel::Scan(c) => {
            m.push("freqs", list(c.freqs.iter().map(|f| Value::Scalar(Scalar::int(*f))).collect()))
                .opt_string_list("labels", &c.labels)
                .opt_string("modulation", &c.modulation)
                .opt_string_list("modulations", &c.modulations)
                .opt_number_or_list("bandwidth", &c.bandwidth, false)
                .opt_number_or_list("ampfactor", &c.ampfactor, true)
                .opt_int("afc", c.afc)
                .opt_number_or_list("ctcss", &c.ctcss, true)
                .opt_number_or_list("notch", &c.notch, true)
                .opt_number_or_list("notch_q", &c.notch_q, true)
                .opt_int("highpass", c.highpass)
                .opt_int("lowpass", c.lowpass)
                .opt_int("tau", c.tau)
                .opt_number_or_list("squelch_threshold", &c.squelch_threshold, false)
                .opt_number_or_list("squelch_snr_threshold", &c.squelch_snr_threshold, true)
                .opt_bool("disable", c.disable)
                .opt_bool("enabled", c.enabled)
                .unknown(&c.unknown_settings)
                .push("outputs", list(c.outputs.iter().map(output_from_domain).collect()));
        }
    }
    m.into_group()
}

fn mixer_from_domain(mixer: &Mixer) -> Setting {
    let mut m = Members::default();
    m.opt_bool("disable", mixer.disable)
        .opt_bool("enabled", mixer.enabled)
        .opt_int("highpass", mixer.highpass)
        .opt_int("lowpass", mixer.lowpass)
        .opt_int("reserve_inputs", mixer.reserve_inputs)
        .unknown(&mixer.unknown_settings);
    if let Some(inputs) = &mixer.remote_inputs
        && !inputs.is_empty()
    {
        m.push("remote_inputs", list(inputs.iter().map(remote_input_from_domain).collect()));
    }
    m.push("outputs", list(mixer.outputs.iter().map(output_from_domain).collect()));
    Setting::new(&mixer.name, m.into_group())
}

fn remote_input_from_domain(i: &MixerRemoteInput) -> Value {
    let mut m = Members::default();
    m.string("listen_path", &i.listen_path)
        .int("stream_id", i.stream_id)
        .opt_float("ampfactor", i.ampfactor)
        .opt_float("balance", i.balance)
        .opt_string("label", &i.label)
        .unknown(&i.unknown_settings);
    m.into_group()
}

fn output_from_domain(output: &Output) -> Value {
    let mut m = Members::default();
    m.string("type", output.type_name());
    match output {
        Output::Pulse(o) => {
            m.opt_string("server", &o.server)
                .opt_string("sink", &o.sink)
                .opt_string("name", &o.name)
                .opt_string("stream_name", &o.stream_name)
                .opt_bool("continuous", o.continuous)
                .opt_bool("disable", o.disable)
                .unknown(&o.unknown_settings);
        }
        Output::File(o) => {
            m.string("directory", &o.directory)
                .string("filename_template", &o.filename_template)
                .opt_bool("continuous", o.continuous)
                .opt_bool("split_on_transmission", o.split_on_transmission)
                .opt_bool("include_freq", o.include_freq)
                .opt_bool("append", o.append)
                .opt_bool("dated_subdirectories", o.dated_subdirectories)
                .opt_bool("disable", o.disable)
                .opt_float("min_rx_seconds", o.min_rx_seconds)
                .opt_string("post_write_script", &o.post_write_script);
            if let Some(rdio) = &o.rdio_scanner
                && rdio.disable != Some(true)
            {
                m.push("rdio_scanner", rdio_from_domain(rdio));
            }
            m.opt_float("split_min_file_time", o.split_min_file_time)
                .opt_float("split_max_file_time", o.split_max_file_time)
                .opt_float("split_max_idle_time", o.split_max_idle_time)
                .opt_bool("split_include_transmission_start", o.split_include_transmission_start)
                .unknown(&o.unknown_settings);
        }
        Output::RawFile(o) => {
            m.string("directory", &o.directory)
                .string("filename_template", &o.filename_template)
                .opt_bool("continuous", o.continuous)
                .opt_bool("split_on_transmission", o.split_on_transmission)
                .opt_bool("include_freq", o.include_freq)
                .opt_bool("append", o.append)
                .opt_bool("dated_subdirectories", o.dated_subdirectories)
                .opt_bool("disable", o.disable)
                .opt_float("split_min_file_time", o.split_min_file_time)
                .opt_float("split_max_file_time", o.split_max_file_time)
                .opt_float("split_max_idle_time", o.split_max_idle_time)
                .opt_bool("split_include_transmission_start", o.split_include_transmission_start)
                .unknown(&o.unknown_settings);
        }
        Output::Icecast(o) => {
            m.string("server", &o.server)
                .int("port", o.port)
                .string("mountpoint", &o.mountpoint)
                .string("username", &o.username)
                .string("password", &o.password)
                .opt_string("name", &o.name)
                .opt_string("genre", &o.genre)
                .opt_string("description", &o.description)
                .opt_bool("send_scan_freq_tags", o.send_scan_freq_tags)
                .opt_bool("send_tx_tags", o.send_tx_tags);
            if let Some(tls) = o.tls {
                m.string("tls", tls.as_str());
            }
            m.opt_bool("disable", o.disable).unknown(&o.unknown_settings);
        }
        Output::UdpStream(o) => {
            m.string("dest_address", &o.dest_address)
                .string("dest_port", &o.dest_port)
                .opt_int("bit_depth", o.bit_depth)
                .opt_int("sample_rate", o.sample_rate)
                .opt_bool("continuous", o.continuous)
                .opt_bool("disable", o.disable)
                .unknown(&o.unknown_settings);
        }
        Output::Mixer(o) => {
            m.string("name", &o.name)
                .opt_float("ampfactor", o.ampfactor)
                .opt_float("balance", o.balance)
                .opt_bool("disable", o.disable)
                .unknown(&o.unknown_settings);
        }
        Output::MixerRemote(o) => {
            m.string("dest_path", &o.dest_path)
                .int("stream_id", o.stream_id)
                .opt_bool("disable", o.disable)
                .unknown(&o.unknown_settings);
        }
    }
    m.into_group()
}

fn rdio_from_domain(c: &RdioScannerConfig) -> Value {
    let mut m = Members::default();
    m.string("server", &c.server)
        .int("port", c.port)
        .string("api_key", &c.api_key)
        .int("talkgroup_id", c.talkgroup_id)
        .opt_bool("use_tls", c.use_tls)
        .opt_int("system_id", c.system_id)
        .opt_string("system_label", &c.system_label)
        .opt_string("talkgroup_label", &c.talkgroup_label)
        .opt_string("talkgroup_tag", &c.talkgroup_tag)
        .opt_string("talkgroup_group", &c.talkgroup_group)
        .opt_int("source_id", c.source_id)
        .opt_bool("delete_after_upload", c.delete_after_upload)
        .opt_int("timeout_ms", c.timeout_ms)
        .opt_int("max_retries", c.max_retries)
        .unknown(&c.unknown_settings);
    m.into_group()
}
