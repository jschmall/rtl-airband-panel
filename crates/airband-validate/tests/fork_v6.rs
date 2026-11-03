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

// --- split_tx_drop_shorter_than (upstream #580, fork v6.7.0) ---

#[test]
fn global_split_tx_drop_must_be_below_max_file_time() {
    let cases = [
        ("split_tx_drop_shorter_than = 0.0;", true),
        ("split_tx_drop_shorter_than = 3599.0;", true), // default max 3600
        ("split_tx_drop_shorter_than = 3600.0;", false),
        ("split_tx_drop_shorter_than = 4000.0;", false),
        ("split_tx_drop_shorter_than = -1.0;", false),
        ("split_max_file_time = 60.0; split_tx_drop_shorter_than = 59.5;", true),
        ("split_max_file_time = 60.0; split_tx_drop_shorter_than = 60.0;", false),
    ];
    for (globals, ok) in cases {
        let got = issues(globals, PULSE, "");
        let flagged: Vec<_> = got.iter().filter(|i| i.code == "split-tx-drop-invalid").collect();
        assert_eq!(flagged.is_empty(), ok, "{globals:?}: {got:?}");
        if let Some(i) = flagged.first() {
            assert_eq!((i.path.as_str(), i.severity), ("$", Severity::Error));
            assert!(i.message.contains("need 0 (disabled) <= split_tx_drop_shorter_than < split_max_file_time"));
        }
    }
}

#[test]
fn per_output_split_tx_drop_uses_effective_values() {
    // The output's own max is below the global drop.
    let got = issues(
        "split_tx_drop_shorter_than = 30.0;",
        &file("split_on_transmission = true; split_max_file_time = 20.0;"),
        "",
    );
    assert_eq!(codes(&got), [("split-tx-drop-invalid", OUT0, Severity::Error)]);
    // The output's own drop is above the global max.
    let got = issues(
        "split_max_file_time = 60.0;",
        &file("split_on_transmission = true; split_tx_drop_shorter_than = 90.0;"),
        "",
    );
    assert_eq!(codes(&got), [("split-tx-drop-invalid", OUT0, Severity::Error)]);
    // In range on a rawfile output.
    let raw = r#"{ type = "rawfile"; directory = "/tmp"; filename_template = "r"; split_on_transmission = true; split_tx_drop_shorter_than = 2.0; }"#;
    assert!(issues("", raw, "").is_empty());
}

#[test]
fn invalid_global_split_tx_drop_is_reported_once() {
    let outputs = format!("{}, {}", file("split_on_transmission = true;"), file("split_on_transmission = true;"));
    let got = issues("split_tx_drop_shorter_than = -2.0;", &outputs, "");
    assert_eq!(codes(&got), [("split-tx-drop-invalid", "$", Severity::Error)]);
}

#[test]
fn split_tx_drop_without_split_on_transmission_or_on_a_mixer() {
    let got = issues("", &file("split_tx_drop_shorter_than = 2.0;"), "");
    assert_eq!(codes(&got), [("split-settings-ignored-without-split-on-transmission", OUT0, Severity::Warning)]);
    assert!(got[0].message.contains("split_tx_drop_shorter_than"));

    let mixers = format!(r#"mixers: {{ m: {{ outputs: ({}); }}; }};"#, file("split_tx_drop_shorter_than = 2.0;"));
    let got = issues("", r#"{ type = "mixer"; name = "m"; }"#, &mixers);
    assert_eq!(codes(&got), [("mixer-output-split-settings-not-allowed", "$.mixers[0].outputs[0]", Severity::Error)]);
    assert_eq!(got[0].message, "split_tx_drop_shorter_than is not allowed for mixers");
}

// --- auto_ppm (fork v6.6.0) ---

fn device_issues(device: &str) -> Vec<ValidationIssue> {
    let source = format!(
        r#"{GLOBALS}
devices: ({{ {device} centerfreq = 100.0; channels: ({{ freq = 100.5; outputs: ({PULSE}); }}); }});"#
    );
    let result = validate_config(&parse_config_file(&source).unwrap());
    result.errors.into_iter().chain(result.warnings).collect()
}

const RTL: &str = r#"type = "rtlsdr"; serial = "1"; gain = 29;"#;

#[test]
fn auto_ppm_with_defaults_is_valid_on_rtlsdr() {
    for extra in [
        "auto_ppm = true;",
        "auto_ppm = false; correction = -12;",
        "auto_ppm = true; auto_ppm_interval = 5; auto_ppm_max_ppm = 1; auto_ppm_max_step = 100; correction = 1;",
        "auto_ppm = true; auto_ppm_interval = 86400; correction = 100;",
    ] {
        let got = device_issues(&format!("{RTL} {extra}"));
        assert!(got.is_empty(), "{extra}: {got:?}");
    }
}

#[test]
fn auto_ppm_is_rtlsdr_only_even_when_off() {
    for (ty, select) in [("soapysdr", r#"device_string = "driver=airspy";"#), ("mirisdr", "index = 0; gain = 10;")] {
        for value in ["true", "false"] {
            let got = device_issues(&format!(r#"type = "{ty}"; {select} auto_ppm = {value};"#));
            assert_eq!(
                codes(&got),
                [("auto-ppm-driver-unsupported", "$.devices[0].auto_ppm", Severity::Error)],
                "{ty} auto_ppm = {value}"
            );
            assert!(got[0].message.contains(&format!("not supported by the {ty} driver")));
        }
    }
}

#[test]
fn auto_ppm_params_follow_the_fork_ranges() {
    let cases = [
        ("auto_ppm_interval = 4;", "auto_ppm_interval", "auto_ppm_interval must be between 5 and 86400"),
        ("auto_ppm_interval = 86401;", "auto_ppm_interval", "auto_ppm_interval must be between 5 and 86400"),
        ("auto_ppm_max_ppm = 0;", "auto_ppm_max_ppm", "auto_ppm_max_ppm must be between 1 and 100"),
        ("auto_ppm_max_ppm = 101;", "auto_ppm_max_ppm", "auto_ppm_max_ppm must be between 1 and 100"),
        ("auto_ppm_max_step = 0;", "auto_ppm_max_step", "auto_ppm_max_step must be between 1 and 100"),
    ];
    for (extra, key, message) in cases {
        let got = device_issues(&format!("{RTL} auto_ppm = true; {extra}"));
        assert_eq!(
            codes(&got),
            [("auto-ppm-param-out-of-range", format!("$.devices[0].{key}").as_str(), Severity::Error)],
            "{extra}"
        );
        assert_eq!(got[0].message, message);
    }
    // A float literal is rejected by the fork's int-only read.
    let got = device_issues(&format!("{RTL} auto_ppm = true; auto_ppm_interval = 30.5;"));
    assert_eq!(codes(&got), [("not-whole-number", "$.devices[0].auto_ppm_interval", Severity::Error)]);
}

#[test]
fn auto_ppm_correction_must_start_within_max_ppm() {
    let got = device_issues(&format!("{RTL} auto_ppm = false; correction = 120;"));
    assert_eq!(codes(&got), [("auto-ppm-correction-outside-limit", "$.devices[0].correction", Severity::Error)]);
    assert_eq!(got[0].message, "correction 120 is outside auto_ppm_max_ppm (+/-100)");

    let got = device_issues(&format!("{RTL} auto_ppm = true; auto_ppm_max_ppm = 20; correction = -21;"));
    assert_eq!(codes(&got), [("auto-ppm-correction-outside-limit", "$.devices[0].correction", Severity::Error)]);
    // Without auto_ppm, a big correction is the user's business.
    assert!(device_issues(&format!("{RTL} correction = 120;")).is_empty());
}

#[test]
fn auto_ppm_params_without_auto_ppm_are_ignored() {
    let got = device_issues(&format!("{RTL} auto_ppm_interval = 60; auto_ppm_max_ppm = 500;"));
    assert_eq!(
        codes(&got),
        [
            ("auto-ppm-settings-ignored", "$.devices[0].auto_ppm_interval", Severity::Warning),
            ("auto-ppm-settings-ignored", "$.devices[0].auto_ppm_max_ppm", Severity::Warning),
        ]
    );
}

// --- buffer_size (fork v7.2.0) ---

#[test]
fn rtlsdr_buffer_size_follows_the_fork_rule() {
    for ok in [
        "buffer_size = 512;",
        "buffer_size = 128000;",
        "buffer_size = 320000; buffers = 10;",
        "buffer_size = 16777216;",
    ] {
        let got = device_issues(&format!("{RTL} {ok}"));
        assert!(got.is_empty(), "{ok}: {got:?}");
    }
    for bad in ["buffer_size = 0;", "buffer_size = -512;", "buffer_size = 1000;", "buffer_size = 16777728;"] {
        let got = device_issues(&format!("{RTL} {bad}"));
        assert_eq!(codes(&got), [("device-buffer-size-invalid", "$.devices[0]", Severity::Error)], "{bad}");
        assert!(got[0].message.ends_with("must be a positive multiple of 512, at most 16777216"), "{}", got[0].message);
    }
    // The fork reads it as an int.
    let got = device_issues(&format!("{RTL} buffer_size = 1024.5;"));
    assert_eq!(
        codes(&got),
        [
            ("device-buffer-size-invalid", "$.devices[0]", Severity::Error),
            ("not-whole-number", "$.devices[0].buffer_size", Severity::Error)
        ]
    );
    // Only rtlsdr reads it.
    let got = device_issues(r#"type = "soapysdr"; device_string = "driver=airspy"; buffer_size = 1000;"#);
    assert!(got.is_empty(), "{got:?}");
}
