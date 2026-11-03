//! Settings that need the jschmall/RTLSDR-Airband fork, checked only when
//! the instance is known to run a build without them (`validate_config_for`
//! with its feature list). A stock rtl_airband ignores most of them, which
//! is a warning; the one it refuses to start with (a `mixer_remote` output,
//! which its prefix match reads as a `mixer` output) is an error.
//!
//! A fork build's Features line also lists the optional drivers compiled in
//! (`soapysdr`, and `mirisdr` until upstream v7.0.0 removed that driver), so
//! on a fork build a device whose driver isn't listed is an error: rtl_airband
//! won't start with it. Stock builds don't say, so their drivers aren't
//! checked.

use airband_config::domain::{Channel, Output, RtlAirbandConfig};

use crate::types::Issues;
use crate::view::for_each_output_list;

const CODE: &str = "needs-fork-feature";

struct Gate<'a> {
    features: &'a [String],
    issues: &'a mut Issues,
}

impl Gate<'_> {
    fn missing(&self, feature: &str) -> bool {
        !self.features.iter().any(|f| f == feature)
    }

    /// Warns, with a custom first sentence, that the setting at `path` is
    /// ignored without `feature`.
    fn ignored_needs(&mut self, feature: &str, needs: &str, path: String, consequence: &str) {
        if self.missing(feature) {
            self.issues.warning(
                CODE,
                path,
                format!("{needs} This instance's rtl_airband ignores it, so {consequence}."),
            );
        }
    }

    /// Warns that the setting at `path` (which the UI labels) is ignored
    /// without `feature`, with what that means.
    fn ignored(&mut self, feature: &str, path: String, consequence: &str) {
        if self.missing(feature) {
            self.issues.warning(
                CODE,
                path,
                format!(
                    "Needs the jschmall RTLSDR-Airband fork. This instance's rtl_airband ignores it, so {consequence}."
                ),
            );
        }
    }
}

pub fn check(config: &RtlAirbandConfig, features: &[String], issues: &mut Issues) {
    let mut g = Gate { features, issues };

    if config.control_socket_path.is_some() {
        g.ignored("control_socket", "$.control_socket_path".into(), "changes can't be applied live");
    }
    if config.stats_http_address.is_some() {
        g.ignored("stats_http", "$.stats_http_address".into(), "there's no stats HTTP endpoint");
    }
    if config.stats_http_port.is_some() {
        g.ignored("stats_http", "$.stats_http_port".into(), "there's no stats HTTP endpoint");
    }
    if config.rdio_scanner_queue_depth.is_some() {
        g.ignored("rdio_scanner", "$.rdio_scanner_queue_depth".into(), "nothing is uploaded");
    }

    let is_fork_build = !g.missing("fork");
    for (di, device) in config.devices.iter().enumerate() {
        if is_fork_build && device.disable != Some(true) {
            let ty = device.device_type.as_str();
            let missing_driver = match ty {
                "mirisdr" if g.missing("mirisdr") => Some(
                    "built without the mirisdr driver (upstream v7.0.0 and fork v7.1.0 removed it), so it won't start with this device. Use an older rtl_airband build for Mirics dongles",
                ),
                "soapysdr" if g.missing("soapysdr") => Some(
                    "built without SoapySDR (the bundled build has it turned off), so it won't start with this device. Build rtl_airband with SoapySDR for this device",
                ),
                _ => None,
            };
            if let Some(why) = missing_driver {
                g.issues.error(
                    "device-driver-not-built",
                    format!("$.devices[{di}]"),
                    format!("This instance's rtl_airband was {why}."),
                );
            }
        }
        if device.auto_ppm.is_some() {
            g.ignored_needs(
                "auto_ppm",
                "Needs jschmall RTLSDR-Airband fork v6.6.0 or newer.",
                format!("$.devices[{di}].auto_ppm"),
                "correction stays where it's set",
            );
        }
        if device.buffer_size.is_some() {
            g.ignored_needs(
                "usb_chunk_sizing",
                "Needs jschmall RTLSDR-Airband fork v7.2.0 or newer.",
                format!("$.devices[{di}].buffer_size"),
                "USB transfers stay at 320000 bytes",
            );
        }
        if device.reserve_channels.is_some() {
            g.ignored(
                "reserve",
                format!("$.devices[{di}].reserve_channels"),
                "adding a channel always needs a restart",
            );
        }
        for (ci, channel) in device.channels.iter().enumerate() {
            let enabled = match channel {
                Channel::Multichannel(c) => c.enabled,
                Channel::Scan(c) => c.enabled,
            };
            if enabled == Some(false) {
                g.ignored(
                    "control_socket",
                    format!("$.devices[{di}].channels[{ci}].enabled"),
                    "this channel runs anyway (use disable = true)",
                );
            }
        }
    }
    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        if mixer.enabled == Some(false) {
            g.ignored(
                "control_socket",
                format!("$.mixers[{mi}].enabled"),
                "this mixer runs anyway (use disable = true)",
            );
        }
        if mixer.reserve_inputs.is_some() {
            g.ignored("reserve", format!("$.mixers[{mi}].reserve_inputs"), "adding an input always needs a restart");
        }
        if mixer.remote_inputs.as_ref().is_some_and(|r| !r.is_empty()) {
            g.ignored(
                "mixer_remote",
                format!("$.mixers[{mi}].remote_inputs"),
                "nothing is received from other instances",
            );
        }
    }

    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            let path = format!("{prefix}.outputs[{oi}]");
            match output {
                Output::MixerRemote(o) if o.disable != Some(true) && g.missing("mixer_remote") => g.issues.error(
                    CODE,
                    path,
                    "Needs the jschmall RTLSDR-Airband fork. This instance's rtl_airband won't start with a mixer_remote output: remove it or set disable = true.",
                ),
                Output::File(o) => {
                    if o.rdio_scanner.is_some() {
                        g.ignored("rdio_scanner", format!("{path}.rdio_scanner"), "nothing is uploaded");
                    }
                    if o.post_write_script.is_some() {
                        g.ignored("post_write_script", format!("{path}.post_write_script"), "it never runs");
                    }
                    if o.min_rx_seconds.is_some() {
                        g.ignored("post_write_script", format!("{path}.min_rx_seconds"), "short recordings are kept");
                    }
                }
                Output::Icecast(o) if o.send_tx_tags.is_some() => {
                    g.ignored("send_tx_tags", format!("{path}.send_tx_tags"), "no Now Playing tags are sent");
                }
                Output::UdpStream(o) if o.bit_depth.is_some() => {
                    g.ignored("fork", format!("{path}.bit_depth"), "the stream uses the default sample format");
                }
                _ => {}
            }
        }
    });
}
