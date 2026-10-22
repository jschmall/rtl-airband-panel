//! Dev tool: validates a .conf file and prints `{ errors, warnings }` as
//! JSON, in the same shape as the TS validator's parity goldens.
//!
//!   cargo run -p airband-validate --example check -- path/to/instance.conf

fn main() {
    let path = std::env::args().nth(1).expect("usage: check <file.conf>");
    let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"));
    match airband_config::parse_config_file(&source) {
        Ok(config) => {
            let result = airband_validate::validate_config(&config);
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
        }
        Err(err) => {
            eprintln!("parse error: {err}");
            std::process::exit(2);
        }
    }
}
