//! Fork-only settings against a build without them (validate_config_for).

use airband_validate::{Severity, validate_config, validate_config_for};

fn fixture() -> airband_config::RtlAirbandConfig {
    let source =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fork-features.conf")).unwrap();
    airband_config::parse_config_file(&source).unwrap()
}

fn fork_issues(result: &airband_validate::ValidationResult) -> Vec<(Severity, String)> {
    result
        .errors
        .iter()
        .chain(&result.warnings)
        .filter(|i| i.code == "needs-fork-feature")
        .map(|i| (i.severity, i.path.clone()))
        .collect()
}

const FORK: &[&str] = &[
    "fork",
    "control_socket",
    "device_status",
    "reserve",
    "mixer_remote",
    "send_tx_tags",
    "stats_http",
    "json_log",
    "post_write_script",
    "rdio_scanner",
];

#[test]
fn a_stock_build_flags_every_fork_only_setting() {
    let config = fixture();
    let issues = fork_issues(&validate_config_for(&config, Some(&[])));
    let errors: Vec<&String> = issues.iter().filter(|(s, _)| *s == Severity::Error).map(|(_, p)| p).collect();
    assert_eq!(
        errors,
        ["$.devices[0].channels[0].outputs[2]"],
        "only the mixer_remote output stops stock from starting"
    );
    let warned: Vec<&str> = issues.iter().filter(|(s, _)| *s == Severity::Warning).map(|(_, p)| p.as_str()).collect();
    for path in [
        "$.control_socket_path",
        "$.stats_http_address",
        "$.stats_http_port",
        "$.rdio_scanner_queue_depth",
        "$.devices[0].reserve_channels",
        "$.devices[0].channels[0].outputs[0].rdio_scanner",
        "$.devices[0].channels[0].outputs[1].bit_depth",
        "$.mixers[0].enabled",
        "$.mixers[0].reserve_inputs",
        "$.mixers[0].remote_inputs",
    ] {
        assert!(warned.contains(&path), "{path} not in {warned:?}");
    }
}

#[test]
fn the_fork_or_an_unidentified_build_flags_nothing() {
    let config = fixture();
    let fork: Vec<String> = FORK.iter().map(|s| s.to_string()).collect();
    assert_eq!(fork_issues(&validate_config_for(&config, Some(&fork))), vec![]);
    assert_eq!(validate_config_for(&config, None), validate_config(&config));
}

#[test]
fn a_fork_build_without_rdio_scanner_compiled_in_warns_about_uploads() {
    let config = fixture();
    let fork: Vec<String> = FORK.iter().filter(|f| **f != "rdio_scanner").map(|s| s.to_string()).collect();
    let paths: Vec<String> =
        fork_issues(&validate_config_for(&config, Some(&fork))).into_iter().map(|(_, p)| p).collect();
    assert_eq!(paths, ["$.rdio_scanner_queue_depth", "$.devices[0].channels[0].outputs[0].rdio_scanner"]);
}

// --- Drivers and auto_ppm (fork v7.1.0) ---

fn devices_config(devices: &str) -> airband_config::RtlAirbandConfig {
    let source = format!(
        r#"multiple_demod_threads = true; multiple_output_threads = true;
stats_filepath = "/tmp/stats.txt"; localtime = true;
devices: ({devices});"#
    );
    airband_config::parse_config_file(&source).unwrap()
}

const CHANNELS: &str = r#"centerfreq = 100.0; channels: ({ freq = 100.5; outputs: ({ type = "pulse"; }); });"#;

fn driver_errors(config: &airband_config::RtlAirbandConfig, features: Option<&[&str]>) -> Vec<String> {
    let owned: Option<Vec<String>> = features.map(|f| f.iter().map(|s| s.to_string()).collect());
    let result = validate_config_for(config, owned.as_deref());
    result.errors.iter().filter(|i| i.code == "device-driver-not-built").map(|i| i.path.clone()).collect()
}

/// What bundled fork v7.1.0 prints after `Features:`.
const BUNDLED_V7_1: &[&str] = &[
    "fork",
    "control_socket",
    "device_status",
    "reserve",
    "mixer_remote",
    "send_tx_tags",
    "stats_http",
    "json_log",
    "post_write_script",
    "auto_ppm",
    "rdio_scanner",
    "nfm",
];

#[test]
fn a_fork_build_without_a_driver_rejects_its_devices() {
    let config = devices_config(&format!(
        r#"{{ type = "rtlsdr"; serial = "1"; gain = 29; {CHANNELS} }},
           {{ type = "mirisdr"; index = 0; gain = 10; {CHANNELS} }},
           {{ type = "soapysdr"; device_string = "driver=airspy"; {CHANNELS} }},
           {{ type = "mirisdr"; index = 1; gain = 10; disable = true; {CHANNELS} }}"#
    ));
    assert_eq!(driver_errors(&config, Some(BUNDLED_V7_1)), ["$.devices[1]", "$.devices[2]"]);
    let result = validate_config_for(&config, Some(&BUNDLED_V7_1.iter().map(|s| s.to_string()).collect::<Vec<_>>()));
    let miri = result.errors.iter().find(|i| i.path == "$.devices[1]" && i.code == "device-driver-not-built").unwrap();
    assert!(miri.message.contains("without the mirisdr driver"), "{}", miri.message);

    // A fork v6.5.0 build that compiled both drivers in.
    let mut v6_5: Vec<&str> = BUNDLED_V7_1.iter().copied().filter(|f| *f != "auto_ppm").collect();
    v6_5.extend(["soapysdr", "mirisdr"]);
    assert!(driver_errors(&config, Some(&v6_5)).is_empty());
    // Stock and unidentified builds don't list drivers: nothing to check.
    assert!(driver_errors(&config, Some(&[])).is_empty());
    assert!(driver_errors(&config, None).is_empty());
}

#[test]
fn auto_ppm_needs_fork_v6_6() {
    let config =
        devices_config(&format!(r#"{{ type = "rtlsdr"; serial = "1"; gain = 29; auto_ppm = true; {CHANNELS} }}"#));
    let pre_auto_ppm: Vec<String> = FORK.iter().map(|s| s.to_string()).collect();
    let issues = fork_issues(&validate_config_for(&config, Some(&pre_auto_ppm)));
    assert_eq!(issues, [(Severity::Warning, "$.devices[0].auto_ppm".to_string())]);
    let result = validate_config_for(&config, Some(&pre_auto_ppm));
    assert!(
        result.warnings.iter().any(|i| i.message.starts_with("Needs jschmall RTLSDR-Airband fork v6.6.0 or newer."))
    );

    let with: Vec<String> = BUNDLED_V7_1.iter().map(|s| s.to_string()).collect();
    assert!(fork_issues(&validate_config_for(&config, Some(&with))).is_empty());
}

#[test]
fn buffer_size_needs_fork_v7_2() {
    let config =
        devices_config(&format!(r#"{{ type = "rtlsdr"; serial = "1"; gain = 29; buffer_size = 320000; {CHANNELS} }}"#));
    let v7_1: Vec<String> = BUNDLED_V7_1.iter().map(|s| s.to_string()).collect();
    let result = validate_config_for(&config, Some(&v7_1));
    assert_eq!(fork_issues(&result), [(Severity::Warning, "$.devices[0].buffer_size".to_string())]);
    assert!(
        result.warnings.iter().any(|i| i.message.starts_with("Needs jschmall RTLSDR-Airband fork v7.2.0 or newer.")
            && i.message.contains("USB transfers stay at 320000 bytes"))
    );

    let mut v7_2 = v7_1.clone();
    v7_2.push("usb_chunk_sizing".into());
    assert!(fork_issues(&validate_config_for(&config, Some(&v7_2))).is_empty());
}
