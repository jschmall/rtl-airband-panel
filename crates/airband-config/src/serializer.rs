//! libconfig text writer. Port of v0.4.110's backend/parser/src/serializer.ts: fixed
//! two-space indentation, one setting per line, scalars written from their
//! `raw` text.

use crate::ast::{AssignOp, ConfigFile, Setting, Value};

const INDENT_UNIT: &str = "  ";

pub fn serialize_config(config: &ConfigFile) -> String {
    let lines: Vec<String> = config.members.iter().map(|m| setting_line(m, 0)).collect();
    format!("{}\n", lines.join("\n"))
}

fn indent(level: usize) -> String {
    INDENT_UNIT.repeat(level)
}

fn setting_line(setting: &Setting, level: usize) -> String {
    let op = match setting.assign_op {
        AssignOp::Equals => " = ",
        AssignOp::Colon => ": ",
    };
    format!("{}{}{}{};", indent(level), setting.name, op, serialize_value(&setting.value, level))
}

fn serialize_value(value: &Value, level: usize) -> String {
    match value {
        Value::Scalar(s) => s.raw.clone(),
        Value::Group { members } => {
            if members.is_empty() {
                return "{ }".to_string();
            }
            let body: Vec<String> = members.iter().map(|m| setting_line(m, level + 1)).collect();
            format!("{{\n{}\n{}}}", body.join("\n"), indent(level))
        }
        Value::List { bracket, items } => {
            if items.is_empty() {
                return format!("{}{}", bracket.open(), bracket.close());
            }
            let body: Vec<String> =
                items.iter().map(|item| format!("{}{}", indent(level + 1), serialize_value(item, level + 1))).collect();
            format!("{}\n{}\n{}{}", bracket.open(), body.join(",\n"), indent(level), bracket.close())
        }
    }
}
