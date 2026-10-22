//! Generic libconfig syntax tree. Mirrors backend/parser/src/ast.ts.
//!
//! Every scalar keeps its original literal text (`raw`) and every setting
//! its original assignment operator, so text -> AST -> text is stable.
//! Comments and whitespace are not kept (see CLAUDE.md).

use serde::{Deserialize, Serialize};

use crate::jsnum;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScalarType {
    Int,
    Int64,
    Float,
    Bool,
    String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScalarValue {
    Bool(bool),
    Number(f64),
    String(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scalar {
    #[serde(rename = "type")]
    pub ty: ScalarType,
    pub value: ScalarValue,
    /// Original literal source text, e.g. `151.780`, `5.0`, `true`, `"nfm"`.
    pub raw: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Bracket {
    /// A libconfig list (heterogeneous).
    #[serde(rename = "(")]
    Paren,
    /// A libconfig array (homogeneous).
    #[serde(rename = "[")]
    Square,
}

impl Bracket {
    pub fn open(self) -> char {
        match self {
            Bracket::Paren => '(',
            Bracket::Square => '[',
        }
    }

    pub fn close(self) -> char {
        match self {
            Bracket::Paren => ')',
            Bracket::Square => ']',
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Value {
    Scalar(Scalar),
    Group { members: Vec<Setting> },
    List { bracket: Bracket, items: Vec<Value> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssignOp {
    #[serde(rename = "=")]
    Equals,
    #[serde(rename = ":")]
    Colon,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Setting {
    pub name: String,
    pub value: Value,
    /// Original assignment operator used in source, kept for round-trip fidelity.
    pub assign_op: AssignOp,
}

/// The root of a config file is an implicit, brace-less group of settings.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ConfigFile {
    pub members: Vec<Setting>,
}

impl Scalar {
    pub fn new(ty: ScalarType, value: ScalarValue) -> Scalar {
        let raw = format_scalar_raw(ty, &value);
        Scalar { ty, value, raw }
    }

    pub fn string(value: impl Into<String>) -> Scalar {
        Scalar::new(ScalarType::String, ScalarValue::String(value.into()))
    }

    pub fn bool(value: bool) -> Scalar {
        Scalar::new(ScalarType::Bool, ScalarValue::Bool(value))
    }

    pub fn int(value: f64) -> Scalar {
        Scalar::new(ScalarType::Int, ScalarValue::Number(value))
    }

    pub fn float(value: f64) -> Scalar {
        Scalar::new(ScalarType::Float, ScalarValue::Number(value))
    }

    pub fn as_number(&self) -> Option<f64> {
        match (&self.ty, &self.value) {
            (ScalarType::Int | ScalarType::Int64 | ScalarType::Float, ScalarValue::Number(n)) => Some(*n),
            _ => None,
        }
    }
}

/// Canonical literal text for a scalar built from a domain value (not parsed).
pub fn format_scalar_raw(ty: ScalarType, value: &ScalarValue) -> String {
    match (ty, value) {
        (ScalarType::Bool, ScalarValue::Bool(b)) => if *b { "true" } else { "false" }.to_string(),
        (ScalarType::String, ScalarValue::String(s)) => {
            format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
        }
        (ScalarType::Int | ScalarType::Int64, ScalarValue::Number(n)) => jsnum::to_js_string(*n),
        (ScalarType::Float, ScalarValue::Number(n)) => {
            // libconfig floats always contain a decimal point.
            if jsnum::is_integer(*n) { format!("{}.0", jsnum::to_js_string(*n)) } else { jsnum::to_js_string(*n) }
        }
        (ty, value) => panic!("scalar type {ty:?} does not match value {value:?}"),
    }
}

impl Setting {
    /// Builds a setting; groups/lists conventionally use ':', scalars use '='.
    pub fn new(name: impl Into<String>, value: Value) -> Setting {
        let assign_op = match value {
            Value::Scalar(_) => AssignOp::Equals,
            _ => AssignOp::Colon,
        };
        Setting { name: name.into(), value, assign_op }
    }
}
