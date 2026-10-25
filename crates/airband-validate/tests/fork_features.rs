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
