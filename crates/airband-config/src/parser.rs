//! Recursive-descent libconfig parser. Port of backend/parser/src/parser.ts.

use crate::ast::{AssignOp, Bracket, ConfigFile, Scalar, ScalarType, ScalarValue, Setting, Value};
use crate::error::ConfigError;
use crate::tokenizer::{Token, TokenKind, tokenize};

struct Parser<'a> {
    tokens: Vec<Token<'a>>,
    pos: usize,
}

fn parse_error(message: &str, t: &Token) -> ConfigError {
    ConfigError::Parse {
        message: message.to_string(),
        line: t.line,
        col: t.col,
        near: if t.raw.is_empty() { "<eof>".to_string() } else { t.raw.to_string() },
    }
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &Token<'a> {
        &self.tokens[self.pos]
    }

    fn next(&mut self) -> Token<'a> {
        let t = self.tokens[self.pos].clone();
        if t.kind != TokenKind::Eof {
            self.pos += 1;
        }
        t
    }

    fn is_punct(&self, p: &str) -> bool {
        let t = self.peek();
        t.kind == TokenKind::Punct && t.raw == p
    }

    fn expect_punct(&mut self, p: &str) -> Result<(), ConfigError> {
        if !self.is_punct(p) {
            return Err(parse_error(&format!("Expected '{p}'"), self.peek()));
        }
        self.next();
        Ok(())
    }

    fn parse_settings(&mut self, until_brace: bool) -> Result<Vec<Setting>, ConfigError> {
        let mut members = Vec::new();
        loop {
            if !until_brace && self.peek().kind == TokenKind::Eof {
                break;
            }
            if until_brace && self.is_punct("}") {
                break;
            }
            members.push(self.parse_setting()?);
        }
        Ok(members)
    }

    fn parse_setting(&mut self) -> Result<Setting, ConfigError> {
        let name_tok = self.peek();
        if name_tok.kind != TokenKind::Ident && name_tok.kind != TokenKind::Bool {
            return Err(parse_error("Expected setting name", name_tok));
        }
        let name = self.next().raw.to_string();
        let assign_op = match (self.peek().kind, self.peek().raw) {
            (TokenKind::Punct, "=") => AssignOp::Equals,
            (TokenKind::Punct, ":") => AssignOp::Colon,
            _ => return Err(parse_error("Expected '=' or ':'", self.peek())),
        };
        self.next();
        let value = self.parse_value()?;
        // ';' is conventional and, in practice, always present in RTLSDR-Airband
        // configs; libconfig also accepts ',' as a setting separator, and the
        // terminator is optional on the final setting in a group.
        if self.is_punct(";") || self.is_punct(",") {
            self.next();
        }
        Ok(Setting { name, value, assign_op })
    }

    fn parse_value(&mut self) -> Result<Value, ConfigError> {
        let t = self.peek().clone();
        match t.kind {
            TokenKind::Punct if t.raw == "{" => {
                self.next();
                let members = self.parse_settings(true)?;
                self.expect_punct("}")?;
                Ok(Value::Group { members })
            }
            TokenKind::Punct if t.raw == "(" => self.parse_list(Bracket::Paren),
            TokenKind::Punct if t.raw == "[" => self.parse_list(Bracket::Square),
            TokenKind::String => {
                self.next();
                Ok(Value::Scalar(Scalar {
                    ty: ScalarType::String,
                    value: ScalarValue::String(t.value.unwrap_or_default()),
                    raw: t.raw.to_string(),
                }))
            }
            TokenKind::Bool => {
                self.next();
                Ok(Value::Scalar(Scalar {
                    ty: ScalarType::Bool,
                    value: ScalarValue::Bool(t.raw.eq_ignore_ascii_case("true")),
                    raw: t.raw.to_string(),
                }))
            }
            TokenKind::Number => {
                self.next();
                Ok(Value::Scalar(parse_number(t.raw)))
            }
            _ => Err(parse_error("Expected a value", &t)),
        }
    }

    fn parse_list(&mut self, bracket: Bracket) -> Result<Value, ConfigError> {
        self.next(); // opening bracket
        let close = bracket.close().to_string();
        let mut items = Vec::new();
        loop {
            if self.is_punct(&close) {
                break;
            }
            items.push(self.parse_value()?);
            if self.is_punct(",") {
                self.next();
                continue;
            }
            break;
        }
        self.expect_punct(&close)?;
        Ok(Value::List { bracket, items })
    }
}

pub fn parse_config(source: &str) -> Result<ConfigFile, ConfigError> {
    let mut parser = Parser { tokens: tokenize(source)?, pos: 0 };
    let members = parser.parse_settings(false)?;
    Ok(ConfigFile { members })
}

fn parse_number(raw: &str) -> Scalar {
    let unsigned = raw.trim_start_matches(['+', '-']);
    let negative = raw.starts_with('-');
    let is_hex = unsigned.starts_with("0x") || unsigned.starts_with("0X");
    let is_int64 = raw.ends_with('L') || raw.ends_with('l');
    let digits = unsigned.trim_end_matches(['L', 'l']);

    let (ty, magnitude) = if is_hex {
        let n = u128::from_str_radix(&digits[2..], 16).map(|n| n as f64).unwrap_or(f64::NAN);
        (if is_int64 { ScalarType::Int64 } else { ScalarType::Int }, n)
    } else if digits.contains(['.', 'e', 'E']) {
        (ScalarType::Float, digits.parse::<f64>().unwrap_or(f64::NAN))
    } else {
        (if is_int64 { ScalarType::Int64 } else { ScalarType::Int }, digits.parse::<f64>().unwrap_or(f64::NAN))
    };
    let value = if negative { -magnitude } else { magnitude };
    Scalar { ty, value: ScalarValue::Number(value), raw: raw.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scalar(src: &str) -> Scalar {
        let cfg = parse_config(&format!("x = {src};")).unwrap();
        match &cfg.members[0].value {
            Value::Scalar(s) => s.clone(),
            other => panic!("expected scalar, got {other:?}"),
        }
    }

    #[test]
    fn number_literals() {
        let cases: &[(&str, ScalarType, f64)] = &[
            ("42", ScalarType::Int, 42.0),
            ("-7", ScalarType::Int, -7.0),
            ("+5", ScalarType::Int, 5.0),
            ("0xFF", ScalarType::Int, 255.0),
            ("-0x10", ScalarType::Int, -16.0),
            ("100L", ScalarType::Int64, 100.0),
            ("0x10LL", ScalarType::Int64, 16.0),
            ("151.780", ScalarType::Float, 151.78),
            ("1e3", ScalarType::Float, 1000.0),
            ("-.5", ScalarType::Float, -0.5),
            ("-1.5e-10", ScalarType::Float, -1.5e-10),
        ];
        for (src, ty, value) in cases {
            let s = scalar(src);
            assert_eq!(s.ty, *ty, "{src}");
            assert_eq!(s.value, ScalarValue::Number(*value), "{src}");
            assert_eq!(s.raw, *src);
        }
    }

    #[test]
    fn bools_are_case_insensitive_and_keep_raw() {
        let s = scalar("TRUE");
        assert_eq!(s.value, ScalarValue::Bool(true));
        assert_eq!(s.raw, "TRUE");
    }

    #[test]
    fn separators_and_operators() {
        let cfg = parse_config("a: 1, b = 2; c = { d = 3 }").unwrap();
        assert_eq!(cfg.members.len(), 3);
        assert_eq!(cfg.members[0].assign_op, AssignOp::Colon);
        assert_eq!(cfg.members[1].assign_op, AssignOp::Equals);
    }

    #[test]
    fn errors() {
        assert_eq!(parse_config("a = ;").unwrap_err().to_string(), "Expected a value (line 1, col 5, near ';')");
        assert_eq!(
            parse_config("a = { b = 1;").unwrap_err().to_string(),
            "Expected setting name (line 1, col 13, near '<eof>')"
        );
        assert_eq!(parse_config("a 1;").unwrap_err().to_string(), "Expected '=' or ':' (line 1, col 3, near '1')");
        assert_eq!(parse_config("a = (1 2);").unwrap_err().to_string(), "Expected ')' (line 1, col 8, near '2')");
    }
}
