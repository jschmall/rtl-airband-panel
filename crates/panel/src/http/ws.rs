//! `/api/ws`: a push channel so clients can stop polling. The server sends
//! `{"type":"hello"}` on connect, `{"type":"health","data":{...}}` whenever
//! any unit's status changes (checked every few seconds), and
//! `{"type":"instance-changed","name":...}` after any mutation. A client
//! that sends `{"type":"subscribe","topic":"hardware"}` also gets
//! `{"type":"hardware","data":HardwareSnapshot}` every poll interval until it
//! sends `{"type":"unsubscribe","topic":"hardware"}` or disconnects. A client
//! that falls behind is disconnected, so it reconnects to fresh state
//! instead of acting on stale events.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use super::AppState;

pub async fn upgrade(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| client(socket, state))
}

/// Counts a client in `hardware_subscribers` while it's subscribed, and
/// takes it back out however the connection ends.
struct HardwareSubscription<'a> {
    count: &'a AtomicUsize,
    active: bool,
}

impl HardwareSubscription<'_> {
    fn set(&mut self, on: bool) {
        if on != self.active {
            if on {
                self.count.fetch_add(1, Ordering::Relaxed);
            } else {
                self.count.fetch_sub(1, Ordering::Relaxed);
            }
            self.active = on;
        }
    }
}

impl Drop for HardwareSubscription<'_> {
    fn drop(&mut self) {
        self.set(false);
    }
}

/// `Some(true)` / `Some(false)` for a hardware subscribe / unsubscribe message.
fn hardware_subscription_change(text: &str) -> Option<bool> {
    let msg: Value = serde_json::from_str(text).ok()?;
    if msg.get("topic")?.as_str()? != "hardware" {
        return None;
    }
    match msg.get("type")?.as_str()? {
        "subscribe" => Some(true),
        "unsubscribe" => Some(false),
        _ => None,
    }
}

async fn client(mut socket: WebSocket, state: AppState) {
    let mut events = state.events.subscribe();
    let mut hardware = HardwareSubscription { count: &state.hardware_subscribers, active: false };
    let hello = json!({ "type": "hello", "version": env!("CARGO_PKG_VERSION") });
    if socket.send(Message::Text(hello.to_string().into())).await.is_err() {
        return;
    }
    if let Ok(health) = state.service.all_health().await {
        let msg = json!({ "type": "health", "data": health });
        if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
            return;
        }
    }
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(v) if !hardware.active && v.get("type").and_then(Value::as_str) == Some("hardware") => {}
                Ok(v) => if socket.send(Message::Text(v.to_string().into())).await.is_err() { return },
                Err(RecvError::Lagged(_)) | Err(RecvError::Closed) => {
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(Message::Text(text))) => {
                    if let Some(on) = hardware_subscription_change(&text) {
                        let newly = on && !hardware.active;
                        hardware.set(on);
                        // Don't make a new subscriber wait a whole interval for its first frame.
                        if newly
                            && let Ok(snapshot) = state.hardware.snapshot().await
                        {
                            let msg = json!({ "type": "hardware", "data": snapshot });
                            if socket.send(Message::Text(msg.to_string().into())).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                Some(Ok(_)) => {}
            },
        }
    }
}

/// Broadcasts unit status snapshots whenever they change.
pub async fn health_watcher(state: AppState, interval: Duration) {
    let mut last: Option<Value> = None;
    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;
        if state.events.receiver_count() == 0 {
            last = None;
            continue;
        }
        let Ok(health) = state.service.all_health().await else { continue };
        let current = serde_json::to_value(&health).unwrap_or(Value::Null);
        if last.as_ref() != Some(&current) {
            let _ = state.events.send(json!({ "type": "health", "data": current }));
            last = Some(current);
        }
    }
}

/// Broadcasts a hardware snapshot every `interval` while any client is
/// subscribed to the "hardware" topic. With nobody subscribed it still takes
/// one every `background` (zero: never), which only feeds the recorded
/// history (see HardwareService::snapshot).
pub async fn hardware_watcher(state: AppState, interval: Duration, background: Duration) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last: Option<Instant> = None;
    loop {
        ticker.tick().await;
        let watched = state.hardware_subscribers.load(Ordering::Relaxed) > 0;
        if !watched && (background.is_zero() || last.is_some_and(|t| t.elapsed() < background)) {
            continue;
        }
        last = Some(Instant::now());
        match state.hardware.snapshot().await {
            Ok(snapshot) if watched => {
                let _ = state.events.send(json!({ "type": "hardware", "data": snapshot }));
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("hardware snapshot failed: {e}"),
        }
    }
}
