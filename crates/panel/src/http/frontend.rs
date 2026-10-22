//! Serves the built frontend: from --frontend-dist if given, else the copy
//! embedded in the binary at compile time. Unknown non-API GETs get
//! index.html so client-side routes survive a refresh.

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;
use serde_json::json;

use super::AppState;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../frontend/dist"]
#[allow_missing = true]
struct Embedded;

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, axum::Json(json!({ "error": "Not found" }))).into_response()
}

async fn load(state: &AppState, path: &str) -> Option<Vec<u8>> {
    if path.split('/').any(|seg| seg == ".." || seg.starts_with('.')) {
        return None;
    }
    match &state.frontend_dir {
        Some(dir) => tokio::fs::read(dir.join(path)).await.ok(),
        None => Embedded::get(path).map(|f| f.data.into_owned()),
    }
}

/// Whether any frontend build is available to serve.
pub fn embedded_available() -> bool {
    Embedded::get("index.html").is_some()
}

pub async fn serve(State(state): State<AppState>, req: Request) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD || req.uri().path().starts_with("/api/") {
        return not_found();
    }
    let path = req.uri().path().trim_start_matches('/');
    let (path, body) = match (path, load(&state, path).await) {
        ("", _) | (_, None) => match load(&state, "index.html").await {
            Some(index) => ("index.html", index),
            None => return not_found(),
        },
        (p, Some(body)) => (p, body),
    };
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut res = (StatusCode::OK, body).into_response();
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
    // Vite fingerprints everything under assets/; index.html must always be revalidated.
    let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}
