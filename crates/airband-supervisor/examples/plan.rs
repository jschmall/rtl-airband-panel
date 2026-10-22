//! Dev tool: predicts what applying a config change to a running instance
//! would do (live apply vs restart), as JSON.
//!
//!   cargo run -p airband-supervisor --example plan -- running.conf next.conf
//!   cargo run -p airband-supervisor --example plan -- --resave running.conf
//!
//! `--resave` plans the panel re-saving the running config unchanged (its
//! canonical rewrite), which shows what the first save of a hand-written
//! config would disturb.

use airband_config::{parse_config, parse_config_file, serialize_config_file};
use airband_supervisor::{Baseline, plan_change};

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {path}: {e}"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (running, next) = match args.as_slice() {
        [flag, running] if flag == "--resave" => {
            let text = read(running);
            let rewritten = serialize_config_file(&parse_config_file(&text).expect("valid config"));
            (text, rewritten)
        }
        [running, next] => (read(running), read(next)),
        _ => panic!("usage: plan running.conf next.conf | plan --resave running.conf"),
    };
    let running = parse_config(&running).expect("running config parses");
    let next = parse_config(&next).expect("next config parses");
    let plan = plan_change(&Baseline { started: &running, applied: &running }, &next);
    let out = serde_json::json!({ "method": plan.method(), "plan": plan });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
