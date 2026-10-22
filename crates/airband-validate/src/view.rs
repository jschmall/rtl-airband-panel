//! Uniform read access over the domain model's channel and output shapes,
//! standing in for the TS checks' structural (`"freq" in channel`) access.

use airband_config::domain::{Channel, Device, NumberOrList, Output, RtlAirbandConfig};

/// A field that is a single value or a per-frequency list.
#[derive(Clone, Copy)]
pub enum Vals<'a> {
    One(f64),
    Many(&'a [f64]),
}

fn from_nol(v: &Option<NumberOrList>) -> Option<Vals<'_>> {
    match v {
        None => None,
        Some(NumberOrList::One(n)) => Some(Vals::One(*n)),
        Some(NumberOrList::Many(ns)) => Some(Vals::Many(ns)),
    }
}

pub trait ChannelView {
    fn freq(&self) -> Option<f64>;
    fn is_scan(&self) -> bool;
    fn lowpass(&self) -> Option<f64>;
    fn highpass(&self) -> Option<f64>;
    fn modulation(&self) -> Option<&str>;
    fn ampfactor(&self) -> Option<Vals<'_>>;
    fn ctcss(&self) -> Option<Vals<'_>>;
    fn notch_q(&self) -> Option<Vals<'_>>;
    fn squelch_threshold(&self) -> Option<Vals<'_>>;
    fn squelch_snr_threshold(&self) -> Option<Vals<'_>>;
    fn disable(&self) -> Option<bool>;
    fn enabled(&self) -> Option<bool>;
}

impl ChannelView for Channel {
    fn freq(&self) -> Option<f64> {
        match self {
            Channel::Multichannel(c) => Some(c.freq),
            Channel::Scan(_) => None,
        }
    }
    fn is_scan(&self) -> bool {
        matches!(self, Channel::Scan(_))
    }
    fn lowpass(&self) -> Option<f64> {
        match self {
            Channel::Multichannel(c) => c.lowpass,
            Channel::Scan(c) => c.lowpass,
        }
    }
    fn highpass(&self) -> Option<f64> {
        match self {
            Channel::Multichannel(c) => c.highpass,
            Channel::Scan(c) => c.highpass,
        }
    }
    fn modulation(&self) -> Option<&str> {
        match self {
            Channel::Multichannel(c) => c.modulation.as_deref(),
            Channel::Scan(c) => c.modulation.as_deref(),
        }
    }
    fn ampfactor(&self) -> Option<Vals<'_>> {
        match self {
            Channel::Multichannel(c) => c.ampfactor.map(Vals::One),
            Channel::Scan(c) => from_nol(&c.ampfactor),
        }
    }
    fn ctcss(&self) -> Option<Vals<'_>> {
        match self {
            Channel::Multichannel(c) => c.ctcss.map(Vals::One),
            Channel::Scan(c) => from_nol(&c.ctcss),
        }
    }
    fn notch_q(&self) -> Option<Vals<'_>> {
        match self {
            Channel::Multichannel(c) => c.notch_q.map(Vals::One),
            Channel::Scan(c) => from_nol(&c.notch_q),
        }
    }
    fn squelch_threshold(&self) -> Option<Vals<'_>> {
        match self {
            Channel::Multichannel(c) => c.squelch_threshold.map(Vals::One),
            Channel::Scan(c) => from_nol(&c.squelch_threshold),
        }
    }
    fn squelch_snr_threshold(&self) -> Option<Vals<'_>> {
        match self {
            Channel::Multichannel(c) => c.squelch_snr_threshold.map(Vals::One),
            Channel::Scan(c) => from_nol(&c.squelch_snr_threshold),
        }
    }
    fn disable(&self) -> Option<bool> {
        match self {
            Channel::Multichannel(c) => c.disable,
            Channel::Scan(c) => c.disable,
        }
    }
    fn enabled(&self) -> Option<bool> {
        match self {
            Channel::Multichannel(c) => c.enabled,
            Channel::Scan(c) => c.enabled,
        }
    }
}

pub fn is_scan_device(device: &Device) -> bool {
    device.mode == Some(airband_config::domain::DeviceMode::Scan)
}

/// Where an output list lives.
pub enum Owner<'a> {
    /// A device channel's outputs.
    Channel { device: &'a Device },
    /// A top-level mixer's own outputs.
    Mixer,
}

/// Visits every output list in TS check order: device channels first, then
/// mixers. `prefix` is the path of the list's owner (`$.devices[0].channels[1]`
/// or `$.mixers[0]`).
pub fn for_each_output_list<'a>(config: &'a RtlAirbandConfig, mut f: impl FnMut(&str, &'a [Output], Owner<'a>)) {
    for (di, device) in config.devices.iter().enumerate() {
        for (ci, channel) in device.channels.iter().enumerate() {
            f(&format!("$.devices[{di}].channels[{ci}]"), channel.outputs(), Owner::Channel { device });
        }
    }
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        f(&format!("$.mixers[{mi}]"), &mixer.outputs, Owner::Mixer);
    }
}

/// `String(n)` formatting for numbers interpolated into messages.
pub fn js(n: f64) -> String {
    airband_config::jsnum::to_js_string(n)
}
