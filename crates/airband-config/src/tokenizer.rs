//! libconfig tokenizer. Port of backend/parser/src/tokenizer.ts.

use std::sync::LazyLock;

use regex::Regex;

use crate::error::ConfigError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Ident,
    String,
    Number,
    Bool,
    Punct,
    Eof,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token<'a> {
    pub kind: TokenKind,
    /// Raw source text of the token, exactly as written.
    pub raw: &'a str,
    /// Decoded value for string tokens (escapes resolved).
    pub value: Option<String>,
    pub line: usize,
    pub col: usize,
}

static NUMBER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^[+-]?(0[xX][0-9a-fA-F]+|[0-9]+\.[0-9]+([eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+|\.[0-9]+([eE][+-]?[0-9]+)?|[0-9]+)(L{1,2})?",
    )
    .expect("valid number regex")
});
static IDENT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_*-]+").expect("valid ident regex"));

fn is_punct(b: u8) -> bool {
    matches!(b, b'{' | b'}' | b'(' | b')' | b'[' | b']' | b';' | b',' | b'=' | b':')
}

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n')
}

struct Cursor<'a> {
    src: &'a str,
    bytes: &'a [u8],
    i: usize,
    line: usize,
    col: usize,
}

impl<'a> Cursor<'a> {
    fn peek(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.i + offset).copied()
    }

    /// Advances `count` bytes, tracking line/column. Columns count
    /// characters, not bytes (UTF-8 continuation bytes don't advance it).
    fn advance(&mut self, count: usize) {
        for _ in 0..count {
            match self.bytes.get(self.i) {
                Some(b'\n') => {
                    self.line += 1;
                    self.col = 1;
                }
                Some(b) if (b & 0xC0) == 0x80 => {}
                Some(_) => self.col += 1,
                None => return,
            }
            self.i += 1;
        }
    }

    fn syntax_error(message: impl Into<String>, line: usize, col: usize) -> ConfigError {
        ConfigError::Syntax { message: message.into(), line, col }
    }
}

pub fn tokenize(source: &str) -> Result<Vec<Token<'_>>, ConfigError> {
    let mut cur = Cursor { src: source, bytes: source.as_bytes(), i: 0, line: 1, col: 1 };
    let mut tokens = Vec::new();

    while let Some(c) = cur.peek(0) {
        if is_ws(c) {
            cur.advance(1);
            continue;
        }

        // line comments: // or #
        if (c == b'/' && cur.peek(1) == Some(b'/')) || c == b'#' {
            while cur.peek(0).is_some_and(|b| b != b'\n') {
                cur.advance(1);
            }
            continue;
        }

        // block comments: /* ... */
        if c == b'/' && cur.peek(1) == Some(b'*') {
            let (start_line, start_col) = (cur.line, cur.col);
            cur.advance(2);
            let mut closed = false;
            while cur.peek(0).is_some() {
                if cur.peek(0) == Some(b'*') && cur.peek(1) == Some(b'/') {
                    cur.advance(2);
                    closed = true;
                    break;
                }
                cur.advance(1);
            }
            if !closed {
                return Err(Cursor::syntax_error("Unterminated block comment", start_line, start_col));
            }
            continue;
        }

        let (line, col) = (cur.line, cur.col);
        let start = cur.i;

        if is_punct(c) {
            cur.advance(1);
            tokens.push(Token { kind: TokenKind::Punct, raw: &source[start..cur.i], value: None, line, col });
            continue;
        }

        // strings, with libconfig's adjacent-string concatenation ("a" "b" -> "ab")
        if c == b'"' {
            let (len, value) = read_string(cur.src, start, line, col)?;
            cur.advance(len);
            tokens.push(Token { kind: TokenKind::String, raw: &source[start..cur.i], value: Some(value), line, col });
            continue;
        }

        let next_is_num_start = cur.peek(1).is_some_and(|b| b.is_ascii_digit() || b == b'.');
        if c.is_ascii_digit() || ((c == b'-' || c == b'+') && next_is_num_start) {
            let Some(m) = NUMBER_RE.find(&source[start..]) else {
                return Err(Cursor::syntax_error(format!("Invalid number literal near '{}'", c as char), line, col));
            };
            cur.advance(m.end());
            tokens.push(Token { kind: TokenKind::Number, raw: &source[start..cur.i], value: None, line, col });
            continue;
        }

        if c.is_ascii_alphabetic() || c == b'_' || c == b'*' {
            let m = IDENT_RE.find(&source[start..]).expect("ident start char always matches");
            cur.advance(m.end());
            let raw = &source[start..cur.i];
            let kind =
                if matches!(raw, "true" | "false" | "TRUE" | "FALSE") { TokenKind::Bool } else { TokenKind::Ident };
            tokens.push(Token { kind, raw, value: None, line, col });
            continue;
        }

        let ch = source[start..].chars().next().expect("non-empty remainder");
        return Err(Cursor::syntax_error(format!("Unexpected character '{ch}'"), line, col));
    }

    tokens.push(Token { kind: TokenKind::Eof, raw: "", value: None, line: cur.line, col: cur.col });
    Ok(tokens)
}

/// Reads one or more adjacent quoted strings (libconfig concatenates
/// "a" "b" into "ab") starting at byte `start`. Returns the byte length of
/// the raw span (ending at the last closing quote) and the decoded value.
///
/// Unlike the TS original, the raw span never includes whitespace or
/// comments trailing the final segment; that only affects AST-level
/// re-serialization of unknown settings, never the domain model.
fn read_string(source: &str, start: usize, line: usize, col: usize) -> Result<(usize, String), ConfigError> {
    let bytes = source.as_bytes();
    let mut i = start;
    let mut end = start;
    let mut value = String::new();
    let mut saw_one = false;

    loop {
        // skip whitespace/comments between concatenated string segments
        while i < bytes.len() {
            let c = bytes[i];
            if is_ws(c) {
                i += 1;
                continue;
            }
            if c == b'/' && bytes.get(i + 1) == Some(&b'/') {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
                i += 2;
                while i < bytes.len() && !(bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/')) {
                    i += 1;
                }
                i += 2;
                continue;
            }
            break;
        }

        if bytes.get(i) != Some(&b'"') {
            if saw_one {
                break;
            }
            return Err(Cursor::syntax_error("Expected string literal", line, col));
        }

        i += 1; // opening quote
        let mut chars = source[i..].char_indices();
        let mut closed_at = None;
        while let Some((off, ch)) = chars.next() {
            match ch {
                '"' => {
                    closed_at = Some(i + off);
                    break;
                }
                '\\' => match chars.next() {
                    Some((_, 'n')) => value.push('\n'),
                    Some((_, 't')) => value.push('\t'),
                    Some((_, 'r')) => value.push('\r'),
                    Some((_, other)) => value.push(other),
                    None => {}
                },
                other => value.push(other),
            }
        }
        let Some(close) = closed_at else {
            return Err(Cursor::syntax_error("Unterminated string literal", line, col));
        };
        i = close + 1; // closing quote
        end = i;
        saw_one = true;
    }

    Ok((end - start, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raws(source: &str) -> Vec<&str> {
        tokenize(source).unwrap().into_iter().filter(|t| t.kind != TokenKind::Eof).map(|t| t.raw).collect()
    }

    #[test]
    fn numbers_at_boundaries() {
        assert_eq!(raws("42"), ["42"]);
        assert_eq!(raws("freq=100.5;"), ["freq", "=", "100.5", ";"]);
        assert_eq!(raws("[1,2,3]"), ["[", "1", ",", "2", ",", "3", "]"]);
        assert_eq!(raws("-1.5e-10"), ["-1.5e-10"]);
        assert_eq!(raws("0xFF"), ["0xFF"]);
        assert_eq!(raws("100L;"), ["100L", ";"]);
        assert_eq!(raws("-.5"), ["-.5"]);
        // Matches the TS tokenizer: a number must start with a digit or a sign.
        assert!(tokenize(".5").is_err());
    }

    #[test]
    fn identifiers_at_boundaries() {
        assert_eq!(raws("devices"), ["devices"]);
        assert_eq!(raws("devices:(true)"), ["devices", ":", "(", "true", ")"]);
        assert_eq!(raws("true false TRUE FALSE"), ["true", "false", "TRUE", "FALSE"]);
        let kinds: Vec<_> = tokenize("true x").unwrap().iter().map(|t| t.kind).collect();
        assert_eq!(kinds, [TokenKind::Bool, TokenKind::Ident, TokenKind::Eof]);
    }

    #[test]
    fn whole_file_consistency() {
        let head = "a=1; b=2; c=3; ".repeat(200);
        let tail = r#"stats_filepath = "/tmp/x.txt";"#;
        let whole_src = format!("{head}{tail}");
        let whole = raws(&whole_src);
        let tail_only = raws(tail);
        assert_eq!(&whole[whole.len() - tail_only.len()..], tail_only.as_slice());
    }

    #[test]
    fn comments_are_skipped() {
        assert_eq!(raws("a = 1; // x\n# y\n/* z\n */ b = 2;"), ["a", "=", "1", ";", "b", "=", "2", ";"]);
    }

    #[test]
    fn strings_decode_escapes_and_concatenate() {
        let toks = tokenize(r#"x = "a\"b\\c\n" /* c */ "d" ;"#).unwrap();
        assert_eq!(toks[2].value.as_deref(), Some("a\"b\\c\nd"));
        assert_eq!(toks[2].raw, r#""a\"b\\c\n" /* c */ "d""#);
        assert_eq!(toks[3].raw, ";");
    }

    #[test]
    fn utf8_in_strings_and_comments() {
        let toks = tokenize("// café\nlabel = \"Tower – ATIS ✈\";").unwrap();
        assert_eq!(toks[2].value.as_deref(), Some("Tower – ATIS ✈"));
    }

    #[test]
    fn errors_report_position() {
        let err = tokenize("a = 1;\n  /* never closed").unwrap_err();
        assert_eq!(err.to_string(), "Unterminated block comment (line 2, col 3)");
        let err = tokenize("a = \"open").unwrap_err();
        assert_eq!(err.to_string(), "Unterminated string literal (line 1, col 5)");
        let err = tokenize("a = @;").unwrap_err();
        assert_eq!(err.to_string(), "Unexpected character '@' (line 1, col 5)");
    }
}
