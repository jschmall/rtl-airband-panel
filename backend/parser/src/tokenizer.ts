export type TokenType =
  | "ident"
  | "string"
  | "number"
  | "bool"
  | "punct"
  | "eof";

export interface Token {
  type: TokenType;
  /** Raw source text of the token, exactly as written. */
  raw: string;
  /** Decoded value for string tokens (escapes resolved); undefined otherwise. */
  value?: string;
  line: number;
  col: number;
}

const PUNCT = new Set(["{", "}", "(", ")", "[", "]", ";", ",", "=", ":"]);

class SourceError extends Error {
  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = "LibconfigSyntaxError";
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  function advance(count = 1): void {
    for (let k = 0; k < count; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  }

  function peek(offset = 0): string {
    return source[i + offset] ?? "";
  }

  while (i < n) {
    const c = peek();

    // whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance();
      continue;
    }

    // line comments: // or #
    if ((c === "/" && peek(1) === "/") || c === "#") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    // block comments: /* ... */
    if (c === "/" && peek(1) === "*") {
      const startLine = line;
      const startCol = col;
      advance(2);
      let closed = false;
      while (i < n) {
        if (source[i] === "*" && peek(1) === "/") {
          advance(2);
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        throw new SourceError("Unterminated block comment", startLine, startCol);
      }
      continue;
    }

    const startLine = line;
    const startCol = col;

    // punctuation
    if (PUNCT.has(c)) {
      advance();
      tokens.push({ type: "punct", raw: c, line: startLine, col: startCol });
      continue;
    }

    // strings, with libconfig's adjacent-string concatenation ("a" "b" -> "ab")
    if (c === '"') {
      const { raw, value } = readString(source, i, line, col);
      advance(raw.length);
      tokens.push({ type: "string", raw, value, line: startLine, col: startCol });
      continue;
    }

    // numbers: optional sign, digits, optional '.', optional exponent, optional hex, optional L/l suffix
    if (/[0-9]/.test(c) || (c === "-" && /[0-9.]/.test(peek(1))) || (c === "+" && /[0-9.]/.test(peek(1)))) {
      const match = /^[+-]?(0[xX][0-9a-fA-F]+|\d+\.\d+([eE][+-]?\d+)?|\d+[eE][+-]?\d+|\.\d+([eE][+-]?\d+)?|\d+)(L{1,2})?/.exec(
        source.slice(i)
      );
      if (!match) {
        throw new SourceError(`Invalid number literal near '${c}'`, startLine, startCol);
      }
      const raw = match[0];
      advance(raw.length);
      tokens.push({ type: "number", raw, line: startLine, col: startCol });
      continue;
    }

    // identifiers / booleans / keywords (also settings' group/list intro like "devices:")
    if (/[A-Za-z_*]/.test(c)) {
      const match = /^[A-Za-z0-9_*-]+/.exec(source.slice(i));
      const raw = match![0];
      advance(raw.length);
      if (raw === "true" || raw === "false" || raw === "TRUE" || raw === "FALSE") {
        tokens.push({ type: "bool", raw, line: startLine, col: startCol });
      } else {
        tokens.push({ type: "ident", raw, line: startLine, col: startCol });
      }
      continue;
    }

    throw new SourceError(`Unexpected character '${c}'`, startLine, startCol);
  }

  tokens.push({ type: "eof", raw: "", line, col });
  return tokens;
}

/**
 * Reads one or more adjacent quoted strings (libconfig concatenates
 * "a" "b" into "ab") starting at position `start`. Returns the combined
 * raw source span and the decoded value.
 */
function readString(
  source: string,
  start: number,
  startLine: number,
  startCol: number
): { raw: string; value: string } {
  let i = start;
  let value = "";
  let sawOne = false;

  while (true) {
    // skip whitespace/comments between concatenated string segments
    while (i < source.length) {
      const c = source[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        i++;
        continue;
      }
      if (c === "/" && source[i + 1] === "/") {
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && source[i + 1] === "*") {
        i += 2;
        while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      break;
    }

    if (source[i] !== '"') {
      if (sawOne) break;
      throw new SourceError("Expected string literal", startLine, startCol);
    }

    const segStart = i;
    i++; // opening quote
    let seg = "";
    while (i < source.length && source[i] !== '"') {
      if (source[i] === "\\") {
        const esc = source[i + 1];
        switch (esc) {
          case "n":
            seg += "\n";
            break;
          case "t":
            seg += "\t";
            break;
          case "r":
            seg += "\r";
            break;
          case '"':
            seg += '"';
            break;
          case "\\":
            seg += "\\";
            break;
          default:
            seg += esc ?? "";
        }
        i += 2;
      } else {
        seg += source[i];
        i++;
      }
    }
    if (source[i] !== '"') {
      throw new SourceError("Unterminated string literal", startLine, startCol);
    }
    i++; // closing quote
    value += seg;
    sawOne = true;
    void segStart;
  }

  return { raw: source.slice(start, i), value };
}
