import { tokenize, type Token } from "./tokenizer.js";
import type { ConfigFile, ListNode, ScalarNode, SettingNode, ValueNode } from "./ast.js";

class ParseError extends Error {
  constructor(message: string, token: Token) {
    super(`${message} (line ${token.line}, col ${token.col}, near '${token.raw || "<eof>"}')`);
    this.name = "LibconfigParseError";
  }
}

export function parseConfig(source: string): ConfigFile {
  const tokens = tokenize(source);
  let pos = 0;

  function peek(): Token {
    return tokens[pos]!;
  }

  function next(): Token {
    return tokens[pos++]!;
  }

  function expectPunct(p: string): Token {
    const t = peek();
    if (t.type !== "punct" || t.raw !== p) {
      throw new ParseError(`Expected '${p}'`, t);
    }
    return next();
  }

  function parseSettings(terminator: "eof" | "}"): SettingNode[] {
    const members: SettingNode[] = [];
    while (true) {
      const t = peek();
      if (terminator === "eof" && t.type === "eof") break;
      if (terminator === "}" && t.type === "punct" && t.raw === "}") break;
      members.push(parseSetting());
    }
    return members;
  }

  function parseSetting(): SettingNode {
    const nameTok = peek();
    if (nameTok.type !== "ident" && nameTok.type !== "bool") {
      throw new ParseError("Expected setting name", nameTok);
    }
    next();
    const opTok = peek();
    if (opTok.type !== "punct" || (opTok.raw !== "=" && opTok.raw !== ":")) {
      throw new ParseError("Expected '=' or ':'", opTok);
    }
    next();
    const value = parseValue();
    // trailing ';' is conventional and, in practice, always present in
    // RTLSDR-Airband configs; tolerate a missing one on the final setting.
    const semi = peek();
    if (semi.type === "punct" && semi.raw === ";") {
      next();
    }
    return { name: nameTok.raw, value, assignOp: opTok.raw as "=" | ":" };
  }

  function parseValue(): ValueNode {
    const t = peek();

    if (t.type === "punct" && t.raw === "{") {
      next();
      const members = parseSettings("}");
      expectPunct("}");
      return { kind: "group", members };
    }

    if (t.type === "punct" && (t.raw === "(" || t.raw === "[")) {
      return parseList(t.raw);
    }

    if (t.type === "string") {
      next();
      return { kind: "scalar", type: "string", value: t.value ?? "", raw: t.raw } satisfies ScalarNode;
    }

    if (t.type === "bool") {
      next();
      const lowered = t.raw.toLowerCase();
      return { kind: "scalar", type: "bool", value: lowered === "true", raw: t.raw } satisfies ScalarNode;
    }

    if (t.type === "number") {
      next();
      return { kind: "scalar", ...parseNumber(t.raw) } satisfies ScalarNode;
    }

    throw new ParseError("Expected a value", t);
  }

  function parseList(open: "(" | "["): ListNode {
    expectPunct(open);
    const close = open === "(" ? ")" : "]";
    const items: ValueNode[] = [];
    while (true) {
      const t = peek();
      if (t.type === "punct" && t.raw === close) break;
      items.push(parseValue());
      const sep = peek();
      if (sep.type === "punct" && sep.raw === ",") {
        next();
        continue;
      }
      break;
    }
    expectPunct(close);
    return { kind: "list", bracket: open, items };
  }

  const members = parseSettings("eof");
  return { members };
}

function parseNumber(raw: string): { type: "int" | "int64" | "float"; value: number; raw: string } {
  const isHex = /^[+-]?0[xX]/.test(raw);
  const isInt64 = /LL?$/i.test(raw);
  const isFloat = !isHex && /[.eE]/.test(raw.replace(/^[+-]?0[xX]/, ""));

  if (isHex) {
    const value = Number.parseInt(raw.replace(/L{1,2}$/i, ""), 16);
    return { type: isInt64 ? "int64" : "int", value, raw };
  }
  if (isFloat) {
    return { type: "float", value: Number.parseFloat(raw), raw };
  }
  const value = Number.parseInt(raw.replace(/L{1,2}$/i, ""), 10);
  return { type: isInt64 ? "int64" : "int", value, raw };
}
