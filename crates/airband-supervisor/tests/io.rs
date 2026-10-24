//! Control socket, stats, and mock-unit behavior against local fakes.

use std::path::Path;
use std::time::Duration;

use airband_supervisor::control_socket::{Command, CommandResult, ControlSocketClient, ReloadDiffResult, StatusResult};
use airband_supervisor::stats::{StatsReader, StatsSource};
use airband_supervisor::systemd::{ActiveState, LogLine, MockUnits, UnitManager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, UnixListener};

/// A fake rtl_airband control socket: answers each request line with `reply`.
fn fake_socket(path: &Path, reply: &'static str) -> tokio::task::JoinHandle<Vec<String>> {
    let listener = UnixListener::bind(path).unwrap();
    tokio::spawn(async move {
        let mut seen = Vec::new();
        while let Ok(Ok((stream, _))) = tokio::time::timeout(Duration::from_millis(500), listener.accept()).await {
            let (read, mut write) = stream.into_split();
            let mut line = String::new();
            BufReader::new(read).read_line(&mut line).await.unwrap();
            seen.push(line.trim_end().to_string());
            write.write_all(reply.as_bytes()).await.unwrap();
        }
        seen
    })
}

#[tokio::test]
async fn reload_diff_applied() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("ctl.sock");
    let server =
        fake_socket(&sock, "{\"ok\":true,\"applied\":[\"device[0]: gain -> 30\"],\"skipped_requires_restart\":[]}\n");
    let result = ControlSocketClient::default().reload_diff(&sock).await;
    assert_eq!(
        result,
        ReloadDiffResult::Applied { applied: vec!["device[0]: gain -> 30".into()], skipped_requires_restart: vec![] }
    );
    assert_eq!(server.await.unwrap(), [r#"{"cmd":"reload_diff"}"#]);
}

#[tokio::test]
async fn reload_diff_error_and_garbage() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("a.sock");
    let _s = fake_socket(&sock, "{\"ok\":false,\"error\":\"config parse error\"}\n");
    assert_eq!(
        ControlSocketClient::default().reload_diff(&sock).await,
        ReloadDiffResult::ProtocolError { message: "config parse error".into() }
    );
    let sock = dir.path().join("b.sock");
    let _s = fake_socket(&sock, "not json\n");
    assert!(matches!(ControlSocketClient::default().reload_diff(&sock).await, ReloadDiffResult::ProtocolError { .. }));
}

#[tokio::test]
async fn unreachable_sockets() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing.sock");
    assert_eq!(
        ControlSocketClient::default().reload_diff(&missing).await,
        ReloadDiffResult::Unreachable { reason: "ENOENT".into() }
    );

    // Accepts but never answers -> timeout.
    let silent = dir.path().join("silent.sock");
    let listener = UnixListener::bind(&silent).unwrap();
    let _keep = tokio::spawn(async move {
        let (_s, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
    });
    let client = ControlSocketClient::new(Duration::from_millis(100));
    assert_eq!(client.reload_diff(&silent).await, ReloadDiffResult::Unreachable { reason: "timeout".into() });

    // Answers without a newline, then closes.
    let partial = dir.path().join("partial.sock");
    let _s = fake_socket(&partial, "{\"ok\":true");
    assert!(matches!(ControlSocketClient::default().reload_diff(&partial).await, ReloadDiffResult::Unreachable { .. }));
}

#[tokio::test]
async fn status_parses_the_daemons_reply() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("ctl.sock");
    let server = fake_socket(&sock, include_str!("fixtures/status-v6.4.0.json"));
    let StatusResult::Ok(report) = ControlSocketClient::default().status(&sock).await else { panic!("not Ok") };
    assert_eq!(server.await.unwrap(), [r#"{"cmd":"status"}"#]);

    assert_eq!(report.version, "v6.4.0");
    assert_eq!(report.devices.len(), 2);
    let rtl = &report.devices[0];
    assert_eq!((rtl.driver.as_deref(), rtl.centerfreq, rtl.sample_rate), (Some("rtlsdr"), 120_000_000, 2_560_000));
    assert_eq!((rtl.gain, rtl.correction, rtl.bandwidth, rtl.peak_dbfs), (Some(33.8), Some(2.0), Some(0), Some(-6.02)));
    assert_eq!((rtl.clipped_samples, rtl.buffer_overflows), (7, 3));
    let tower = &rtl.channels[0].freqs[0];
    assert_eq!(tower.label.as_deref(), Some("Tower \"A\""));
    assert_eq!((tower.freq_offset_hz, tower.freq_offset_updates), (Some(42.0), 5));
    assert!(!rtl.channels[1].enabled);
    assert_eq!(rtl.channels[1].freqs[0].noise_dbfs, None);

    let file = &report.devices[1];
    assert_eq!((file.mode.as_str(), file.gain, file.peak_dbfs), ("scan", None, None));
    assert_eq!(file.channels[0].freq_idx, 1);
    assert_eq!(file.channels[0].freqs[1].freq_offset_hz, Some(-15.5));
}

#[tokio::test]
async fn status_on_an_older_daemon_is_unsupported() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("old.sock");
    let _s = fake_socket(&sock, "{\"ok\":false,\"error\":\"unknown cmd 'status'\"}\n");
    assert_eq!(ControlSocketClient::default().status(&sock).await, StatusResult::Unsupported);

    let sock = dir.path().join("odd.sock");
    let _s = fake_socket(&sock, "{\"ok\":true,\"devices\":\"nope\"}\n");
    assert!(matches!(ControlSocketClient::default().status(&sock).await, StatusResult::ProtocolError { .. }));

    assert!(matches!(
        ControlSocketClient::default().status(&dir.path().join("missing.sock")).await,
        StatusResult::Unreachable { .. }
    ));
}

#[tokio::test]
async fn single_commands_use_the_daemons_field_names() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("ctl.sock");
    let server = fake_socket(&sock, "{\"ok\":true}\n");
    let client = ControlSocketClient::default();
    assert_eq!(client.send(&sock, &Command::Retune { device: 0, freq: 151_780_000 }).await, CommandResult::Ok);
    assert_eq!(client.send(&sock, &Command::ChannelDisable { device: 1, channel: 3 }).await, CommandResult::Ok);
    assert_eq!(client.send(&sock, &Command::MixerEnable { mixer: "all".into() }).await, CommandResult::Ok);
    let seen = server.await.unwrap();
    assert_eq!(
        seen,
        [
            r#"{"cmd":"retune","device":0,"freq":151780000}"#,
            r#"{"channel":3,"cmd":"channel_disable","device":1}"#,
            r#"{"cmd":"mixer_enable","mixer":"all"}"#,
        ]
    );
}

const STATS: &str =
    "# TYPE channel_activity_counter counter\nchannel_activity_counter{freq=\"151.160\",label=\"Tower\"} 42\n";

#[tokio::test]
async fn stats_file_skips_unchanged_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stats.txt");
    let reader = StatsReader::default();
    let source = StatsSource::File(path.clone());
    assert_eq!(reader.read("i", &source).await.unwrap(), None, "no file yet");

    std::fs::write(&path, STATS).unwrap();
    let first = reader.read("i", &source).await.unwrap().unwrap();
    assert_eq!(first[0].value, 42.0);
    assert_eq!(reader.read("i", &source).await.unwrap(), None, "unchanged mtime");

    let later = std::time::SystemTime::now() + Duration::from_secs(10);
    std::fs::write(&path, STATS.replace("42", "43")).unwrap();
    std::fs::File::options().write(true).open(&path).unwrap().set_modified(later).unwrap();
    assert_eq!(reader.read("i", &source).await.unwrap().unwrap()[0].value, 43.0);
}

#[tokio::test]
async fn stats_http_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = s.read(&mut buf).await.unwrap();
        s.write_all(format!("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\n{STATS}").as_bytes()).await.unwrap();
    });
    let reader = StatsReader::default();
    let got = reader.read("i", &StatsSource::Http { address: "127.0.0.1".into(), port }).await.unwrap().unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].labels["label"], "Tower");
}

#[tokio::test]
async fn mock_units_track_state() {
    let units = MockUnits::default();
    let unit = "rtl_151.service";
    assert_eq!(units.status(unit).await.unwrap().active_state, ActiveState::Unknown);
    units.restart(unit).await.unwrap();
    let running = units.status(unit).await.unwrap();
    assert_eq!(running.active_state, ActiveState::Active);
    let ts = running.active_enter_timestamp.clone().unwrap();
    assert!(ts.len() == 20 && ts.ends_with('Z') && ts.starts_with("20"), "ISO timestamp: {ts}");
    units.stop(unit).await.unwrap();
    let stopped = units.status(unit).await.unwrap();
    assert_eq!(stopped.active_state, ActiveState::Inactive);
    assert_eq!(stopped.active_enter_timestamp, running.active_enter_timestamp, "kept after stop");
    assert_eq!(units.calls(), [format!("restart {unit}"), format!("stop {unit}")]);

    let line = |m: &str| LogLine { timestamp: "t".into(), message: m.into(), level: None };
    units.seed_logs(unit, vec![line("a"), line("b"), line("c")]);
    let logs = units.logs(unit, 2).await.unwrap();
    assert_eq!(logs.iter().map(|l| l.message.as_str()).collect::<Vec<_>>(), ["b", "c"]);
    let mut follow = units.follow_logs(unit, 1).await.unwrap();
    assert_eq!(follow.recv().await.unwrap().message, "c");
}
