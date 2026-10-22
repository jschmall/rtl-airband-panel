//! Parity with the original TypeScript parser (backend/parser).
//!
//! tests/golden/*.json were recorded from the TS implementation by
//! scripts/gen-parity-goldens.mjs over fixtures/*.conf and tests/corpus/*.conf.
//! For every input the Rust port must produce the same domain JSON, the same
//! serialized text (byte for byte), the same AST-level re-serialization, or
//! the same error message.

use std::path::{Path, PathBuf};

use airband_config::{parse_config, parse_config_file, serialize_config, serialize_config_file};
use serde_json::Value;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn inputs() -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in [manifest_dir().join("../../fixtures"), manifest_dir().join("tests/corpus")] {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "conf") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

/// serde_json distinguishes 5 from 5.0; JS (and the frontend) do not.
fn normalize_numbers(v: &mut Value) {
    match v {
        Value::Number(n) => *n = serde_json::Number::from_f64(n.as_f64().unwrap()).unwrap(),
        Value::Array(items) => items.iter_mut().for_each(normalize_numbers),
        Value::Object(map) => map.values_mut().for_each(normalize_numbers),
        _ => {}
    }
}

fn check(input: &Path) -> Result<(), String> {
    let name = input.file_stem().unwrap().to_string_lossy().to_string();
    let golden_path = manifest_dir().join("tests/golden").join(format!("{name}.json"));
    let golden: Value = serde_json::from_str(
        &std::fs::read_to_string(&golden_path).map_err(|e| format!("{name}: no golden ({e}); rerun the generator"))?,
    )
    .unwrap();
    let source = std::fs::read_to_string(input).unwrap();

    match (golden["ok"].as_bool().unwrap(), parse_config_file(&source)) {
        (true, Ok(domain)) => {
            let mut got = serde_json::to_value(&domain).unwrap();
            let mut want = golden["domain"].clone();
            normalize_numbers(&mut got);
            normalize_numbers(&mut want);
            if got != want {
                return Err(format!("{name}: domain differs\n  rust: {got}\n  ts:   {want}"));
            }
            let serialized = serialize_config_file(&domain);
            if serialized != golden["serialized"].as_str().unwrap() {
                return Err(format!(
                    "{name}: serialized text differs\n--- rust\n{serialized}\n--- ts\n{}",
                    golden["serialized"].as_str().unwrap()
                ));
            }
            let ast_serialized = serialize_config(&parse_config(&source).unwrap());
            if ast_serialized != golden["ast_serialized"].as_str().unwrap() {
                return Err(format!(
                    "{name}: AST re-serialization differs\n--- rust\n{ast_serialized}\n--- ts\n{}",
                    golden["ast_serialized"].as_str().unwrap()
                ));
            }
            Ok(())
        }
        (false, Err(err)) if err.to_string() == golden["error"].as_str().unwrap() => Ok(()),
        (false, Err(err)) => Err(format!("{name}: error differs\n  rust: {err}\n  ts:   {}", golden["error"])),
        (true, Err(err)) => Err(format!("{name}: rust failed but ts succeeded: {err}")),
        (false, Ok(_)) => Err(format!("{name}: rust succeeded but ts failed with {}", golden["error"])),
    }
}

#[test]
fn matches_typescript_goldens() {
    let failures: Vec<String> = inputs().iter().filter_map(|p| check(p).err()).collect();
    assert!(failures.is_empty(), "{} parity failure(s):\n\n{}", failures.len(), failures.join("\n\n"));
}

#[test]
fn every_golden_has_an_input() {
    let inputs: Vec<String> = inputs().iter().map(|p| p.file_stem().unwrap().to_string_lossy().to_string()).collect();
    for entry in std::fs::read_dir(manifest_dir().join("tests/golden")).unwrap() {
        let stem = entry.unwrap().path().file_stem().unwrap().to_string_lossy().to_string();
        assert!(inputs.contains(&stem), "stale golden {stem}.json has no input .conf");
    }
}
