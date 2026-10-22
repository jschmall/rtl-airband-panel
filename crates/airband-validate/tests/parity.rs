//! Parity with the original TypeScript validator (backend/validate).
//!
//! tests/golden/*.json were recorded from the TS implementation by
//! scripts/gen-parity-goldens.mjs over fixtures/*.conf, airband-config's
//! corpus, and tests/corpus/*.conf. The Rust port must report exactly the
//! same errors and warnings (code, path, message, order) for each.

use std::path::{Path, PathBuf};

use airband_config::parse_config_file;
use airband_validate::{ValidationResult, validate_config};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn inputs() -> Vec<PathBuf> {
    let dirs = [
        manifest_dir().join("../../fixtures"),
        manifest_dir().join("../airband-config/tests/corpus"),
        manifest_dir().join("tests/corpus"),
    ];
    let mut files: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|d| std::fs::read_dir(d).unwrap().map(|e| e.unwrap().path()))
        .filter(|p| p.extension().is_some_and(|e| e == "conf"))
        .collect();
    files.sort();
    files
}

fn check(input: &Path) -> Result<bool, String> {
    let name = input.file_stem().unwrap().to_string_lossy().to_string();
    let Ok(domain) = parse_config_file(&std::fs::read_to_string(input).unwrap()) else {
        return Ok(false); // parse errors are the parser goldens' business
    };
    let golden_path = manifest_dir().join("tests/golden").join(format!("{name}.json"));
    let golden: ValidationResult = serde_json::from_str(
        &std::fs::read_to_string(&golden_path).map_err(|e| format!("{name}: no golden ({e}); rerun the generator"))?,
    )
    .unwrap();
    let got = validate_config(&domain);
    if got != golden {
        let show = |r: &ValidationResult| serde_json::to_string_pretty(r).unwrap();
        return Err(format!("{name}: validation differs\n--- rust\n{}\n--- ts\n{}", show(&got), show(&golden)));
    }
    Ok(true)
}

#[test]
fn matches_typescript_goldens() {
    let mut checked = 0;
    let mut failures = Vec::new();
    for input in inputs() {
        match check(&input) {
            Ok(true) => checked += 1,
            Ok(false) => {}
            Err(e) => failures.push(e),
        }
    }
    assert!(failures.is_empty(), "{} parity failure(s):\n\n{}", failures.len(), failures.join("\n\n"));
    assert!(checked >= 75, "only {checked} inputs checked");
}

#[test]
fn every_golden_has_an_input() {
    let inputs: Vec<String> = inputs().iter().map(|p| p.file_stem().unwrap().to_string_lossy().to_string()).collect();
    for entry in std::fs::read_dir(manifest_dir().join("tests/golden")).unwrap() {
        let stem = entry.unwrap().path().file_stem().unwrap().to_string_lossy().to_string();
        assert!(inputs.contains(&stem), "stale golden {stem}.json has no input .conf");
    }
}
