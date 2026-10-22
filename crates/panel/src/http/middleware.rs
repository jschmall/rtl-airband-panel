//! Cross-cutting request handling: request ids, security headers, HTTP
//! Basic auth, Origin/Host checks, and rate limits.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, MatchedPath, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use serde_json::json;

use super::AppState;

/// Every response carries an id that also tags the request's log lines.
pub async fn request_id(req: Request, next: Next) -> Response {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = format!("req-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed) + 1);
    let mut res = next.run(req).await;
    res.headers_mut().insert("x-request-id", HeaderValue::from_str(&id).unwrap());
    res
}

/// helmet's defaults, minus HSTS and upgrade-insecure-requests: the panel is
/// usually served over plain HTTP on a LAN, where those break it.
const SECURITY_HEADERS: [(&str, &str); 11] = [
    (
        "content-security-policy",
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self' 'wasm-unsafe-eval';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';connect-src 'self'",
    ),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-resource-policy", "same-origin"),
    ("origin-agent-cluster", "?1"),
    ("referrer-policy", "no-referrer"),
    ("x-content-type-options", "nosniff"),
    ("x-dns-prefetch-control", "off"),
    ("x-download-options", "noopen"),
    ("x-frame-options", "SAMEORIGIN"),
    ("x-permitted-cross-domain-policies", "none"),
    ("x-xss-protection", "0"),
];

pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    for (name, value) in SECURITY_HEADERS {
        res.headers_mut().entry(name).or_insert(HeaderValue::from_static(value));
    }
    res
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, axum::Json(json!({ "error": message }))).into_response()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// HTTP Basic auth when a password is configured. Browsers prompt once and
/// then send it with every fetch/EventSource/WebSocket on the same origin.
/// `/api/health` stays open for monitors.
pub async fn basic_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let Some(creds) = state.auth.as_ref() else { return next.run(req).await };
    let (user, password) = (&creds.0, &creds.1);
    if req.uri().path() == "/api/health" {
        return next.run(req).await;
    }
    let supplied = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b.trim()).ok())
        .and_then(|b| String::from_utf8(b).ok());
    let ok = supplied.as_deref().and_then(|s| s.split_once(':')).is_some_and(|(u, p)| {
        constant_time_eq(u.as_bytes(), user.as_bytes()) & constant_time_eq(p.as_bytes(), password.as_bytes())
    });
    if ok {
        return next.run(req).await;
    }
    let mut res = error(StatusCode::UNAUTHORIZED, "Authentication required");
    res.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"rtl-airband-panel\", charset=\"UTF-8\""),
    );
    res
}

fn host_only(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        return rest.split(']').next().unwrap_or(rest);
    }
    authority.rsplit_once(':').map_or(authority, |(h, _)| h)
}

fn is_loopback_name(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Refuses cross-site requests that change state (and WebSocket upgrades,
/// which browsers don't restrict by origin), plus DNS-rebinding attempts
/// against a loopback-bound panel.
pub async fn origin_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    if state.bound_to_loopback && !host.is_empty() {
        let name = host_only(host);
        if !is_loopback_name(name) && !state.allowed_hosts.iter().any(|h| h.eq_ignore_ascii_case(name)) {
            return error(
                StatusCode::FORBIDDEN,
                "Host not allowed (add it to RTL_PANEL_ALLOWED_HOSTS if this is your reverse proxy)",
            );
        }
    }
    let changes_state = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let is_upgrade = headers.get(header::UPGRADE).is_some();
    if (changes_state || is_upgrade) && !same_origin(headers, host) {
        return error(StatusCode::FORBIDDEN, "Cross-origin request refused");
    }
    next.run(req).await
}

fn same_origin(headers: &HeaderMap, host: &str) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true; // not a browser cross-site request (curl, same-origin GET-less clients)
    };
    origin.split_once("://").map(|(_, authority)| authority) == Some(host)
}

/// Fixed one-minute windows per client IP: a generous global budget, and a
/// tight per-route budget for actions that write configs or touch systemd.
#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<(IpAddr, String), (Instant, u32)>>,
}

const WINDOW: Duration = Duration::from_secs(60);
const GLOBAL_MAX: u32 = 300;
const MUTATING_MAX: u32 = 60;

impl RateLimiter {
    fn hit(&self, ip: IpAddr, key: String, max: u32) -> bool {
        let mut w = self.windows.lock().unwrap();
        if w.len() > 10_000 {
            w.retain(|_, (start, _)| start.elapsed() < WINDOW);
        }
        let entry = w.entry((ip, key)).or_insert((Instant::now(), 0));
        if entry.0.elapsed() >= WINDOW {
            *entry = (Instant::now(), 0);
        }
        entry.1 += 1;
        entry.1 <= max
    }
}

pub async fn rate_limit(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let ip = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
    if let Some(ip) = ip {
        let route = req.extensions().get::<MatchedPath>().map(|p| p.as_str().to_string());
        let mutating = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
        let allowed = state.limiter.hit(ip, "*".into(), GLOBAL_MAX)
            && (!mutating
                || state.limiter.hit(ip, format!("{} {}", req.method(), route.unwrap_or_default()), MUTATING_MAX));
        if !allowed {
            return error(StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded, retry in 1 minute");
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_parsing() {
        assert_eq!(host_only("localhost:3000"), "localhost");
        assert_eq!(host_only("[::1]:3000"), "::1");
        assert_eq!(host_only("10.0.0.5"), "10.0.0.5");
        assert!(is_loopback_name("127.0.0.1"));
        assert!(is_loopback_name("LOCALHOST"));
        assert!(!is_loopback_name("evil.example"));
    }

    #[test]
    fn origin_matching() {
        let mut h = HeaderMap::new();
        assert!(same_origin(&h, "localhost:3000"));
        h.insert(header::ORIGIN, HeaderValue::from_static("http://localhost:3000"));
        assert!(same_origin(&h, "localhost:3000"));
        h.insert(header::ORIGIN, HeaderValue::from_static("http://evil.example"));
        assert!(!same_origin(&h, "localhost:3000"));
    }

    #[test]
    fn limiter_windows() {
        let l = RateLimiter::default();
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        for _ in 0..3 {
            assert!(l.hit(ip, "k".into(), 3));
        }
        assert!(!l.hit(ip, "k".into(), 3));
        assert!(l.hit(ip, "other".into(), 3));
    }
}
