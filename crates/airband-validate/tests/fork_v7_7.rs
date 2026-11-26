//! Fork v7.7.0: `tx_tag_idle_text`, the send_tx_tags title between transmissions.

use airband_validate::{Severity, validate_config, validate_config_for};

fn config(icecast: &str) -> airband_config::RtlAirbandConfig {
    let source = format!(
        r#"multiple_demod_threads = true; multiple_output_threads = true; stats_filepath = "/tmp/stats.txt";
localtime = true;
devices: ({{ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
  channels: ({{ freq = 100.5; label = "Fire Dispatch";
    outputs: ({{ type = "icecast"; server = "ice.example.com"; port = 8000; mountpoint = "m";
      username = "source"; password = "pw"; {icecast} }}); }}); }});"#
    );
    airband_config::parse_config_file(&source).unwrap()
}

const PATH: &str = "$.devices[0].channels[0].outputs[0].tx_tag_idle_text";

fn errors(config: &airband_config::RtlAirbandConfig) -> Vec<(String, String)> {
    validate_config(config).errors.into_iter().map(|i| (i.code, i.path)).collect()
}

#[test]
fn idle_text_round_trips() {
    let c = config(r#"send_tx_tags = true; tx_tag_idle_text = "Scanning";"#);
    let airband_config::domain::Output::Icecast(o) = &c.devices[0].channels[0].outputs()[0] else { panic!() };
    assert_eq!(o.tx_tag_idle_text.as_deref(), Some("Scanning"));
    let text = airband_config::serialize_config_file(&c);
    assert!(text.contains("tx_tag_idle_text = \"Scanning\";"), "{text}");
    assert_eq!(airband_config::parse_config_file(&text).unwrap(), c);
}

#[test]
fn idle_text_with_send_tx_tags_is_fine() {
    assert_eq!(errors(&config(r#"send_tx_tags = true; tx_tag_idle_text = "Scanning";"#)), []);
}

#[test]
fn idle_text_needs_send_tx_tags() {
    let expected = [("tx-tag-idle-text-needs-send-tx-tags".to_string(), PATH.to_string())];
    assert_eq!(errors(&config(r#"tx_tag_idle_text = "Scanning";"#)), expected);
    assert_eq!(errors(&config(r#"send_tx_tags = false; tx_tag_idle_text = "Scanning";"#)), expected);
    // rtl_airband skips a disabled output before reading its settings.
    let disabled = errors(&config(r#"tx_tag_idle_text = "Scanning"; disable = true;"#));
    assert!(disabled.iter().all(|(code, _)| code != "tx-tag-idle-text-needs-send-tx-tags"), "{disabled:?}");
}

#[test]
fn idle_text_needs_fork_v7_7() {
    let c = config(r#"send_tx_tags = true; tx_tag_idle_text = "Scanning";"#);
    let v7_6: Vec<String> = ["fork", "send_tx_tags", "auto_ppm_voting"].iter().map(|s| s.to_string()).collect();
    let result = validate_config_for(&c, Some(&v7_6));
    let warned: Vec<&airband_validate::ValidationIssue> =
        result.warnings.iter().filter(|i| i.code == "needs-fork-feature").collect();
    assert_eq!(warned.len(), 1, "{warned:?}");
    assert_eq!(warned[0].severity, Severity::Warning);
    assert_eq!(warned[0].path, PATH);
    assert!(warned[0].message.starts_with("Needs jschmall RTLSDR-Airband fork v7.7.0 or newer."));
    assert!(warned[0].message.contains("the title is cleared between transmissions instead"));

    let v7_7: Vec<String> = v7_6.into_iter().chain(std::iter::once("tx_tag_idle_text".to_string())).collect();
    assert!(validate_config_for(&c, Some(&v7_7)).warnings.iter().all(|i| i.code != "needs-fork-feature"));
}
