//! Generic libconfig layer round trips against the real fixture files.

use std::path::PathBuf;

use airband_config::{parse_config, serialize_config};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()))
}

const FIXTURES: &[&str] = &["151719.conf", "fork-features.conf"];

#[test]
fn parses_fixtures() {
    for name in FIXTURES {
        let ast = parse_config(&fixture(name)).unwrap();
        assert!(!ast.members.is_empty(), "{name}");
    }
}

#[test]
fn parse_serialize_parse_gives_identical_ast() {
    for name in FIXTURES {
        let ast1 = parse_config(&fixture(name)).unwrap();
        let ast2 = parse_config(&serialize_config(&ast1)).unwrap();
        assert_eq!(ast2, ast1, "{name}");
    }
}

#[test]
fn serialization_is_idempotent() {
    for name in FIXTURES {
        let text2 = serialize_config(&parse_config(&fixture(name)).unwrap());
        let text3 = serialize_config(&parse_config(&text2).unwrap());
        assert_eq!(text3, text2, "{name}");
    }
}

#[test]
fn ast_json_round_trips() {
    for name in FIXTURES {
        let ast = parse_config(&fixture(name)).unwrap();
        let json = serde_json::to_string(&ast).unwrap();
        assert_eq!(serde_json::from_str::<airband_config::ConfigFile>(&json).unwrap(), ast, "{name}");
    }
}
