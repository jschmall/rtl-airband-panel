//! libconfig `.conf` <-> JSON domain model for RTLSDR-Airband instance
//! configs. Rust port of backend/parser.

pub mod ast;
pub mod domain;
pub mod error;
pub mod jsnum;
pub mod mapper;
pub mod parser;
pub mod serializer;
pub mod tokenizer;

pub use ast::ConfigFile;
pub use domain::RtlAirbandConfig;
pub use error::ConfigError;
pub use mapper::{from_domain, to_domain};
pub use parser::parse_config;
pub use serializer::serialize_config;

/// Reads an RTLSDR-Airband .conf file's text and produces the JSON domain model.
pub fn parse_config_file(source: &str) -> Result<RtlAirbandConfig, ConfigError> {
    to_domain(&parse_config(source)?)
}

/// Serializes the JSON domain model back into .conf file text.
pub fn serialize_config_file(config: &RtlAirbandConfig) -> String {
    serialize_config(&from_domain(config))
}
