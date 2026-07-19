import type { ConfigFile, GroupNode, ListNode, SettingNode, ValueNode } from "./ast.js";

const INDENT_UNIT = "  ";

export function serializeConfig(config: ConfigFile): string {
  const lines = config.members.map((m) => settingLine(m, 0));
  return lines.join("\n") + "\n";
}

function indent(level: number): string {
  return INDENT_UNIT.repeat(level);
}

function settingLine(setting: SettingNode, level: number): string {
  const op = setting.assignOp === "=" ? " = " : ": ";
  const valueText = serializeValue(setting.value, level);
  return `${indent(level)}${setting.name}${op}${valueText};`;
}

function serializeValue(value: ValueNode, level: number): string {
  switch (value.kind) {
    case "scalar":
      return value.raw;
    case "group":
      return serializeGroup(value, level);
    case "list":
      return serializeList(value, level);
  }
}

function serializeGroup(group: GroupNode, level: number): string {
  if (group.members.length === 0) {
    return "{ }";
  }
  const body = group.members.map((m) => settingLine(m, level + 1)).join("\n");
  return `{\n${body}\n${indent(level)}}`;
}

function serializeList(list: ListNode, level: number): string {
  const close = list.bracket === "(" ? ")" : "]";
  if (list.items.length === 0) {
    return `${list.bracket}${close}`;
  }
  const body = list.items
    .map((item) => `${indent(level + 1)}${serializeValue(item, level + 1)}`)
    .join(",\n");
  return `${list.bracket}\n${body}\n${indent(level)}${close}`;
}
