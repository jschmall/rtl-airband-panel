//! systemd unit files for instances. Port of backend/api/src/unit-template.ts.

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UnitTemplate {
    pub description: String,
    pub binary_path: String,
    pub conf_path: String,
    /// Adds `-j` (single-line JSON logs).
    pub json_logging: bool,
    /// `User=`: must match the panel's own user once `control_socket_path`
    /// is set, since the control socket only accepts same-UID peers.
    pub service_user: Option<String>,
    pub service_group: Option<String>,
}

/// Mirrors RTLSDR-Airband's reference unit: foreground without waterfall
/// (`-F`), log to stderr for journald (`-e`), and `Restart=no` (an exit
/// means misconfiguration or device failure; restarting won't fix either).
pub fn render_unit_file(t: &UnitTemplate) -> String {
    let flags = if t.json_logging { "-F -e -j" } else { "-F -e" };
    let mut user_group = String::new();
    if let Some(u) = &t.service_user {
        user_group.push_str(&format!("User={u}\n"));
    }
    if let Some(g) = &t.service_group {
        user_group.push_str(&format!("Group={g}\n"));
    }
    format!(
        "[Unit]
Description={}
Documentation=https://github.com/rtl-airband/RTLSDR-Airband/wiki
Wants=network.target
After=network.target

[Service]
Type=simple
{user_group}ExecStart={} {flags} -c {}
Restart=no

[Install]
WantedBy=multi-user.target
",
        t.description, t.binary_path, t.conf_path
    )
}

/// What an existing unit file's `ExecStart=` runs, so the panel uses the
/// binary an instance actually runs instead of assuming a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecStart {
    pub binary_path: String,
    pub conf_path: Option<String>,
    pub json_logging: bool,
}

pub fn parse_exec_start(unit_file: &str) -> Option<ExecStart> {
    let line = unit_file.lines().map(str::trim).rfind(|l| l.starts_with("ExecStart="))?;
    // Strip systemd's executable prefixes (-, @, :, +, !).
    let command = line["ExecStart=".len()..].trim_start_matches(['-', '@', ':', '+', '!']);
    let mut words = command.split_whitespace();
    let binary_path = words.next()?.to_string();
    let args: Vec<&str> = words.collect();
    let conf_path = args.iter().position(|a| *a == "-c").and_then(|i| args.get(i + 1)).map(|s| s.to_string());
    let json_logging =
        args.iter().any(|a| *a == "-j" || (a.starts_with('-') && !a.starts_with("--") && a.contains('j')));
    Some(ExecStart { binary_path, conf_path, json_logging })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_and_parses_back() {
        let t = UnitTemplate {
            description: "RTLSDR-Airband instance: rtl_151".into(),
            binary_path: "/usr/local/bin/rtl_airband".into(),
            conf_path: "/etc/rtl-airband-panel/instances/rtl_151.conf".into(),
            json_logging: true,
            service_user: Some("rtl-airband-panel".into()),
            service_group: Some("rtl-airband-panel".into()),
        };
        let text = render_unit_file(&t);
        assert!(text.contains("User=rtl-airband-panel\nGroup=rtl-airband-panel\nExecStart="));
        assert!(text.contains(
            "ExecStart=/usr/local/bin/rtl_airband -F -e -j -c /etc/rtl-airband-panel/instances/rtl_151.conf\n"
        ));
        let parsed = parse_exec_start(&text).unwrap();
        assert_eq!(parsed.binary_path, t.binary_path);
        assert_eq!(parsed.conf_path.as_deref(), Some(t.conf_path.as_str()));
        assert!(parsed.json_logging);
    }

    #[test]
    fn matches_typescript_template_without_user() {
        let t = UnitTemplate {
            description: "RTLSDR-Airband instance: x".into(),
            binary_path: "/bin/rtl_airband".into(),
            conf_path: "/c/x.conf".into(),
            ..Default::default()
        };
        assert_eq!(
            render_unit_file(&t),
            "[Unit]\nDescription=RTLSDR-Airband instance: x\nDocumentation=https://github.com/rtl-airband/RTLSDR-Airband/wiki\nWants=network.target\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=/bin/rtl_airband -F -e -c /c/x.conf\nRestart=no\n\n[Install]\nWantedBy=multi-user.target\n"
        );
    }

    #[test]
    fn parses_hand_written_units() {
        let unit = "[Service]\nExecStart=-/opt/rtl/bin/rtl_airband -Fe -c /home/me/rtl_151.conf\n";
        let p = parse_exec_start(unit).unwrap();
        assert_eq!(p.binary_path, "/opt/rtl/bin/rtl_airband");
        assert_eq!(p.conf_path.as_deref(), Some("/home/me/rtl_151.conf"));
        assert!(!p.json_logging);
        assert_eq!(parse_exec_start("[Service]\nType=simple\n"), None);
    }
}
