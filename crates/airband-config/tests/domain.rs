//! Domain-layer behavior beyond TS parity: unknown-setting preservation,
//! RTLSDR-Airband v5.5/v6.3 fields, and the JSON contract with the frontend.

use std::path::PathBuf;

use airband_config::domain::*;
use airband_config::{RtlAirbandConfig, parse_config_file, serialize_config_file};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)).unwrap()
}

fn round_trip(source: &str) -> (RtlAirbandConfig, String, RtlAirbandConfig) {
    let d1 = parse_config_file(source).unwrap();
    let text = serialize_config_file(&d1);
    let d2 = parse_config_file(&text).unwrap();
    (d1, text, d2)
}

const UNKNOWN_EVERYWHERE: &str = r#"
multiple_demod_threads = true;
multiple_output_threads = true;
stats_filepath = "/tmp/stats.txt";
localtime = true;
future_global = 0x10;
future_group: { a = 1; b = [1.5, 2.5]; };
devices: ({
  type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
  future_device = "dev";
  channels: ({
    freq = 100.5;
    squelch = -30;
    outputs: (
      { type = "file"; directory = "/tmp"; filename_template = "x"; future_output: true;
        rdio_scanner = { server = "r"; port = 1; api_key = "k"; talkgroup_id = 2; future_rdio = 7L; }; }
    );
  }, {
    freqs = (118.0, 119.0);
    future_scan = ("a", "b");
    outputs: ( { type = "mixer"; name = "m"; future_mixer_output = 1; } );
  });
});
mixers: {
  m: {
    future_mixer = false;
    remote_inputs: ( { listen_path = "/run/m.sock"; stream_id = 0; future_remote = "r"; } );
    outputs: ( { type = "udp_stream"; dest_address = "a"; dest_port = 1; future_udp = 2; } );
  };
};
"#;

#[test]
fn keeps_unknown_settings_at_every_level() {
    let (d1, text, d2) = round_trip(UNKNOWN_EVERYWHERE);
    assert_eq!(d1, d2, "domain must survive a full text round trip");

    let names = |s: &[airband_config::ast::Setting]| s.iter().map(|s| s.name.clone()).collect::<Vec<_>>();
    assert_eq!(names(&d1.unknown_settings), ["future_global", "future_group"]);
    assert_eq!(names(&d1.devices[0].unknown_settings), ["future_device"]);
    let Channel::Multichannel(c0) = &d1.devices[0].channels[0] else { panic!() };
    assert_eq!(names(&c0.unknown_settings), ["squelch"]);
    let Output::File(f) = &c0.outputs[0] else { panic!() };
    assert_eq!(names(&f.unknown_settings), ["future_output"]);
    assert_eq!(names(&f.rdio_scanner.as_ref().unwrap().unknown_settings), ["future_rdio"]);
    let Channel::Scan(c1) = &d1.devices[0].channels[1] else { panic!() };
    assert_eq!(names(&c1.unknown_settings), ["future_scan"]);
    let mixer = &d1.mixers.as_ref().unwrap()[0];
    assert_eq!(names(&mixer.unknown_settings), ["future_mixer"]);
    assert_eq!(names(&mixer.remote_inputs.as_ref().unwrap()[0].unknown_settings), ["future_remote"]);

    // Raw literal text survives, including int64/hex/array forms.
    for needle in [
        "future_global = 0x10;",
        "future_rdio = 7L;",
        "future_output: true;",
        "squelch = -30;",
        "b = [\n",
        "future_scan = (\n",
    ] {
        assert!(text.contains(needle), "missing {needle:?} in:\n{text}");
    }
}

#[test]
fn unknown_settings_go_after_known_scalars_and_before_nested_lists() {
    let (_, text, _) = round_trip(UNKNOWN_EVERYWHERE);
    let pos = |s: &str| text.find(s).unwrap_or_else(|| panic!("{s} not found"));
    assert!(pos("localtime = true;") < pos("future_global"));
    assert!(pos("future_group") < pos("devices:"));
    assert!(pos("centerfreq = ") < pos("future_device"));
    assert!(pos("future_device") < pos("channels:"));
    assert!(pos("squelch = -30;") < pos("outputs:"));
}

#[test]
fn unknown_settings_survive_json() {
    let d1 = parse_config_file(UNKNOWN_EVERYWHERE).unwrap();
    let json = serde_json::to_string(&d1).unwrap();
    let d2: RtlAirbandConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(d1, d2);
    assert_eq!(serialize_config_file(&d1), serialize_config_file(&d2));
}

#[test]
fn v6_3_fields_round_trip() {
    let source = r#"
multiple_demod_threads = true; multiple_output_threads = true;
stats_filepath = "/tmp/stats.txt"; localtime = true;
stats_update_interval = 5.0;
split_min_file_time = 2.0; split_max_file_time = 600.0; split_max_idle_time = 1.5;
split_include_transmission_start = true;
devices: ({ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
  channels: ({ freq = 100.5; outputs: (
    { type = "file"; directory = "/tmp"; filename_template = "x"; split_on_transmission = true;
      split_min_file_time = 3.0; split_max_file_time = 60.0; split_max_idle_time = 0.25;
      split_include_transmission_start = false; },
    { type = "rawfile"; directory = "/tmp"; filename_template = "y"; split_on_transmission = true;
      split_min_file_time = 1.0; split_include_transmission_start = true; }
  ); }); });
"#;
    let (d1, text, d2) = round_trip(source);
    assert_eq!(d1, d2);
    assert!(d1.unknown_settings.is_empty());
    assert_eq!(d1.stats_update_interval, Some(5.0));
    assert_eq!(d1.split_min_file_time, Some(2.0));
    assert_eq!(d1.split_max_file_time, Some(600.0));
    assert_eq!(d1.split_max_idle_time, Some(1.5));
    assert_eq!(d1.split_include_transmission_start, Some(true));
    let Channel::Multichannel(c) = &d1.devices[0].channels[0] else { panic!() };
    let Output::File(f) = &c.outputs[0] else { panic!() };
    assert!(f.unknown_settings.is_empty());
    assert_eq!(
        (f.split_min_file_time, f.split_max_file_time, f.split_max_idle_time, f.split_include_transmission_start),
        (Some(3.0), Some(60.0), Some(0.25), Some(false))
    );
    let Output::RawFile(r) = &c.outputs[1] else { panic!() };
    assert_eq!((r.split_min_file_time, r.split_include_transmission_start), (Some(1.0), Some(true)));
    // Written as floats, which is what RTLSDR-Airband's setting_as_double expects.
    assert!(text.contains("stats_update_interval = 5.0;"));
    assert!(text.contains("split_max_idle_time = 0.25;"));
}

#[test]
fn fixtures_have_no_unknown_settings() {
    // Guards the parity goldens: the TS parser drops unknown settings, so a
    // fixture with any would make the two implementations differ.
    for name in ["151719.conf", "fork-features.conf"] {
        let d = parse_config_file(&fixture(name)).unwrap();
        let json = serde_json::to_string(&d).unwrap();
        assert!(!json.contains("unknown_settings"), "{name} has unknown settings");
    }
}

#[test]
fn json_contract_with_frontend() {
    let d = parse_config_file(&fixture("fork-features.conf")).unwrap();
    let v = serde_json::to_value(&d).unwrap();
    // Device type and output type use the .conf key names.
    assert!(v["devices"][0]["type"].is_string());
    assert!(v["devices"][0]["channels"][0]["outputs"][0]["type"].is_string());
    // Absent optionals are omitted, not null.
    assert!(!serde_json::to_string(&v).unwrap().contains("null"));
    // Round trip through JSON.
    assert_eq!(serde_json::from_value::<RtlAirbandConfig>(v).unwrap(), d);
}

#[test]
fn json_rejects_unknown_fields_and_bad_shapes() {
    let d = parse_config_file(&fixture("151719.conf")).unwrap();
    let mut v = serde_json::to_value(&d).unwrap();
    v["devices"][0]["bogus"] = serde_json::json!(1);
    assert!(serde_json::from_value::<RtlAirbandConfig>(v).is_err(), "unknown device field must be rejected");

    let mut v = serde_json::to_value(&d).unwrap();
    v["devices"][0]["channels"][0]["outputs"][0]["type"] = serde_json::json!("carrier_pigeon");
    assert!(serde_json::from_value::<RtlAirbandConfig>(v).is_err(), "unknown output type must be rejected");

    let mut v = serde_json::to_value(&d).unwrap();
    v["devices"][0]["channels"][0]["outputs"][0]["bogus"] = serde_json::json!(true);
    assert!(serde_json::from_value::<RtlAirbandConfig>(v).is_err(), "unknown output field must be rejected");
}

#[test]
fn json_distinguishes_scan_and_multichannel_channels() {
    let v = serde_json::json!({ "freqs": [118000000, 119000000], "outputs": [{ "type": "pulse" }] });
    assert!(matches!(serde_json::from_value::<Channel>(v).unwrap(), Channel::Scan(_)));
    let v = serde_json::json!({ "freq": 118000000, "outputs": [{ "type": "pulse" }] });
    assert!(matches!(serde_json::from_value::<Channel>(v).unwrap(), Channel::Multichannel(_)));
}

#[test]
fn disabled_rdio_scanner_block_is_omitted_but_kept_in_json() {
    let mut d = parse_config_file(&fixture("fork-features.conf")).unwrap();
    let mut found = false;
    for dev in &mut d.devices {
        for ch in &mut dev.channels {
            let outputs = match ch {
                Channel::Multichannel(c) => &mut c.outputs,
                Channel::Scan(c) => &mut c.outputs,
            };
            for o in outputs {
                if let Output::File(FileOutput { rdio_scanner: Some(r), .. }) = o {
                    r.disable = Some(true);
                    found = true;
                }
            }
        }
    }
    assert!(found, "fixture should contain an rdio_scanner block");
    let text = serialize_config_file(&d);
    assert!(!text.contains("rdio_scanner:"), "disabled block must not be written");
    assert!(text.contains("rdio_scanner_queue_depth"), "global key is unrelated and stays");
    assert!(serde_json::to_string(&d).unwrap().contains("rdio_scanner"));
}

#[test]
fn float_mhz_and_int_hz_canonicalize_the_same() {
    let base = |cf: &str| {
        format!(
            r#"multiple_demod_threads = true; multiple_output_threads = true; stats_filepath = "/x"; localtime = true;
devices: ({{ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = {cf}; bandwidth = 350000;
  channels: ({{ freq = 151.78; outputs: ({{ type = "pulse"; }}); }}); }});"#
        )
    };
    let a = parse_config_file(&base("151.78")).unwrap();
    let b = parse_config_file(&base("151780000")).unwrap();
    assert_eq!(a.devices[0].centerfreq, Some(151_780_000.0));
    assert_eq!(a, b);
    // Device bandwidth is literal Hz, never scaled.
    assert_eq!(a.devices[0].bandwidth, Some(350_000.0));
}
