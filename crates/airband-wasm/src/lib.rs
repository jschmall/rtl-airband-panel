//! Browser entry points. Build with scripts/build-wasm.sh, which writes the
//! JS glue and .wasm into frontend/src/generated/wasm.

use airband_config::RtlAirbandConfig;
use airband_validate::{Severity, ValidationIssue, ValidationResult, validate_config};
use wasm_bindgen::prelude::*;

/// Validates a config given as JSON (the same body the API accepts) and
/// returns `{ errors, warnings }` as JSON, exactly as `POST .../validate`
/// would. A body that doesn't fit the config shape comes back as a single
/// error rather than throwing.
#[wasm_bindgen]
pub fn validate(config_json: &str) -> String {
    let result = match parse(config_json) {
        Ok(config) => validate_config(&config),
        Err(message) => ValidationResult {
            errors: vec![ValidationIssue {
                severity: Severity::Error,
                code: "invalid-shape".into(),
                message,
                path: "$".into(),
            }],
            warnings: vec![],
        },
    };
    serde_json::to_string(&result).expect("validation result serializes")
}

/// Strips frontend-only `_matchIndex` hints before decoding (the server
/// does the same after using them to restore secrets).
fn parse(config_json: &str) -> Result<RtlAirbandConfig, String> {
    let mut value: serde_json::Value = serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    strip_match_index(&mut value);
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn strip_match_index(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            map.remove("_matchIndex");
            map.values_mut().for_each(strip_match_index);
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(strip_match_index),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_like_the_server() {
        let source =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/151719.conf")).unwrap();
        let config = airband_config::parse_config_file(&source).unwrap();
        let mut json = serde_json::to_value(&config).unwrap();
        json["fft_size"] = serde_json::json!(1000);
        json["devices"][0]["channels"][0]["outputs"][0]["_matchIndex"] = serde_json::json!(0);
        let out: ValidationResult = serde_json::from_str(&validate(&json.to_string())).unwrap();
        assert!(out.errors.iter().any(|e| e.code == "fft-size-invalid"));
    }

    #[test]
    fn shape_errors_are_reported_not_thrown() {
        let out: ValidationResult = serde_json::from_str(&validate("{\"devices\": 3}")).unwrap();
        assert_eq!(out.errors[0].code, "invalid-shape");
    }
}
