use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub severity: Severity,
    /// Machine-readable identifier for the specific check that produced this issue.
    pub code: String,
    pub message: String,
    /// JSON-pointer-ish path into the config, e.g. `$.devices[0].channels[3]`.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ValidationResult {
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Collects issues in check order.
#[derive(Default)]
pub(crate) struct Issues(pub Vec<ValidationIssue>);

impl Issues {
    pub fn error(&mut self, code: &str, path: impl Into<String>, message: impl Into<String>) {
        self.push(Severity::Error, code, path, message);
    }

    pub fn warning(&mut self, code: &str, path: impl Into<String>, message: impl Into<String>) {
        self.push(Severity::Warning, code, path, message);
    }

    fn push(&mut self, severity: Severity, code: &str, path: impl Into<String>, message: impl Into<String>) {
        self.0.push(ValidationIssue { severity, code: code.to_string(), message: message.into(), path: path.into() });
    }
}
