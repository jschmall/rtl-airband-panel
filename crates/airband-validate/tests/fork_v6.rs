//! Checks with no TS counterpart: RTLSDR-Airband v5.5/v6.3 settings and
//! settings the panel keeps without modeling.

use airband_config::parse_config_file;
use airband_validate::{Severity, ValidationIssue, validate_config};

const GLOBALS: &str = r#"multiple_demod_threads = true; multiple_output_threads = true;
stats_filepath = "/tmp/stats.txt"; localtime = true;"#;

fn issues(globals: &str, outputs: &str, mixers: &str) -> Vec<ValidationIssue> {
    let source = format!(
        r#"{GLOBALS} {globals}
devices: ({{ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
  channels: ({{ freq = 100.5; outputs: ({outputs}); }}); }});
{mixers}"#
    );
    let result = validate_config(&parse_config_file(&source).unwrap());
    result.errors.into_iter().chain(result.warnings).collect()
}

fn codes(list: &[ValidationIssue]) -> Vec<(&str, &str, Severity)> {
    list.iter().map(|i| (i.code.as_str(), i.path.as_str(), i.severity)).collect()
}

const PULSE: &str = r#"{ type = "pulse"; }"#;
const OUT0: &str = "$.devices[0].channels[0].outputs[0]";

fn file(extra: &str) -> String {
    format!(r#"{{ type = "file"; directory = "/tmp"; filename_template = "f"; {extra} }}"#)
}

#[test]
fn stats_update_interval_must_be_positive() {
    for (value, ok) in [("15.0", true), ("0.001", true), ("0.0", false), ("-1.0", false)] {
        let got = issues(&format!("stats_update_interval = {value};"), PULSE, "");
        let flagged = got.iter().any(|i| i.code == "stats-update-interval-non-positive");
        assert_eq!(flagged, !ok, "stats_update_interval = {value}: {got:?}");
    }
}

#[test]
fn global_split_times_follow_the_fork_constraint() {
    let cases = [
        ("", true),
        ("split_min_file_time = 1.0;", true),
        ("split_min_file_time = 0.5;", false),
        ("split_max_file_time = 1.0;", false), // must be > default min 1.0
        ("split_min_file_time = 10.0; split_max_file_time = 10.0;", false),
        ("split_max_idle_time = 0.0;", false),
        ("split_min_file_time = 5.0; split_max_file_time = 30.0; split_max_idle_time = 2.0;", true),
    ];
    for (globals, ok) in cases {
        let got = issues(globals, PULSE, "");
        let flagged: Vec<_> = got.iter().filter(|i| i.code == "split-file-times-invalid").collect();
        assert_eq!(flagged.is_empty(), ok, "{globals:?}: {got:?}");
        if let Some(i) = flagged.first() {
            assert_eq!(i.path, "$");
            assert!(i.message.contains("need split_min_file_time >= 1.0"));
        }
    }
}

#[test]
fn per_output_split_times_use_global_fallbacks() {
    // Output overrides max only; effective min comes from the global 20.0.
    let got = issues(
        "split_min_file_time = 20.0; split_max_file_time = 60.0;",
        &file("split_on_transmission = true; split_max_file_time = 10.0;"),
        "",
    );
    assert_eq!(codes(&got), [("split-file-times-invalid", OUT0, Severity::Error)]);

    let got =
        issues("split_min_file_time = 2.0;", &file("split_on_transmission = true; split_max_file_time = 10.0;"), "");
    assert!(got.is_empty(), "{got:?}");
}

#[test]
fn invalid_global_is_reported_once_not_per_output() {
    let outputs = format!("{}, {}", file("split_on_transmission = true;"), file("split_on_transmission = true;"));
    let got = issues("split_max_idle_time = -1.0;", &outputs, "");
    assert_eq!(codes(&got), [("split-file-times-invalid", "$", Severity::Error)]);
}

#[test]
fn split_settings_without_split_on_transmission_warn() {
    let got = issues("", &file("split_min_file_time = 2.0; split_include_transmission_start = true;"), "");
    assert_eq!(
        codes(&got),
        [
            ("split-settings-ignored-without-split-on-transmission", OUT0, Severity::Warning),
            ("split-settings-ignored-without-split-on-transmission", OUT0, Severity::Warning),
        ]
    );
    let raw = r#"{ type = "rawfile"; directory = "/tmp"; filename_template = "r"; split_include_transmission_start = false; }"#;
    let got = issues("", raw, "");
    assert_eq!(codes(&got), [("split-settings-ignored-without-split-on-transmission", OUT0, Severity::Warning)]);
}

#[test]
fn split_settings_on_mixer_outputs_are_fatal() {
    let mixers = format!(
        r#"mixers: {{ m: {{ outputs: ({}); }}; }};"#,
        file("split_max_idle_time = 1.0; split_include_transmission_start = true;")
    );
    let got = issues("", r#"{ type = "mixer"; name = "m"; }"#, &mixers);
    let m = "$.mixers[0].outputs[0]";
    assert_eq!(
        codes(&got),
        [
            ("mixer-output-split-settings-not-allowed", m, Severity::Error),
            ("mixer-output-split-settings-not-allowed", m, Severity::Error),
        ]
    );
}

#[test]
fn unknown_settings_are_reported_as_preserved() {
    let source = format!(
        r#"{GLOBALS} future_global = 1;
devices: ({{ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0; future_device = 2;
  channels: ({{ freq = 100.5; squelch = -30;
    outputs: ({{ type = "file"; directory = "/t"; filename_template = "f"; split_on_transmission = true;
      future_output = true; rdio_scanner = {{ server = "r"; port = 1; api_key = "k"; talkgroup_id = 1; future_rdio = 3; }}; }}); }}); }});
mixers: {{ m: {{ future_mixer = 4; remote_inputs: ({{ listen_path = "/run/m"; stream_id = 0; future_remote = 5; }});
  outputs: ({{ type = "pulse"; stream_name = "s"; future_pulse = 6; }}); }}; }};"#
    );
    let result = validate_config(&parse_config_file(&source).unwrap());
    assert!(result.errors.iter().all(|e| e.code != "unknown-setting-preserved"));
    let warnings: Vec<_> = result.warnings.iter().map(|i| (i.code.as_str(), i.path.as_str())).collect();
    let expected = [
        ("unknown-setting-preserved", "$.future_global"),
        ("unknown-setting-preserved", "$.devices[0].future_device"),
        ("squelch-deprecated", "$.devices[0].channels[0].squelch"),
        ("unknown-setting-preserved", "$.devices[0].channels[0].outputs[0].rdio_scanner.future_rdio"),
        ("unknown-setting-preserved", "$.devices[0].channels[0].outputs[0].future_output"),
        ("unknown-setting-preserved", "$.mixers[0].future_mixer"),
        ("unknown-setting-preserved", "$.mixers[0].remote_inputs[0].future_remote"),
        ("unknown-setting-preserved", "$.mixers[0].outputs[0].future_pulse"),
    ];
    for e in expected {
        assert!(warnings.contains(&e), "missing {e:?} in {warnings:?}");
    }
}
