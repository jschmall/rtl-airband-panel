//! Live-apply vs restart predictions, mirroring the fork's reload_diff.

use airband_config::parse_config;
use airband_supervisor::{ApplyMethod, Baseline, ChangePlan, plan_change};

const HEAD: &str = r#"multiple_demod_threads = true; multiple_output_threads = true;
stats_filepath = "/tmp/s.txt"; localtime = true; control_socket_path = "/run/rtl/x.sock";"#;

fn chan(freq: u32, extra: &str) -> String {
    format!(r#"{{ freq = {freq}; {extra} outputs: ( {{ type = "pulse"; }} ); }}"#)
}

fn device(dev_extra: &str, channels: &[String]) -> String {
    format!(
        r#"{{ type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 151000000; {dev_extra} channels: ( {} ); }}"#,
        channels.join(", ")
    )
}

fn conf(head: &str, devices: &[String], tail: &str) -> String {
    format!("{head}\ndevices: ( {} );\n{tail}", devices.join(", "))
}

fn plan(old: &str, new: &str) -> ChangePlan {
    let (a, n) = (parse_config(old).unwrap(), parse_config(new).unwrap());
    plan_change(&Baseline { started: &a, applied: &a }, &n)
}

fn base_channels() -> Vec<String> {
    vec![chan(151100000, ""), chan(151200000, ""), chan(151300000, "")]
}

#[test]
fn identical_config_is_no_change() {
    let c = conf(HEAD, &[device("", &base_channels())], "");
    assert_eq!(plan(&c, &c).method(), ApplyMethod::NoChange);
}

#[test]
fn spelling_only_differences_are_no_change() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let b = a.replace("multiple_output_threads = true", "multiple_output_threads: TRUE");
    assert_eq!(plan(&a, &b).method(), ApplyMethod::NoChange);
}

#[test]
fn without_a_control_socket_everything_restarts() {
    let head = HEAD.replace(r#"control_socket_path = "/run/rtl/x.sock";"#, "");
    let a = conf(&head, &[device("", &base_channels())], "");
    let b = a.replace("gain = 29", "gain = 30");
    let p = plan(&a, &b);
    assert_eq!(p.method(), ApplyMethod::Restart);
    assert!(p.restart[0].contains("no control_socket_path"));
}

#[test]
fn global_changes_need_a_restart() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    for (from, to) in [("localtime = true", "localtime = false"), ("/tmp/s.txt", "/tmp/t.txt")] {
        let p = plan(&a, &a.replace(from, to));
        assert_eq!(p.method(), ApplyMethod::Restart, "{to}");
    }
    let p = plan(&a, &a.replace("localtime = true;", "localtime = true; fft_size = 1024;"));
    assert_eq!(p.restart, ["fft_size changed"]);
}

#[test]
fn device_tuning_changes_are_live_on_rtlsdr() {
    let a = conf(HEAD, &[device("correction = 2; bandwidth = 0;", &base_channels())], "");
    let b = a
        .replace("centerfreq = 151000000", "centerfreq = 151050000")
        .replace("gain = 29", "gain = 33.8")
        .replace("correction = 2", "correction = -1")
        .replace("bandwidth = 0", "bandwidth = 350000");
    let p = plan(&a, &b);
    assert_eq!(p.method(), ApplyMethod::Live, "{p:?}");
    assert_eq!(
        p.live,
        [
            "device[0]: centerfreq -> 151050000",
            "device[0]: gain -> 33.8",
            "device[0]: bandwidth -> 350000",
            "device[0]: correction -> -1"
        ]
    );
    assert!(p.interrupts.is_empty());
}

#[test]
fn sample_rate_is_live_but_interrupts_the_device() {
    let a = conf(HEAD, &[device("sample_rate = 2400000;", &base_channels())], "");
    let p = plan(&a, &a.replace("sample_rate = 2400000", "sample_rate = 2048000"));
    assert_eq!(p.method(), ApplyMethod::Live);
    assert_eq!(p.interrupts.len(), 1);
    // Removing it falls back to the default, which reload_diff never applies.
    let p = plan(&a, &a.replace("sample_rate = 2400000;", ""));
    assert_eq!(p.restart, ["device[0]: sample_rate removed"]);
}

#[test]
fn per_driver_setter_support() {
    let miri = conf(HEAD, &[device("", &base_channels()).replace("rtlsdr", "mirisdr")], "");
    let p = plan(&miri, &miri.replace("gain = 29", "gain = 30"));
    assert_eq!(p.restart, ["device[0]: gain changed (mirisdr devices can't change it live)"]);

    let soapy = conf(HEAD, &[device("correction = 1;", &base_channels()).replace("rtlsdr", "soapysdr")], "");
    let p = plan(&soapy, &soapy.replace("correction = 1", "correction = 2"));
    assert_eq!(p.restart, ["device[0]: correction changed (soapysdr devices can't change it live)"]);
    let p = plan(&soapy, &soapy.replace("gain = 29", "gain = 31"));
    assert_eq!(p.method(), ApplyMethod::Live);
    let p = plan(&soapy, &soapy.replace("gain = 29", r#"gain = "LNA=10""#));
    assert_eq!(p.method(), ApplyMethod::Restart);
    let p = plan(&soapy, &soapy.replace("gain = 29;", "gain = 29; sample_rate = 2048000;"));
    assert_eq!(p.method(), ApplyMethod::Restart);
}

#[test]
fn float_correction_or_bandwidth_is_not_sent_through_reload_diff() {
    let a = conf(HEAD, &[device("correction = 1;", &base_channels())], "");
    let p = plan(&a, &a.replace("correction = 1", "correction = 1.5"));
    assert_eq!(p.method(), ApplyMethod::Restart);
    assert!(p.restart[0].contains("misread"), "{p:?}");
}

#[test]
fn other_device_fields_need_a_restart() {
    let a = conf(HEAD, &[device("buffers = 10;", &base_channels())], "");
    let p = plan(&a, &a.replace("buffers = 10", "buffers = 12").replace(r#"serial = "1""#, r#"serial = "2""#));
    assert_eq!(p.restart, ["device[0]: serial changed", "device[0]: buffers changed"]);
}

#[test]
fn appending_channels_needs_reserve_slots() {
    let mut more = base_channels();
    more.push(chan(151400000, ""));
    let none = conf(HEAD, &[device("", &base_channels())], "");
    let p = plan(&none, &conf(HEAD, &[device("", &more)], ""));
    assert_eq!(
        p.restart,
        ["device[0]: 1 new/replacement channel(s) declared but only 0 reserve_channels slot(s) available"]
    );

    let reserved = conf(HEAD, &[device("reserve_channels = 2;", &base_channels())], "");
    let p = plan(&reserved, &conf(HEAD, &[device("reserve_channels = 2;", &more)], ""));
    assert_eq!(p.method(), ApplyMethod::Live);
    assert_eq!(p.live, ["device[0]: added 1 channel(s) (index 3-3)"]);
    assert!(p.interrupts.is_empty());
}

#[test]
fn capacity_comes_from_the_config_the_process_started_with() {
    let mut four = base_channels();
    four.push(chan(151400000, ""));
    let mut five = four.clone();
    five.push(chan(151500000, ""));
    let started = parse_config(&conf(HEAD, &[device("reserve_channels = 1;", &base_channels())], "")).unwrap();
    let applied = parse_config(&conf(HEAD, &[device("reserve_channels = 1;", &four)], "")).unwrap();
    let next = parse_config(&conf(HEAD, &[device("reserve_channels = 1;", &five)], "")).unwrap();
    let p = plan_change(&Baseline { started: &started, applied: &applied }, &next);
    assert_eq!(
        p.restart,
        ["device[0]: 1 new/replacement channel(s) declared but only 0 reserve_channels slot(s) available"]
    );
}

#[test]
fn editing_a_channel_replaces_it_and_everything_after_it() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let b = a.replacen("freq = 151200000;", "freq = 151200000; ctcss = 100.0;", 1);
    let p = plan(&a, &b);
    assert_eq!(p.method(), ApplyMethod::Live, "{p:?}");
    assert_eq!(
        p.live,
        ["device[0]: removed 2 channel(s) from the tail (replacing)", "device[0]: added 2 channel(s) (index 1-2)"]
    );
    assert_eq!(p.interrupts, ["device[0]: channels 1-2 are torn down and re-created"]);
}

#[test]
fn removing_the_last_channel_is_live() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let p = plan(&a, &conf(HEAD, &[device("", &base_channels()[..2])], ""));
    assert_eq!(p.live, ["device[0]: removed 1 channel(s) from the tail"]);
    assert_eq!(p.interrupts, ["device[0]: channel[2] is torn down"]);
}

#[test]
fn toggling_enabled_is_a_cheap_live_flip() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let b = a.replacen("freq = 151200000;", "freq = 151200000; enabled = false;", 1);
    let p = plan(&a, &b);
    assert_eq!(p.live, ["device[0] channel[1]: enabled -> false"]);
    assert!(p.interrupts.is_empty());
}

#[test]
fn disabling_a_channel_removes_it_from_the_active_list() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let b = a.replacen("freq = 151300000;", "freq = 151300000; disable = true;", 1);
    assert_eq!(plan(&a, &b).live, ["device[0]: removed 1 channel(s) from the tail"]);
}

#[test]
fn hand_written_float_frequencies_differ_from_panel_written_ints() {
    // reload_diff signatures keep literal types: the first panel save of a
    // hand-written file re-creates every channel, and retunes by the
    // truncation error of the float centerfreq.
    let hand = conf(HEAD, &[device("", &[chan(151100000, "")]).replace("freq = 151100000", "freq = 151.1")], "")
        .replace("centerfreq = 151000000", "centerfreq = 128.01");
    // 128.01 * 1e6 is 128009999.99999999 in floating point; the fork truncates it.
    let panel = conf(HEAD, &[device("", &[chan(151100000, "")])], "")
        .replace("centerfreq = 151000000", "centerfreq = 128010000");
    let p = plan(&hand, &panel);
    assert_eq!(p.method(), ApplyMethod::Live, "{p:?}");
    assert!(p.live.contains(&"device[0]: centerfreq -> 128010000".to_string()), "{p:?}");
    assert_eq!(p.interrupts, ["device[0]: channel[0] is torn down and re-created"]);
}

#[test]
fn edits_below_float_signature_precision_need_a_restart() {
    let a = conf(HEAD, &[device("", &[chan(1, "notch = 118.0125;")])], "");
    let p = plan(&a, &a.replace("118.0125", "118.0126"));
    assert_eq!(p.method(), ApplyMethod::Restart);
    assert!(p.restart[0].contains("6 significant digits"), "{p:?}");
}

#[test]
fn scan_devices_never_change_channels_live() {
    let scan = |freqs: &str| {
        conf(
            HEAD,
            &[format!(
                r#"{{ type = "rtlsdr"; index = 0; gain = 25; mode = "scan"; channels: ( {{ freqs = ({freqs}); outputs: ( {{ type = "pulse"; }} ); }} ); }}"#
            )],
            "",
        )
    };
    let p = plan(&scan("118000000, 119000000"), &scan("118000000, 119500000"));
    assert_eq!(p.method(), ApplyMethod::Restart);
}

#[test]
fn device_structure_changes_need_a_restart() {
    let a = conf(HEAD, &[device("", &base_channels())], "");
    let two = conf(HEAD, &[device("", &base_channels()), device("", &base_channels())], "");
    assert_eq!(plan(&a, &two).restart, ["device count changed (1 -> 2)"]);
    let disabled = conf(HEAD, &[device("", &base_channels()), device("disable = true;", &base_channels())], "");
    assert_eq!(plan(&a, &disabled).method(), ApplyMethod::NoChange, "a disabled device is invisible to reload_diff");
    assert_eq!(
        plan(&a, &a.replace(r#"type = "rtlsdr""#, r#"type = "mirisdr""#)).restart,
        ["device[0]: driver type changed"]
    );
}

#[test]
fn mixers() {
    let mixer = |extra: &str| {
        format!(
            r#"mixers: {{ m: {{ {extra} outputs: ( {{ type = "icecast"; server = "s"; port = 8000; mountpoint = "/m"; username = "u"; password = "p"; }} ); }}; }};"#
        )
    };
    let routed = vec![chan(151100000, "").replace(r#"{ type = "pulse"; }"#, r#"{ type = "mixer"; name = "m"; }"#)];
    let a = conf(HEAD, &[device("", &routed)], &mixer(""));

    let p = plan(&a, &conf(HEAD, &[device("", &routed)], &mixer("enabled = false;")));
    assert_eq!(p.live, ["mixer 'm': enabled -> false"]);

    // A mixer's own outputs and filters are outside reload_diff's scope.
    let p = plan(&a, &a.replace("port = 8000", "port = 8001"));
    assert_eq!(p.restart, ["mixer 'm': outputs changed"]);
    let p = plan(&a, &conf(HEAD, &[device("", &routed)], &mixer("lowpass = 3000;")));
    assert_eq!(p.restart, ["mixer 'm': lowpass changed"]);

    let p = plan(
        &a,
        &conf(
            HEAD,
            &[device("", &routed)],
            &mixer(r#"remote_inputs: ( { listen_path = "/run/m"; stream_id = 0; } );"#),
        ),
    );
    assert_eq!(p.restart, ["mixer[0]: remote_inputs changed"]);
}

#[test]
fn dest_port_int_and_string_are_the_same_setting() {
    // The panel always writes dest_port as a string; rtl_airband reads both.
    let mixer = |port: &str| {
        format!(
            r#"mixers: {{ m: {{ outputs: ( {{ type = "udp_stream"; dest_address = "127.0.0.1"; dest_port = {port}; }} ); }}; }};"#
        )
    };
    let routed = vec![chan(151100000, "").replace(r#"{ type = "pulse"; }"#, r#"{ type = "mixer"; name = "m"; }"#)];
    let a = conf(HEAD, &[device("", &routed)], &mixer("5006"));
    assert_eq!(plan(&a, &conf(HEAD, &[device("", &routed)], &mixer("\"5006\""))).method(), ApplyMethod::NoChange);
    assert_eq!(
        plan(&a, &conf(HEAD, &[device("", &routed)], &mixer("\"5007\""))).restart,
        ["mixer 'm': outputs changed"]
    );
}
