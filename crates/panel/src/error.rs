//! Service errors and their HTTP mapping (port of backend/api's
//! error-handler.ts): 404 not found, 409 exists/conflict, 422 validation,
//! 400 bad request, 502 failed systemd/sudo command, 500 otherwise.

use airband_supervisor::command::CommandError;
use airband_supervisor::systemd::UnitError;
use airband_validate::ValidationIssue;
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("No instance named '{0}'")]
    NotFound(String),
    #[error("An instance named '{0}' already exists")]
    AlreadyExists(String),
    #[error(
        "'{0}' was changed on disk since this copy was loaded — reload it and re-apply your edits before saving again"
    )]
    Conflict(String),
    #[error("Config validation failed: {}", .0.iter().map(|e| e.message.as_str()).collect::<Vec<_>>().join("; "))]
    Validation(Vec<ValidationIssue>),
    #[error("{0}")]
    BadRequest(String),
    #[error("{message}")]
    Command { message: String, exit_code: Option<i32>, stderr: String },
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Internal(String),
}

impl From<StoreError> for ApiError {
    fn from(e: StoreError) -> Self {
        ApiError::Internal(e.to_string())
    }
}

impl From<airband_supervisor::instance::InvalidInstanceName> for ApiError {
    fn from(e: airband_supervisor::instance::InvalidInstanceName) -> Self {
        ApiError::BadRequest(e.to_string())
    }
}

impl From<UnitError> for ApiError {
    fn from(e: UnitError) -> Self {
        match e {
            UnitError::Command(CommandError::Failed { command, args, exit_code, stderr }) => ApiError::Command {
                // Same text the TS CommandError produced (JS prints a missing exit code as null).
                message: format!(
                    "Command failed (exit {}): {command} {}\n{stderr}",
                    exit_code.map_or("null".to_string(), |c| c.to_string()),
                    args.join(" ")
                ),
                exit_code,
                stderr,
            },
            other => ApiError::Internal(other.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let (status, body) = match self {
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, json!({ "error": message })),
            ApiError::AlreadyExists(_) | ApiError::Conflict(_) => (StatusCode::CONFLICT, json!({ "error": message })),
            ApiError::Validation(errors) => {
                (StatusCode::UNPROCESSABLE_ENTITY, json!({ "error": message, "errors": errors }))
            }
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, json!({ "error": message })),
            ApiError::Forbidden(_) => (StatusCode::FORBIDDEN, json!({ "error": message })),
            ApiError::Command { exit_code, stderr, .. } => {
                tracing::warn!(error = %message, "systemd command failed");
                (StatusCode::BAD_GATEWAY, json!({ "error": message, "exitCode": exit_code, "stderr": stderr }))
            }
            ApiError::Internal(detail) => {
                tracing::error!(error = %detail, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "Internal server error" }))
            }
        };
        (status, Json(body)).into_response()
    }
}
