//! Settings rtl_airband reads as integers must be whole numbers. The
//! serializer writes a fractional value as a libconfig float, and
//! rtl_airband then either refuses to start (libconfig++'s `(int)` on a
//! float setting throws SettingTypeException) or, for the Hz settings it
//! reads through parse_anynum2int(), takes the float as MHz. Settings the
//! fork also accepts as floats (gain, soapysdr correction, ampfactor,
//! balance, ctcss, notch, notch_q, squelch_snr_threshold, min_rx_seconds,
//! the split_* times, stats_update_interval) aren't checked.

use airband_config::domain::{Channel, NumberOrList, Output, RtlAirbandConfig};

use crate::types::Issues;
use crate::view::{for_each_output_list, js};

const CODE: &str = "not-whole-number";

fn check(issues: &mut Issues, path: &str, name: &str, value: Option<f64>) {
    if let Some(v) = value
        && !airband_config::jsnum::is_integer(v)
    {
        issues.error(CODE, format!("{path}.{name}"), format!("{name} {} must be a whole number", js(v)));
    }
}

/// A Hz setting: a float is read as MHz, so say so.
fn check_hz(issues: &mut Issues, path: &str, name: &str, value: Option<f64>) {
    if let Some(v) = value
        && !airband_config::jsnum::is_integer(v)
    {
        issues.error(
            CODE,
            format!("{path}.{name}"),
            format!("{name} {} must be a whole number of Hz (rtl_airband reads a decimal value as MHz)", js(v)),
        );
    }
}

fn check_list(issues: &mut Issues, path: &str, name: &str, values: &[f64], hz: bool) {
    for (i, v) in values.iter().enumerate() {
        let item = format!("{name}[{i}]");
        if hz {
            check_hz(issues, path, &item, Some(*v));
        } else {
            check(issues, path, &item, Some(*v));
        }
    }
}

fn check_number_or_list(issues: &mut Issues, path: &str, name: &str, value: &Option<NumberOrList>, hz: bool) {
    match value {
        None => {}
        Some(NumberOrList::One(n)) if hz => check_hz(issues, path, name, Some(*n)),
        Some(NumberOrList::One(n)) => check(issues, path, name, Some(*n)),
        Some(NumberOrList::Many(ns)) => check_list(issues, path, name, ns, hz),
    }
}

pub fn whole_numbers(config: &RtlAirbandConfig, issues: &mut Issues) {
    let root = "$";
    check(issues, root, "fft_size", config.fft_size);
    check(issues, root, "shout_metadata_delay", config.shout_metadata_delay);
    check(issues, root, "tau", config.tau);
    check(issues, root, "stats_http_port", config.stats_http_port);
    check(issues, root, "rdio_scanner_queue_depth", config.rdio_scanner_queue_depth);

    for (di, device) in config.devices.iter().enumerate() {
        let path = format!("$.devices[{di}]");
        check(issues, &path, "index", device.index);
        check_hz(issues, &path, "centerfreq", device.centerfreq);
        check_hz(issues, &path, "sample_rate", device.sample_rate);
        // soapysdr takes a fractional ppm correction; rtlsdr and mirisdr don't.
        if device.device_type != "soapysdr" {
            check(issues, &path, "correction", device.correction);
        }
        check(issues, &path, "bandwidth", device.bandwidth);
        check(issues, &path, "reserve_channels", device.reserve_channels);
        check(issues, &path, "tau", device.tau);
        check(issues, &path, "buffers", device.buffers);
        check(issues, &path, "num_buffers", device.num_buffers);
        check(issues, &path, "channel", device.channel);

        for (ci, channel) in device.channels.iter().enumerate() {
            let path = format!("{path}.channels[{ci}]");
            match channel {
                Channel::Multichannel(c) => {
                    check_hz(issues, &path, "freq", Some(c.freq));
                    check_hz(issues, &path, "bandwidth", c.bandwidth);
                    check(issues, &path, "afc", c.afc);
                    check(issues, &path, "highpass", c.highpass);
                    check(issues, &path, "lowpass", c.lowpass);
                    check(issues, &path, "tau", c.tau);
                    check(issues, &path, "squelch_threshold", c.squelch_threshold);
                }
                Channel::Scan(c) => {
                    check_list(issues, &path, "freqs", &c.freqs, true);
                    check_number_or_list(issues, &path, "bandwidth", &c.bandwidth, true);
                    check(issues, &path, "afc", c.afc);
                    check(issues, &path, "highpass", c.highpass);
                    check(issues, &path, "lowpass", c.lowpass);
                    check(issues, &path, "tau", c.tau);
                    check_number_or_list(issues, &path, "squelch_threshold", &c.squelch_threshold, false);
                }
            }
        }
    }

    for (mi, mixer) in config.mixers.iter().flatten().enumerate() {
        let path = format!("$.mixers[{mi}]");
        check(issues, &path, "highpass", mixer.highpass);
        check(issues, &path, "lowpass", mixer.lowpass);
        check(issues, &path, "reserve_inputs", mixer.reserve_inputs);
        for (ri, input) in mixer.remote_inputs.iter().flatten().enumerate() {
            check(issues, &format!("{path}.remote_inputs[{ri}]"), "stream_id", Some(input.stream_id));
        }
    }

    for_each_output_list(config, |prefix, outputs, _| {
        for (oi, output) in outputs.iter().enumerate() {
            let path = format!("{prefix}.outputs[{oi}]");
            match output {
                Output::File(o) => {
                    if let Some(rs) = &o.rdio_scanner {
                        let path = format!("{path}.rdio_scanner");
                        check(issues, &path, "port", Some(rs.port));
                        check(issues, &path, "system_id", rs.system_id);
                        check(issues, &path, "talkgroup_id", Some(rs.talkgroup_id));
                        check(issues, &path, "source_id", rs.source_id);
                        check(issues, &path, "timeout_ms", rs.timeout_ms);
                        check(issues, &path, "max_retries", rs.max_retries);
                    }
                }
                Output::Icecast(o) => check(issues, &path, "port", Some(o.port)),
                Output::UdpStream(o) => {
                    check(issues, &path, "bit_depth", o.bit_depth);
                    check(issues, &path, "sample_rate", o.sample_rate);
                }
                Output::MixerRemote(o) => check(issues, &path, "stream_id", Some(o.stream_id)),
                Output::Pulse(_) | Output::RawFile(_) | Output::Mixer(_) => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use airband_config::parse_config_file;

    const GLOBALS: &str = r#"multiple_demod_threads = true; multiple_output_threads = true; stats_filepath = "/tmp/s"; localtime = true;"#;

    fn parse(conf: &str) -> RtlAirbandConfig {
        parse_config_file(&format!("{GLOBALS} {conf}")).expect("fixture parses")
    }

    fn codes_and_paths(conf: &str) -> Vec<(String, String)> {
        issues_for(&parse(conf))
    }

    fn issues_for(config: &RtlAirbandConfig) -> Vec<(String, String)> {
        let mut issues = Issues::default();
        whole_numbers(config, &mut issues);
        issues.0.into_iter().map(|i| (i.code, i.path)).collect()
    }

    #[test]
    fn whole_values_pass() {
        let conf = r#"devices: ({ type = "rtlsdr"; index = 0; gain = 37.2; correction = 2; centerfreq = 151780000; sample_rate = 2400000;
            channels: ({ freq = 151780000; ampfactor = 1.5; ctcss = 88.5; squelch_snr_threshold = 9.5; outputs: (); }); });"#;
        assert_eq!(codes_and_paths(conf), vec![]);
    }

    #[test]
    fn float_literals_in_mhz_are_whole_hz() {
        // A float literal is MHz and the model canonicalizes it to integer Hz.
        let conf = r#"devices: ({ type = "rtlsdr"; index = 0; centerfreq = 151.78; sample_rate = 2.4;
            channels: ({ freq = 151.78; outputs: (); }); });"#;
        assert_eq!(codes_and_paths(conf), vec![]);
    }

    #[test]
    fn fractional_integer_settings_are_flagged() {
        let conf = r#"fft_size = 512.5;
            devices: ({ type = "rtlsdr"; index = 0; correction = 1.5; buffers = 2.5;
              channels: ({ freq = 151780000; highpass = 100.5; squelch_threshold = -30.5; outputs: (); }); });
            mixers: { m1: { reserve_inputs = 1.5; outputs: ({ type = "icecast"; server = "s"; port = 8000.5; mountpoint = "m"; username = "u"; password = "p"; }); }; };"#;
        assert_eq!(
            codes_and_paths(conf),
            [
                "$.fft_size",
                "$.devices[0].correction",
                "$.devices[0].buffers",
                "$.devices[0].channels[0].highpass",
                "$.devices[0].channels[0].squelch_threshold",
                "$.mixers[0].reserve_inputs",
                "$.mixers[0].outputs[0].port",
            ]
            .map(|p| (CODE.to_string(), p.to_string()))
        );
    }

    #[test]
    fn soapysdr_correction_may_be_fractional() {
        let conf =
            r#"devices: ({ type = "soapysdr"; device_string = "driver=rtlsdr"; correction = 1.5; channels: (); });"#;
        assert_eq!(codes_and_paths(conf), vec![]);
    }

    #[test]
    fn fractional_hz_from_the_editor_is_flagged() {
        // A .conf can't hold fractional Hz (a float literal is MHz), but the editor's JSON can.
        let mut config = parse(
            r#"devices: ({ type = "rtlsdr"; index = 0; centerfreq = 151780000; channels: ({ freq = 151780000; outputs: (); }); });"#,
        );
        config.devices[0].centerfreq = Some(151780000.5);
        let Channel::Multichannel(c) = &mut config.devices[0].channels[0] else { unreachable!() };
        c.freq = 151780000.25;
        assert_eq!(
            issues_for(&config),
            ["$.devices[0].centerfreq", "$.devices[0].channels[0].freq"].map(|p| (CODE.to_string(), p.to_string()))
        );
    }
}
