//! Behavior with no TS counterpart: auth, origin/host checks, live-apply
//! planning and the corrected pending-restart rule. (Route-by-route parity
//! with the TS API is checked by scripts/api-parity.mjs.)

use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use base64::Engine;
use clap::Parser;
use http_body_util::BodyExt;
use panel::settings::Settings;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tower::ServiceExt;

const CONF: &str = r#"multiple_demod_threads = true;
multiple_output_threads = true;
stats_filepath = "/tmp/never-written.txt";
localtime = true;
control_socket_path = "SOCKET";
devices: (
  { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 151000000; reserve_channels = 1;
    channels: (
      { freq = 151100000; outputs: ( { type = "pulse"; } ); },
      { freq = 151200000; outputs: ( { type = "pulse"; } ); }
    ); }
);
"#;

struct Harness {
    _dir: tempfile::TempDir,
    router: axum::Router,
    socket: std::path::PathBuf,
}

fn harness(extra_args: &[&str]) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let instances = dir.path().join("instances");
    std::fs::create_dir_all(&instances).unwrap();
    let socket = dir.path().join("ctl.sock");
    std::fs::write(instances.join("alpha.conf"), CONF.replace("SOCKET", socket.to_str().unwrap())).unwrap();
    let mut args = vec![
        "rtl-airband-panel".to_string(),
        "--instances-dir".into(),
        instances.display().to_string(),
        "--stats-db-path".into(),
        dir.path().join("stats.db").display().to_string(),
    ];
    args.extend(extra_args.iter().map(|s| s.to_string()));
    let settings = Settings::parse_from(args);
    let app = panel::build(&settings, Arc::new(airband_supervisor::MockUnits::default())).unwrap();
    Harness { _dir: dir, router: app.router, socket }
}

async fn send(router: &axum::Router, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Value) {
    let res = router.clone().oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, headers, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).header(header::HOST, "localhost:3000").body(Body::empty()).unwrap()
}

fn json_req(method: &str, uri: &str, body: &Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "localhost:3000")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// A fake rtl_airband control socket answering every request with `reply`.
fn fake_socket(path: &Path, reply: &'static str) -> tokio::task::JoinHandle<()> {
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path).unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (read, mut write) = stream.into_split();
            let mut line = String::new();
            let _ = BufReader::new(read).read_line(&mut line).await;
            let _ = write.write_all(reply.as_bytes()).await;
        }
    })
}

#[tokio::test]
async fn basic_auth_when_a_password_is_set() {
    let h = harness(&["--password", "s3cret"]);
    let (status, headers, _) = send(&h.router, get("/api/instances")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(headers.get(header::WWW_AUTHENTICATE).unwrap().to_str().unwrap().starts_with("Basic"));

    let token = base64::engine::general_purpose::STANDARD.encode("admin:s3cret");
    let req = Request::get("/api/instances")
        .header(header::HOST, "localhost:3000")
        .header(header::AUTHORIZATION, format!("Basic {token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&h.router, req).await.0, StatusCode::OK);

    let wrong = base64::engine::general_purpose::STANDARD.encode("admin:nope");
    let req = Request::get("/api/instances")
        .header(header::AUTHORIZATION, format!("Basic {wrong}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&h.router, req).await.0, StatusCode::UNAUTHORIZED);

    // Monitors can still check health.
    assert_eq!(send(&h.router, get("/api/health")).await.0, StatusCode::OK);
}

#[tokio::test]
async fn cross_origin_writes_and_rebinding_hosts_are_refused() {
    let h = harness(&[]);
    let req = Request::post("/api/instances/alpha/restart")
        .header(header::HOST, "localhost:3000")
        .header(header::ORIGIN, "http://evil.example")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&h.router, req).await.0, StatusCode::FORBIDDEN);

    let req = Request::post("/api/instances/alpha/restart")
        .header(header::HOST, "localhost:3000")
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&h.router, req).await.0, StatusCode::OK);

    // DNS rebinding: a loopback-bound panel only answers loopback Host names.
    let req = Request::get("/api/instances").header(header::HOST, "attacker.example:3000").body(Body::empty()).unwrap();
    assert_eq!(send(&h.router, req).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn security_headers_and_request_ids() {
    let h = harness(&[]);
    let (_, headers, _) = send(&h.router, get("/api/instances")).await;
    assert_eq!(headers.get("x-frame-options").unwrap(), "SAMEORIGIN");
    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert!(headers.get("x-request-id").unwrap().to_str().unwrap().starts_with("req-"));
}

#[tokio::test]
async fn plan_endpoint_predicts_without_writing() {
    let h = harness(&[]);
    let (_, headers, config) = send(&h.router, get("/api/instances/alpha")).await;
    let etag = headers.get(header::ETAG).unwrap().clone();

    let mut edit = config.clone();
    edit["devices"][0]["gain"] = json!(31);
    let (status, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &edit)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan["method"], "live");
    assert_eq!(plan["live"], json!(["device[0]: gain -> 31"]));
    assert_eq!(plan["baselineKnown"], false, "the panel never started this instance");

    let mut edit = config.clone();
    edit["localtime"] = json!(false);
    let (_, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &edit)).await;
    assert_eq!(plan["method"], "restart");
    assert_eq!(plan["restart"], json!(["localtime changed"]));

    let (_, headers, _) = send(&h.router, get("/api/instances/alpha")).await;
    assert_eq!(headers.get(header::ETAG).unwrap(), &etag, "nothing written");
}

#[tokio::test]
async fn live_apply_clears_pending_only_when_nothing_needs_a_restart() {
    let h = harness(&[]);
    let _sock = fake_socket(
        &h.socket,
        "{\"ok\":true,\"applied\":[\"device[0]: gain -> 31\"],\"skipped_requires_restart\":[]}\n",
    );
    let (_, _, config) = send(&h.router, get("/api/instances/alpha")).await;

    // In scope: reload_diff applies it, pending clears.
    let mut edit = config.clone();
    edit["devices"][0]["gain"] = json!(31);
    let (status, _, result) = send(&h.router, json_req("POST", "/api/instances/alpha/apply-live", &edit)).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["liveApply"]["attempted"], true);
    assert_eq!(result["plan"]["method"], "live");
    let (_, _, list) = send(&h.router, get("/api/instances")).await;
    assert_eq!(list[0]["pendingRestart"], false);

    // Out of scope: reload_diff (silently) reports nothing to restart, but
    // the change never reached the process, so pending must stay set.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await; // live-apply cooldown
    let mut edit2 = edit.clone();
    edit2["localtime"] = json!(false);
    let (_, _, result) = send(&h.router, json_req("POST", "/api/instances/alpha/apply-live", &edit2)).await;
    assert_eq!(result["liveApply"]["attempted"], true);
    assert_eq!(result["liveApply"]["skippedRequiresRestart"], json!([]));
    assert_eq!(result["plan"]["restart"], json!(["localtime changed"]));
    let (_, _, list) = send(&h.router, get("/api/instances")).await;
    assert_eq!(list[0]["pendingRestart"], true);

    // A restart brings the process up to date and records the new baseline.
    let restart = Request::post("/api/instances/alpha/restart")
        .header(header::HOST, "localhost:3000")
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&h.router, restart).await.0, StatusCode::OK);
    let (_, _, list) = send(&h.router, get("/api/instances")).await;
    assert_eq!(list[0]["pendingRestart"], false);
    let (_, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &edit2)).await;
    assert_eq!(plan["method"], "no_change");
    assert_eq!(plan["baselineKnown"], true);
}

#[tokio::test]
async fn reserve_channels_capacity_comes_from_the_start_baseline() {
    let h = harness(&[]);
    let _sock = fake_socket(&h.socket, "{\"ok\":true,\"applied\":[\"added\"],\"skipped_requires_restart\":[]}\n");
    let restart = Request::post("/api/instances/alpha/restart")
        .header(header::HOST, "localhost:3000")
        .body(Body::empty())
        .unwrap();
    send(&h.router, restart).await;

    let (_, _, config) = send(&h.router, get("/api/instances/alpha")).await;
    let channel = |freq: u64| json!({ "freq": freq, "outputs": [{ "type": "pulse" }] });
    let mut three = config.clone();
    three["devices"][0]["channels"].as_array_mut().unwrap().push(channel(151_300_000));
    let (_, _, r) = send(&h.router, json_req("POST", "/api/instances/alpha/apply-live", &three)).await;
    assert_eq!(r["plan"]["method"], "live", "{r}");

    // The one reserve slot is used up; a fourth channel needs a restart.
    let mut four = three.clone();
    four["devices"][0]["channels"].as_array_mut().unwrap().push(channel(151_400_000));
    let (_, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &four)).await;
    assert_eq!(plan["method"], "restart", "{plan}");
}

#[tokio::test]
async fn unknown_settings_round_trip_through_the_api() {
    let h = harness(&[]);
    let (_, _, mut config) = send(&h.router, get("/api/instances/alpha")).await;
    config["unknown_settings"] = json!([{ "name": "future_key", "value": { "kind": "scalar", "type": "int", "value": 3, "raw": "3" }, "assign_op": "=" }]);
    let (status, _, r) = send(&h.router, json_req("PUT", "/api/instances/alpha?restart=false", &config)).await;
    assert_eq!(status, StatusCode::OK, "{r}");
    assert!(r["warnings"].as_array().unwrap().iter().any(|w| w["code"] == "unknown-setting-preserved"));
    let (_, _, back) = send(&h.router, get("/api/instances/alpha")).await;
    assert_eq!(back["unknown_settings"][0]["name"], "future_key");
}

#[tokio::test]
async fn websocket_pushes_hello_health_and_changes() {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let h = harness(&[]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = h.router.clone();
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>()).await
    });

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://localhost:{}/api/ws", addr.port())).await.unwrap();
    let mut next_json = async || -> Value {
        loop {
            if let Some(Ok(Message::Text(t))) = ws.next().await {
                return serde_json::from_str(&t).unwrap();
            }
        }
    };
    assert_eq!(next_json().await["type"], "hello");
    let health = next_json().await;
    assert_eq!(health["type"], "health");
    assert_eq!(health["data"]["alpha"]["unit"], "alpha.service");

    let restart = Request::post("/api/instances/alpha/restart")
        .header(header::HOST, "localhost:3000")
        .body(Body::empty())
        .unwrap();
    send(&h.router, restart).await;
    let changed = next_json().await;
    assert_eq!(changed, json!({ "type": "instance-changed", "name": "alpha" }));
    let _ = ws.send(Message::Close(None)).await;
}

#[tokio::test]
async fn first_save_records_the_replaced_file_as_running() {
    // The panel never started this instance; saving without a restart must
    // still preview the saved change as not running yet.
    let h = harness(&[]);
    let (_, _, config) = send(&h.router, get("/api/instances/alpha")).await;
    let mut edit = config.clone();
    edit["devices"][0]["gain"] = json!(31);
    let (status, _, saved) = send(&h.router, json_req("PUT", "/api/instances/alpha?restart=false", &edit)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["plan"]["method"], "live", "{saved}");
    let (_, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &edit)).await;
    assert_eq!(plan["live"], json!(["device[0]: gain -> 31"]));
    assert_eq!(plan["baselineKnown"], true);

    // A second save while pending must not move that baseline.
    let mut edit2 = edit.clone();
    edit2["devices"][0]["gain"] = json!(33);
    send(&h.router, json_req("PUT", "/api/instances/alpha?restart=false", &edit2)).await;
    let (_, _, plan) = send(&h.router, json_req("POST", "/api/instances/alpha/plan", &edit2)).await;
    assert_eq!(plan["live"], json!(["device[0]: gain -> 33"]));
}

#[tokio::test]
async fn instance_list_reports_active_frequencies() {
    let h = harness(&[]);
    let (_, _, list) = send(&h.router, get("/api/instances")).await;
    assert_eq!(list[0]["frequencies"], json!([151100000.0, 151200000.0]));
}

#[tokio::test]
async fn reverse_proxy_host_can_be_allowed() {
    // Behind a proxy that passes `Host: panel.example.com` through, with the
    // panel itself still bound to loopback.
    let request = |host: &'static str, origin: &'static str| {
        Request::post("/api/instances/alpha/restart")
            .header(header::HOST, host)
            .header(header::ORIGIN, origin)
            .body(Body::empty())
            .unwrap()
    };
    let h = harness(&[]);
    assert_eq!(
        send(&h.router, request("panel.example.com", "https://panel.example.com")).await.0,
        StatusCode::FORBIDDEN
    );

    let h = harness(&["--allowed-hosts", "Panel.Example.com,other.lan"]);
    assert_eq!(send(&h.router, request("panel.example.com", "https://panel.example.com")).await.0, StatusCode::OK);
    assert_eq!(
        send(&h.router, request("panel.example.com:443", "https://panel.example.com:443")).await.0,
        StatusCode::OK
    );
    // A cross-site page is still refused even with an allowed Host.
    assert_eq!(send(&h.router, request("panel.example.com", "https://evil.example")).await.0, StatusCode::FORBIDDEN);
    assert_eq!(send(&h.router, request("unlisted.example", "https://unlisted.example")).await.0, StatusCode::FORBIDDEN);
}
