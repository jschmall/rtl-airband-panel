//! `/api/ws`: a push channel so clients can stop polling. The server sends
//! `{"type":"hello"}` on connect, `{"type":"health","data":{...}}` whenever
//! any unit's status changes (checked every few seconds), and
//! `{"type":"instance-changed","name":...}` after any mutation. A client
//! that falls behind is disconnected, so it reconnects to fresh state
//! instead of acting on stale events.

use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use super::AppState;

pub async fn upgrade(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| client(socket, state))
}

async fn client(mut socket: WebSocket, state: AppState) {
    let mut events = state.events.subscribe();
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
                Ok(v) => if socket.send(Message::Text(v.to_string().into())).await.is_err() { return },
                Err(RecvError::Lagged(_)) | Err(RecvError::Closed) => {
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
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
