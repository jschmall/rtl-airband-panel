//! Predicts, before a config is written, whether the change can be applied
//! to a running instance live (via the control socket's `reload_diff`) or
//! needs a restart of that instance's unit.
//!
//! Mirrors `compute_and_apply_diff()` in the RTLSDR-Airband fork
//! (src/live_reconfig.cpp, v6.3.0), and closes its blind spot: reload_diff
//! only looks at device/mixer counts, device type/mode, each device's channel
//! list (by signature) and `enabled` flags, device centerfreq / sample_rate /
//! gain / bandwidth / correction, and mixer name / remote_inputs / enabled.
//! A change anywhere else (any global setting, a mixer's own outputs or
//! filters, a device's serial/buffers/reserve_channels, ...) is neither applied
//! nor reported by reload_diff, so it is classified here as restart-required.
//!
//! Works on the syntax tree rather than the domain model because
//! reload_diff's channel signatures depend on literal value types and key
//! order (`freq = 151.78` and `freq = 151780000` are different channels to it).
//!
//! It also covers what reload_diff drops without reporting it: per-driver
//! setters that return ENOTSUP (mirisdr has no live gain/bandwidth/
//! correction, soapysdr no live correction), and float `bandwidth` /
//! `correction` values, which reload_diff reads with the frequency rule
//! (float = MHz) and would apply a million times too large.
//!
//! This is a prediction. reload_diff's own response stays authoritative
//! after the fact (a channel can still fail to parse, a driver can refuse a
//! gain change, a mixer can run out of reserve_inputs slots).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use airband_config::ast::{ConfigFile, Scalar, ScalarType, ScalarValue, Setting, Value};

/// What the panel should do with a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ApplyMethod {
    /// The running process already has this configuration.
    NoChange,
    /// Everything that changed is within reload_diff's scope.
    Live,
    /// At least one change needs a restart of this instance's unit.
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangePlan {
    /// Changes reload_diff will apply.
    pub live: Vec<String>,
    /// Changes that need a restart (reload_diff won't apply them).
    pub restart: Vec<String>,
    /// Audio interruptions a live apply causes, e.g. channels that are torn
    /// down and re-created, or a whole device restarting its RX thread.
    pub interrupts: Vec<String>,
}

impl ChangePlan {
    pub fn method(&self) -> ApplyMethod {
        if !self.restart.is_empty() {
            ApplyMethod::Restart
        } else if !self.live.is_empty() {
            ApplyMethod::Live
        } else {
            ApplyMethod::NoChange
        }
    }
}

/// The running process's view of its configuration.
pub struct Baseline<'a> {
    /// The config the process was (re)started with: fixes array capacities
    /// (channel count + reserve_channels) and whether a control socket exists.
    pub started: &'a ConfigFile,
    /// The config the process currently runs: `started` plus any live
    /// applies since. Equal to `started` if nothing was live-applied.
    pub applied: &'a ConfigFile,
}

pub fn plan_change(baseline: &Baseline, next: &ConfigFile) -> ChangePlan {
    let mut plan = ChangePlan::default();
    let (applied, started) = (baseline.applied, baseline.started);

    let has_socket = matches!(
        find(&started.members, "control_socket_path"),
        Some(Setting { value: Value::Scalar(Scalar { value: ScalarValue::String(p), .. }), .. }) if !p.trim().is_empty()
    );
    if !has_socket {
        if !members_eq(&applied.members, &next.members) {
            plan.restart.push("the running process has no control_socket_path, so nothing can be applied live".into());
        }
        return plan;
    }

    for key in changed_keys(&applied.members, &next.members, &["devices", "mixers"]) {
        plan.restart.push(format!("{key} changed"));
    }
    plan_devices(&mut plan, started, applied, next);
    plan_mixers(&mut plan, applied, next);
    plan
}

// -------------------------------------------------------------------- devices

const DEVICE_LIVE_KEYS: [&str; 9] =
    ["type", "mode", "channels", "centerfreq", "sample_rate", "gain", "bandwidth", "correction", "disable"];
const DEFAULT_SAMPLE_RATE: i64 = 2_560_000;

fn plan_devices(plan: &mut ChangePlan, started: &ConfigFile, applied: &ConfigFile, next: &ConfigFile) {
    let (old, new) = (active_items(&applied.members, "devices"), active_items(&next.members, "devices"));
    if old.len() != new.len() {
        plan.restart.push(format!("device count changed ({} -> {})", old.len(), new.len()));
        return;
    }
    let started_devices = active_items(&started.members, "devices");

    for (i, (a, n)) in old.iter().zip(&new).enumerate() {
        let label = format!("device[{i}]");
        if string_or(a, "type", "rtlsdr") != string_or(n, "type", "rtlsdr") {
            plan.restart.push(format!("{label}: driver type changed"));
            continue;
        }
        let is_scan = |g: &[Setting]| string_or(g, "mode", "").starts_with("scan");
        if is_scan(a) != is_scan(n) {
            plan.restart.push(format!("{label}: mode changed"));
            continue;
        }
        let scan = is_scan(n);

        plan_channels(plan, &label, scan, started_devices.get(i).copied(), a, n);

        if !scan {
            match (find(n, "centerfreq"), find(a, "centerfreq")) {
                (Some(nc), _) => {
                    let (new_hz, old_hz) =
                        (anynum_to_int(&nc.value), find(a, "centerfreq").and_then(|s| anynum_to_int(&s.value)));
                    match new_hz {
                        Some(hz) if Some(hz) != old_hz => plan.live.push(format!("{label}: centerfreq -> {hz}")),
                        Some(_) => {}
                        None => plan.restart.push(format!("{label}: centerfreq is not a number reload_diff can apply")),
                    }
                }
                (None, Some(_)) => plan.restart.push(format!("{label}: centerfreq removed")),
                (None, None) => {}
            }
        }

        let driver = string_or(n, "type", "rtlsdr");
        let old_rate = find(a, "sample_rate").and_then(|s| anynum_to_int(&s.value)).unwrap_or(DEFAULT_SAMPLE_RATE);
        match find(n, "sample_rate").map(|s| anynum_to_int(&s.value)) {
            Some(Some(rate)) if rate != old_rate => {
                if scan {
                    plan.restart.push(format!("{label}: sample_rate changed (not live-appliable in scan mode)"));
                } else if driver == "soapysdr" {
                    plan.restart.push(format!("{label}: sample_rate changed (soapysdr devices can't change it live)"));
                } else {
                    plan.live.push(format!("{label}: sample_rate -> {rate}"));
                    plan.interrupts
                        .push(format!("{label}: changing sample_rate briefly stops and reopens the whole device"));
                }
            }
            Some(Some(_)) => {}
            Some(None) => plan.restart.push(format!("{label}: sample_rate is not a number reload_diff can apply")),
            None if old_rate != DEFAULT_SAMPLE_RATE => plan.restart.push(format!("{label}: sample_rate removed")),
            None => {}
        }

        for key in ["gain", "bandwidth", "correction"] {
            plan_reapplied(plan, &label, driver, a, n, key);
        }

        for key in changed_keys(a, n, &DEVICE_LIVE_KEYS) {
            plan.restart.push(format!("{label}: {key} changed"));
        }
    }
}

/// Which of gain / bandwidth / correction each driver can set live (the
/// rest return ENOTSUP, which reload_diff drops without reporting).
fn live_setter_supported(driver: &str, key: &str) -> bool {
    match driver {
        "rtlsdr" => true,
        "soapysdr" => key != "correction",
        _ => false,
    }
}

/// gain / bandwidth / correction: reload_diff re-applies whatever the file
/// says (there's no live-readable current value), so a changed value is live
/// only if it is present, of a form reload_diff reads correctly, and the
/// driver has a live setter for it.
fn plan_reapplied(plan: &mut ChangePlan, label: &str, driver: &str, a: &[Setting], n: &[Setting], key: &str) {
    let (old, new) = (find(a, key).map(|s| &s.value), find(n, key).map(|s| &s.value));
    if opt_value_eq(old, new) {
        return;
    }
    let Some(new) = new else {
        plan.restart.push(format!("{label}: {key} removed"));
        return;
    };
    if !live_setter_supported(driver, key) {
        plan.restart.push(format!("{label}: {key} changed ({driver} devices can't change it live)"));
        return;
    }
    let shown = match (key, new) {
        // Only a numeric gain has a single value to apply (not SoapySDR's "LNA=10,..." form).
        ("gain", Value::Scalar(s)) if s.as_number().is_some() => cpp_double(s.as_number().unwrap()),
        ("gain", _) => {
            plan.restart.push(format!("{label}: gain changed (only a numeric gain can be applied live)"));
            return;
        }
        // reload_diff reads these with the frequency rule: a float is taken as MHz.
        (_, Value::Scalar(s)) if s.ty == ScalarType::Float => {
            plan.restart.push(format!(
                "{label}: {key} changed (reload_diff would misread a non-integer {key} as MHz, so it needs a restart)"
            ));
            return;
        }
        (_, v) => match anynum_to_int(v) {
            Some(n) => n.to_string(),
            None => {
                plan.restart.push(format!("{label}: {key} is not a number reload_diff can apply"));
                return;
            }
        },
    };
    plan.live.push(format!("{label}: {key} -> {shown}"));
}

fn plan_channels(
    plan: &mut ChangePlan,
    label: &str,
    scan: bool,
    started: Option<&[Setting]>,
    a: &[Setting],
    n: &[Setting],
) {
    let (old, new) = (active_list(a, "channels"), active_list(n, "channels"));
    let old_sigs: Vec<String> = old.iter().map(|c| channel_signature(c)).collect();
    let new_sigs: Vec<String> = new.iter().map(|c| channel_signature(c)).collect();
    let common = old_sigs.iter().zip(&new_sigs).take_while(|(o, n)| o == n).count();

    // reload_diff compares rendered signatures, which keep only 6
    // significant digits of a float; a smaller edit is invisible to it.
    for (j, (o, nw)) in old.iter().zip(&new).enumerate().take(common) {
        if !members_eq_ignoring(o, nw, &["enabled"]) {
            plan.restart.push(format!(
                "{label} channel[{j}]: changed by less than reload_diff can detect (floats are compared to 6 significant digits)"
            ));
        }
    }

    let diverges = common < old.len() || common < new.len();
    if diverges && scan {
        plan.restart.push(format!(
            "{label}: channel count or definition changed (scan-mode devices don't support live channel changes)"
        ));
    } else if diverges {
        let to_remove = old.len() - common;
        let to_add = new.len() - common;
        let capacity = started.map_or(old.len(), |s| {
            active_list(s, "channels").len() + number_or(s, "reserve_channels", 0.0).max(0.0) as usize
        });
        if to_remove > 0 {
            plan.live.push(format!(
                "{label}: removed {to_remove} channel(s) from the tail{}",
                if common < new.len() { " (replacing)" } else { "" }
            ));
            plan.interrupts.push(if to_remove == 1 {
                format!("{label}: channel[{common}] is torn down{}", if to_add > 0 { " and re-created" } else { "" })
            } else {
                format!(
                    "{label}: channels {common}-{} are torn down{}",
                    old.len() - 1,
                    if to_add > 0 { " and re-created" } else { "" }
                )
            });
        }
        if to_add > 0 {
            let free = capacity.saturating_sub(common);
            if to_add > free {
                plan.restart.push(format!(
                    "{label}: {to_add} new/replacement channel(s) declared but only {free} reserve_channels slot(s) available"
                ));
            } else {
                plan.live.push(format!("{label}: added {to_add} channel(s) (index {common}-{})", common + to_add - 1));
            }
        }
    }

    for j in 0..common {
        let (was, is) = (bool_or(old[j], "enabled", true), bool_or(new[j], "enabled", true));
        if was != is {
            plan.live.push(format!("{label} channel[{j}]: enabled -> {is}"));
        }
    }
}

// --------------------------------------------------------------------- mixers

fn plan_mixers(plan: &mut ChangePlan, applied: &ConfigFile, next: &ConfigFile) {
    let (old, new) = (active_mixers(applied), active_mixers(next));
    if old.len() != new.len() {
        plan.restart.push("mixer count changed".into());
        return;
    }
    for (i, ((old_name, a), (new_name, n))) in old.iter().zip(&new).enumerate() {
        if old_name != new_name {
            plan.restart.push(format!("mixer[{i}]: name changed"));
            continue;
        }
        let remote = |g: &[Setting]| find(g, "remote_inputs").map(|s| s.value.clone());
        if !opt_value_eq(remote(a).as_ref(), remote(n).as_ref()) {
            plan.restart.push(format!("mixer[{i}]: remote_inputs changed"));
            continue;
        }
        let (was, is) = (bool_or(a, "enabled", true), bool_or(n, "enabled", true));
        if was != is {
            plan.live.push(format!("mixer '{new_name}': enabled -> {is}"));
        }
        for key in changed_keys(a, n, &["enabled", "disable", "remote_inputs"]) {
            plan.restart.push(format!("mixer '{new_name}': {key} changed"));
        }
    }
}

fn active_mixers(config: &ConfigFile) -> Vec<(&str, &[Setting])> {
    match find(&config.members, "mixers").map(|s| &s.value) {
        Some(Value::Group { members }) => members
            .iter()
            .filter_map(|m| match &m.value {
                Value::Group { members } if !is_disabled(members) => Some((m.name.as_str(), members.as_slice())),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

// -------------------------------------------------------------------- helpers

fn find<'a>(members: &'a [Setting], name: &str) -> Option<&'a Setting> {
    members.iter().find(|m| m.name == name)
}

fn is_disabled(members: &[Setting]) -> bool {
    bool_or(members, "disable", false)
}

fn bool_or(members: &[Setting], name: &str, default: bool) -> bool {
    match find(members, name).map(|s| &s.value) {
        Some(Value::Scalar(Scalar { value: ScalarValue::Bool(b), .. })) => *b,
        _ => default,
    }
}

fn string_or<'a>(members: &'a [Setting], name: &str, default: &'a str) -> &'a str {
    match find(members, name).map(|s| &s.value) {
        Some(Value::Scalar(Scalar { value: ScalarValue::String(v), .. })) => v,
        _ => default,
    }
}

fn number_or(members: &[Setting], name: &str, default: f64) -> f64 {
    match find(members, name).map(|s| &s.value) {
        Some(Value::Scalar(s)) => s.as_number().unwrap_or(default),
        _ => default,
    }
}

/// Group items of a list setting that aren't `disable = true`.
fn active_list<'a>(members: &'a [Setting], name: &str) -> Vec<&'a [Setting]> {
    match find(members, name).map(|s| &s.value) {
        Some(Value::List { items, .. }) => items
            .iter()
            .filter_map(|i| match i {
                Value::Group { members } if !is_disabled(members) => Some(members.as_slice()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn active_items<'a>(members: &'a [Setting], name: &str) -> Vec<&'a [Setting]> {
    active_list(members, name)
}

/// The fork's snapshot_parse_anynum2int(): int as-is, float MHz truncated
/// (not rounded) to int Hz. Strings (atofs) are not predicted.
fn anynum_to_int(v: &Value) -> Option<i64> {
    match v {
        Value::Scalar(Scalar { ty: ScalarType::Int | ScalarType::Int64, value: ScalarValue::Number(n), .. }) => {
            Some(n.trunc() as i64)
        }
        Value::Scalar(Scalar { ty: ScalarType::Float, value: ScalarValue::Number(n), .. }) => {
            Some((n * 1e6).trunc() as i64)
        }
        _ => None,
    }
}

/// Keys (other than `ignore`) whose value differs, was added, or was removed.
fn changed_keys<'a>(a: &'a [Setting], n: &'a [Setting], ignore: &[&str]) -> Vec<&'a str> {
    let mut keys: Vec<&str> = Vec::new();
    for s in a.iter().chain(n) {
        if ignore.contains(&s.name.as_str()) || keys.contains(&s.name.as_str()) {
            continue;
        }
        let (old, new) = (find(a, &s.name).map(|x| &x.value), find(n, &s.name).map(|x| &x.value));
        if !opt_value_eq(old, new) && !equivalent_spelling(&s.name, old, new) {
            keys.push(&s.name);
        }
    }
    keys
}

/// Values rtl_airband reads identically despite different literal types:
/// `dest_port` may be an int or a string (config.cpp formats an int with
/// `%d`), and the panel always writes it as a string.
fn equivalent_spelling(name: &str, a: Option<&Value>, b: Option<&Value>) -> bool {
    let as_text = |v: Option<&Value>| match v {
        Some(Value::Scalar(Scalar { value: ScalarValue::String(s), .. })) => Some(s.clone()),
        Some(Value::Scalar(Scalar {
            ty: ScalarType::Int | ScalarType::Int64, value: ScalarValue::Number(n), ..
        })) => Some((*n as i64).to_string()),
        _ => None,
    };
    name == "dest_port" && as_text(a).is_some() && as_text(a) == as_text(b)
}

fn opt_value_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => value_eq(a, b),
        (None, None) => true,
        _ => false,
    }
}

/// Semantic equality: ignores literal spelling and assignment operator;
/// group keys compare by name regardless of order.
fn value_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Scalar(x), Value::Scalar(y)) => {
            let class = |t: ScalarType| match t {
                ScalarType::Int | ScalarType::Int64 => 0,
                other => other as u8 + 1,
            };
            class(x.ty) == class(y.ty) && x.value == y.value
        }
        (Value::Group { members: x }, Value::Group { members: y }) => members_eq(x, y),
        (Value::List { items: x, .. }, Value::List { items: y, .. }) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| value_eq(p, q))
        }
        _ => false,
    }
}

fn members_eq(a: &[Setting], b: &[Setting]) -> bool {
    members_eq_ignoring(a, b, &[])
}

fn members_eq_ignoring(a: &[Setting], b: &[Setting], ignore: &[&str]) -> bool {
    changed_keys(a, b, ignore).is_empty()
}

/// The fork's build_channel_identity_signature() (config.cpp): every
/// setting except `enabled`, rendered in source order.
pub fn channel_signature(channel: &[Setting]) -> String {
    let mut out = String::from("{");
    for s in channel.iter().filter(|s| s.name != "enabled") {
        out.push_str(&s.name);
        out.push('=');
        render_setting(&s.value, &mut out);
        out.push(';');
    }
    out.push('}');
    out
}

/// The fork's serialize_setting() (config.cpp).
fn render_setting(v: &Value, out: &mut String) {
    match v {
        Value::Scalar(Scalar { ty: ScalarType::Int | ScalarType::Int64, value: ScalarValue::Number(n), .. }) => {
            out.push_str(&(*n as i64).to_string())
        }
        Value::Scalar(Scalar { ty: ScalarType::Float, value: ScalarValue::Number(n), .. }) => {
            out.push_str(&cpp_double(*n))
        }
        Value::Scalar(Scalar { value: ScalarValue::String(s), .. }) => {
            out.push('"');
            out.push_str(s);
            out.push('"');
        }
        Value::Scalar(Scalar { value: ScalarValue::Bool(b), .. }) => out.push_str(if *b { "true" } else { "false" }),
        Value::Scalar(_) => out.push('?'),
        Value::Group { members } => {
            out.push('{');
            for m in members {
                out.push_str(&m.name);
                out.push('=');
                render_setting(&m.value, out);
                out.push(';');
            }
            out.push('}');
        }
        Value::List { items, .. } => {
            out.push('{');
            for item in items {
                render_setting(item, out);
                out.push(';');
            }
            out.push('}');
        }
    }
}

/// `std::ostream << double` with default flags: `%g`, 6 significant digits.
pub fn cpp_double(x: f64) -> String {
    if x.is_nan() {
        return "nan".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "inf" } else { "-inf" }.into();
    }
    if x == 0.0 {
        return if x.is_sign_negative() { "-0" } else { "0" }.into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let sci = format!("{:.5e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let trim = |s: &str| -> String {
        if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s.to_string() }
    };
    if !(-4..6).contains(&exp) {
        format!("{sign}{}e{}{:02}", trim(mantissa), if exp < 0 { '-' } else { '+' }, exp.abs())
    } else {
        format!("{sign}{}", trim(&format!("{:.*}", (5 - exp) as usize, x.abs())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpp_double_matches_printf_g() {
        let cases: &[(f64, &str)] = &[
            (151.16, "151.16"),
            (151.78, "151.78"),
            (118.0125, "118.013"),
            (118.0126, "118.013"),
            (100.0, "100"),
            (0.5, "0.5"),
            (1e-5, "1e-05"),
            (0.0001, "0.0001"),
            (123456.0, "123456"),
            (1234567.0, "1.23457e+06"),
            (151_780_000.0, "1.5178e+08"),
            (-2.5, "-2.5"),
            (0.0, "0"),
        ];
        for (x, want) in cases {
            assert_eq!(cpp_double(*x), *want, "{x}");
        }
    }
}
