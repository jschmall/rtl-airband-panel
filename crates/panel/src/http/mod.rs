//! HTTP API. Same routes, JSON shapes, status codes and headers as
//! v0.4.110's backend/api (so the existing frontend works unchanged), plus:
//! `POST /api/instances/:name/plan`, a `plan` field on save results, and the
//! `/api/ws` push channel.

pub mod frontend;
pub mod middleware;
pub mod ws;

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router, middleware as mw};
use futures::stream::{self, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::error::ApiError;
use crate::service::{InstanceService, clamp_log_lines, decode_config};
use crate::stats::StatsService;
use crate::stats_db::HistoryQuery;
use crate::store::InstanceOptionsPatch;

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<InstanceService>,
    pub stats: Arc<StatsService>,
    pub auth: Option<Arc<(String, String)>>,
    pub bound_to_loopback: bool,
    /// Lowercased host names allowed besides loopback names (reverse proxies).
    pub allowed_hosts: Arc<Vec<String>>,
    pub limiter: Arc<middleware::RateLimiter>,
    pub events: broadcast::Sender<Value>,
    pub frontend_dir: Option<PathBuf>,
}

impl AppState {
    fn notify_changed(&self, name: &str) {
        let _ = self.events.send(json!({ "type": "instance-changed", "name": name }));
    }
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/instances", get(list_instances).post(create_instance))
        .route("/instances/export", get(export_all))
        .route("/instances/import", post(import_all))
        .route("/instances/health", get(all_health))
        .route("/instances/stats-summary", get(stats_summary))
        .route("/instances/restart-pending", post(restart_pending))
        .route("/instances/{name}", get(get_instance).put(update_instance).delete(delete_instance))
        .route("/instances/{name}/secrets", get(get_secrets))
        .route("/instances/{name}/health", get(instance_health))
        .route("/instances/{name}/logs", get(get_logs))
        .route("/instances/{name}/logs/stream", get(stream_logs))
        .route("/instances/{name}/validate", post(validate))
        .route("/instances/{name}/plan", post(plan))
        .route("/instances/{name}/apply-live", post(apply_live))
        .route("/instances/{name}/options", axum::routing::patch(update_options))
        .route("/instances/{name}/restart", post(restart))
        .route("/instances/{name}/rename", post(rename))
        .route("/instances/{name}/stats/latest", get(stats_latest))
        .route("/instances/{name}/stats/poll-status", get(stats_poll_status))
        .route("/instances/{name}/stats/history", get(stats_history))
        .route("/ws", get(ws::upgrade))
        .fallback(api_not_found);

    Router::new()
        .route("/metrics", get(metrics))
        .nest("/api", api)
        .fallback(frontend::serve)
        .route_layer(mw::from_fn_with_state(state.clone(), middleware::rate_limit))
        .layer(mw::from_fn_with_state(state.clone(), middleware::origin_guard))
        .layer(mw::from_fn_with_state(state.clone(), middleware::basic_auth))
        // Compresses text/JS/wasm responses (not the SSE log stream or WebSocket).
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(mw::from_fn(middleware::security_headers))
        .layer(mw::from_fn(middleware::request_id))
        .with_state(state)
}

async fn api_not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))).into_response()
}

type ApiResult<T> = Result<T, ApiError>;

/// Parses a JSON request body (a missing body reads as `null`).
fn json_body(bytes: &Bytes) -> ApiResult<Value> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Value::Null);
    }
    serde_json::from_slice(bytes).map_err(|e| ApiError::BadRequest(format!("Body is not valid JSON: {e}")))
}

/// Shape-checks a config body before anything else, like the TS routes did.
fn config_body(bytes: &Bytes) -> ApiResult<Value> {
    let body = json_body(bytes)?;
    decode_config(body.clone(), None)?;
    Ok(body)
}

fn if_match(headers: &HeaderMap) -> Option<String> {
    headers.get(header::IF_MATCH).and_then(|v| v.to_str().ok()).map(str::to_string)
}

fn audit(action: &str, instance: &str, outcome: Result<(), &ApiError>) {
    match outcome {
        Ok(()) => {
            tracing::info!(audit = true, action, instance, outcome = "success", "audit: {action} {instance} success")
        }
        Err(e) => {
            tracing::info!(audit = true, action, instance, outcome = "failure", error = %e, "audit: {action} {instance} failure")
        }
    }
}

fn audited<T>(action: &str, instance: &str, result: ApiResult<T>) -> ApiResult<T> {
    audit(action, instance, result.as_ref().map(|_| ()));
    result
}

async fn health(State(s): State<AppState>) -> Response {
    let mut checks = serde_json::Map::new();
    let instances_ok = s.service.configs.list().await;
    checks.insert("instancesDir".into(), json!(instances_ok.as_ref().map_or_else(|e| e.to_string(), |_| "ok".into())));
    let db_ok = s.stats.db.ping();
    checks.insert("statsDb".into(), json!(db_ok.as_ref().map_or_else(|e| e.to_string(), |_| "ok".into())));
    let ready = instances_ok.is_ok() && db_ok.is_ok();
    let status = if ready { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (status, Json(json!({ "status": if ready { "ok" } else { "degraded" }, "checks": checks }))).into_response()
}

async fn list_instances(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.list_instances().await?))
}

async fn export_all(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.export_all().await?))
}

async fn import_all(State(s): State<AppState>, body: Bytes) -> ApiResult<impl IntoResponse> {
    let results = s.service.import_all(json_body(&body)?).await?;
    let mut out = serde_json::Map::new();
    for (name, outcome) in results {
        let failed = matches!(outcome, crate::service::ImportOutcome::Failed { .. });
        tracing::info!(audit = true, action = "import", instance = %name, outcome = if failed { "failure" } else { "success" }, "audit: import {name}");
        s.notify_changed(&name);
        out.insert(name, serde_json::to_value(outcome).unwrap());
    }
    Ok(Json(Value::Object(out)))
}

async fn all_health(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.all_health().await?))
}

async fn get_instance(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<Response> {
    let (config, version) = s.service.get_config(&name).await?;
    let mut res = Json(config).into_response();
    if let Ok(v) = HeaderValue::from_str(&version) {
        res.headers_mut().insert(header::ETAG, v);
    }
    Ok(res)
}

async fn get_secrets(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    let config = s.service.get_secrets(&name).await?;
    audit("reveal-secrets", &name, Ok(()));
    Ok(Json(config))
}

async fn instance_health(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.health(&name).await?))
}

#[derive(Deserialize)]
struct LinesQuery {
    lines: Option<String>,
}

async fn get_logs(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<LinesQuery>,
) -> ApiResult<impl IntoResponse> {
    let lines = s.service.logs(&name, clamp_log_lines(q.lines.as_deref())).await?;
    audit("view-logs", &name, Ok(()));
    Ok(Json(json!({ "lines": lines })))
}

async fn stream_logs(State(s): State<AppState>, Path(name): Path<String>, Query(q): Query<LinesQuery>) -> Response {
    let follow = s.service.follow_logs(&name, clamp_log_lines(q.lines.as_deref())).await;
    audit("stream-logs", &name, follow.as_ref().map(|_| ()));
    let events: std::pin::Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> = match follow {
        Ok(rx) => Box::pin(
            tokio_stream::wrappers::ReceiverStream::new(rx)
                .map(|line| Ok(Event::default().data(serde_json::to_string(&line).unwrap()))),
        ),
        Err(e) => {
            // Named "stream-error" so it can't be confused with EventSource's own "error".
            let detail = match &e {
                ApiError::Command { message, exit_code, stderr } => {
                    json!({ "message": message, "exitCode": exit_code, "stderr": stderr })
                }
                other => json!({ "message": other.to_string() }),
            };
            Box::pin(stream::once(async move { Ok(Event::default().event("stream-error").data(detail.to_string())) }))
        }
    };
    let mut res =
        Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")).into_response();
    res.headers_mut().insert("x-accel-buffering", HeaderValue::from_static("no"));
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    res
}

async fn validate(State(s): State<AppState>, Path(name): Path<String>, body: Bytes) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.validate_only(&name, config_body(&body)?).await?))
}

async fn plan(State(s): State<AppState>, Path(name): Path<String>, body: Bytes) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.service.plan(&name, config_body(&body)?).await?))
}

#[derive(Deserialize)]
struct RestartQuery {
    restart: Option<String>,
}

async fn update_instance(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<RestartQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let body = config_body(&body)?;
    let restart = q.restart.as_deref() != Some("false");
    let result = audited(
        "update-config",
        &name,
        s.service.update_config(&name, body, restart, if_match(&headers).as_deref()).await,
    );
    s.notify_changed(&name);
    Ok(Json(result?))
}

async fn apply_live(
    State(s): State<AppState>,
    Path(name): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let body = config_body(&body)?;
    let result = audited("apply-live", &name, s.service.apply_live(&name, body, if_match(&headers).as_deref()).await);
    s.notify_changed(&name);
    Ok(Json(result?))
}

fn options_patch(body: &Value) -> ApiResult<InstanceOptionsPatch> {
    let obj = body.as_object().ok_or_else(|| ApiError::BadRequest("Expected an object (at $)".into()))?;
    let mut patch = InstanceOptionsPatch::default();
    match obj.get("jsonLogging") {
        None | Some(Value::Null) => {}
        Some(Value::Bool(b)) => patch.json_logging = Some(*b),
        Some(_) => return Err(ApiError::BadRequest("Expected 'jsonLogging' to be a boolean (at $)".into())),
    }
    for (key, slot) in [("serviceUser", &mut patch.service_user), ("serviceGroup", &mut patch.service_group)] {
        match obj.get(key) {
            None | Some(Value::Null) => {}
            // An empty string clears a previously-set account.
            Some(Value::String(v)) => *slot = Some(Some(v.clone()).filter(|v| !v.is_empty())),
            Some(_) => return Err(ApiError::BadRequest(format!("Expected '{key}' to be a string (at $)"))),
        }
    }
    Ok(patch)
}

async fn update_options(
    State(s): State<AppState>,
    Path(name): Path<String>,
    body: Bytes,
) -> ApiResult<impl IntoResponse> {
    let patch = options_patch(&json_body(&body)?)?;
    let result = audited("update-options", &name, s.service.update_options(&name, patch, true).await);
    s.notify_changed(&name);
    Ok(Json(result?))
}

async fn restart(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    let result = audited("restart", &name, s.service.restart_instance(&name).await);
    s.notify_changed(&name);
    Ok(Json(result?))
}

async fn restart_pending(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    let results = s.service.restart_all_pending().await?;
    for (name, r) in &results {
        let outcome = if r.get("error").is_some() { "failure" } else { "success" };
        tracing::info!(audit = true, action = "restart", instance = %name, bulk = true, outcome, "audit: restart {name} {outcome}");
        s.notify_changed(name);
    }
    Ok(Json(results))
}

async fn rename(State(s): State<AppState>, Path(name): Path<String>, body: Bytes) -> ApiResult<impl IntoResponse> {
    let body = json_body(&body)?;
    let obj = body.as_object().ok_or_else(|| ApiError::BadRequest("Expected an object (at $)".into()))?;
    let new_name = obj
        .get("newName")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Expected 'newName' to be a string (at $)".into()))?
        .to_string();
    let result = audited("rename", &name, s.service.rename_instance(&name, &new_name).await);
    s.notify_changed(&name);
    s.notify_changed(&new_name);
    Ok(Json(result?))
}

async fn create_instance(State(s): State<AppState>, body: Bytes) -> ApiResult<impl IntoResponse> {
    let body = json_body(&body)?;
    let obj = body.as_object().ok_or_else(|| ApiError::BadRequest("Expected an object (at $)".into()))?;
    let name = obj
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("Expected 'name' to be a string (at $)".into()))?
        .to_string();
    let config = obj.get("config").cloned().unwrap_or(Value::Null);
    decode_config(config.clone(), None)?;
    let result = audited("create", &name, s.service.create_instance(&name, config).await);
    s.notify_changed(&name);
    Ok(Json(result?))
}

async fn delete_instance(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    audited("delete", &name, s.service.delete_instance(&name).await)?;
    s.notify_changed(&name);
    Ok(StatusCode::NO_CONTENT)
}

async fn instance_names(s: &AppState) -> ApiResult<Vec<String>> {
    Ok(s.service.configs.list().await?.into_iter().map(|i| i.name).collect())
}

async fn require_instance(s: &AppState, name: &str) -> ApiResult<()> {
    airband_supervisor::instance::validate_instance_name(name)?;
    if !s.service.configs.exists(name).await {
        return Err(ApiError::NotFound(name.to_string()));
    }
    Ok(())
}

async fn stats_summary(State(s): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(s.stats.summaries(&instance_names(&s).await?)?))
}

async fn stats_latest(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    require_instance(&s, &name).await?;
    Ok(Json(s.stats.latest(&name)?))
}

async fn stats_poll_status(State(s): State<AppState>, Path(name): Path<String>) -> ApiResult<impl IntoResponse> {
    require_instance(&s, &name).await?;
    Ok(Json(s.stats.poll_status.get(&name)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryParams {
    metric: Option<String>,
    labels: Option<String>,
    since_ms: Option<String>,
    until_ms: Option<String>,
}

async fn stats_history(
    State(s): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<HistoryParams>,
) -> ApiResult<impl IntoResponse> {
    let metric = q
        .metric
        .filter(|m| !m.is_empty())
        .ok_or_else(|| ApiError::BadRequest("Expected 'metric' query parameter (at $.query)".into()))?;
    let labels: BTreeMap<String, String> = match q.labels {
        None => BTreeMap::new(),
        Some(l) => serde_json::from_str(&l).map_err(|_| {
            ApiError::BadRequest("Expected 'labels' query parameter to be valid JSON (at $.query)".into())
        })?,
    };
    let num = |v: Option<String>| v.and_then(|t| t.parse::<f64>().ok()).map(|n| n as i64);
    require_instance(&s, &name).await?;
    let query = HistoryQuery { metric, labels, since_ms: num(q.since_ms), until_ms: num(q.until_ms) };
    Ok(Json(s.stats.history(&name, &query)?))
}

async fn metrics(State(s): State<AppState>) -> ApiResult<Response> {
    let text = s.stats.metrics_text(&instance_names(&s).await?)?;
    Ok(([(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")], text).into_response())
}
