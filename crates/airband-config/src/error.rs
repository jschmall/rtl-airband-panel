use thiserror::Error;

/// Errors from reading a config. Message text matches the TypeScript
/// implementation (backend/parser) so API responses stay the same.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    /// Tokenizer-level error (`LibconfigSyntaxError` in TS).
    #[error("{message} (line {line}, col {col})")]
    Syntax { message: String, line: usize, col: usize },

    /// Grammar-level error (`LibconfigParseError` in TS).
    #[error("{message} (line {line}, col {col}, near '{near}')")]
    Parse { message: String, line: usize, col: usize, near: String },

    /// The syntax is valid libconfig but does not fit the RTLSDR-Airband
    /// domain model (`DomainMappingError` in TS).
    #[error("{message} (at {path})")]
    Domain { message: String, path: String },
}

impl ConfigError {
    pub(crate) fn domain(message: impl Into<String>, path: impl Into<String>) -> ConfigError {
        ConfigError::Domain { message: message.into(), path: path.into() }
    }
}
