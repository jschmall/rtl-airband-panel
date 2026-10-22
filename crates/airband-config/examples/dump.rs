//! Dev tool: prints what airband-config makes of a .conf file, as JSON in
//! the same shape scripts/gen-parity-goldens.mjs records for the TS parser:
//! `{ ok, domain, serialized, ast_serialized }` or `{ ok: false, error }`,
//! plus `ast` (the original file's syntax tree) and `serialized_ast` (the
//! syntax tree of what the panel would write) for semantic comparisons.
//!
//!   cargo run -p airband-config --example dump -- path/to/instance.conf

use airband_config::{parse_config, parse_config_file, serialize_config, serialize_config_file};
use serde_json::json;

fn main() {
    let path = std::env::args().nth(1).expect("usage: dump <file.conf>");
    let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"));
    let out = match parse_config_file(&source) {
        Ok(domain) => json!({
            "ok": true,
            "serialized": serialize_config_file(&domain),
            "ast_serialized": serialize_config(&parse_config(&source).unwrap()),
            "ast": parse_config(&source).unwrap(),
            "serialized_ast": parse_config(&serialize_config_file(&domain)).unwrap(),
            "domain": domain,
        }),
        Err(err) => json!({ "ok": false, "error": err.to_string() }),
    };
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
