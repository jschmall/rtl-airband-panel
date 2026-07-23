import type { GroupNode, ListNode, ScalarNode, SettingNode, ValueNode } from "./ast.js";
import { scalar } from "./ast.js";

export class DomainMappingError extends Error {
  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = "DomainMappingError";
  }
}

export function findSetting(group: GroupNode, name: string): SettingNode | undefined {
  return group.members.find((m) => m.name === name);
}

function requireValue(group: GroupNode, name: string, path: string): ValueNode {
  const setting = findSetting(group, name);
  if (!setting) {
    throw new DomainMappingError(`Missing required field '${name}'`, path);
  }
  return setting.value;
}

function requireScalar(group: GroupNode, name: string, path: string): ScalarNode {
  const value = requireValue(group, name, path);
  if (value.kind !== "scalar") {
    throw new DomainMappingError(`Expected '${name}' to be a scalar`, path);
  }
  return value;
}

function optionalScalar(group: GroupNode, name: string, path: string): ScalarNode | undefined {
  const setting = findSetting(group, name);
  if (!setting) return undefined;
  if (setting.value.kind !== "scalar") {
    throw new DomainMappingError(`Expected '${name}' to be a scalar`, path);
  }
  return setting.value;
}

export function requireString(group: GroupNode, name: string, path: string): string {
  const s = requireScalar(group, name, path);
  if (s.type !== "string") throw new DomainMappingError(`Expected '${name}' to be a string`, path);
  return s.value as string;
}

export function optionalString(group: GroupNode, name: string, path: string): string | undefined {
  const s = optionalScalar(group, name, path);
  if (!s) return undefined;
  if (s.type !== "string") throw new DomainMappingError(`Expected '${name}' to be a string`, path);
  return s.value as string;
}

export function requireNumber(group: GroupNode, name: string, path: string): number {
  const s = requireScalar(group, name, path);
  if (s.type !== "int" && s.type !== "int64" && s.type !== "float") {
    throw new DomainMappingError(`Expected '${name}' to be numeric`, path);
  }
  return s.value as number;
}

export function optionalNumber(group: GroupNode, name: string, path: string): number | undefined {
  const s = optionalScalar(group, name, path);
  if (!s) return undefined;
  if (s.type !== "int" && s.type !== "int64" && s.type !== "float") {
    throw new DomainMappingError(`Expected '${name}' to be numeric`, path);
  }
  return s.value as number;
}

/**
 * Reads a frequency-like field (freq/centerfreq/sample_rate/bandwidth),
 * replicating RTLSDR-Airband's parse_anynum2int(): a float literal is
 * MHz and gets scaled to Hz, an int literal is already Hz.
 */
function toHz(s: ScalarNode, name: string, path: string): number {
  if (s.type === "float") return Math.round((s.value as number) * 1e6);
  if (s.type === "int" || s.type === "int64") return s.value as number;
  throw new DomainMappingError(`Expected '${name}' to be numeric`, path);
}

export function requireHzNumber(group: GroupNode, name: string, path: string): number {
  return toHz(requireScalar(group, name, path), name, path);
}

export function optionalHzNumber(group: GroupNode, name: string, path: string): number | undefined {
  const s = optionalScalar(group, name, path);
  if (!s) return undefined;
  return toHz(s, name, path);
}

export function requireBool(group: GroupNode, name: string, path: string): boolean {
  const s = requireScalar(group, name, path);
  if (s.type !== "bool") throw new DomainMappingError(`Expected '${name}' to be a boolean`, path);
  return s.value as boolean;
}

export function optionalBool(group: GroupNode, name: string, path: string): boolean | undefined {
  const s = optionalScalar(group, name, path);
  if (!s) return undefined;
  if (s.type !== "bool") throw new DomainMappingError(`Expected '${name}' to be a boolean`, path);
  return s.value as boolean;
}

export function requireList(group: GroupNode, name: string, path: string): ListNode {
  const value = requireValue(group, name, path);
  if (value.kind !== "list") throw new DomainMappingError(`Expected '${name}' to be a list`, path);
  return value;
}

/** Reads an optional nested settings group, e.g. a file output's `rdio_scanner` block. */
export function optionalGroup(group: GroupNode, name: string, path: string): GroupNode | undefined {
  const setting = findSetting(group, name);
  if (!setting) return undefined;
  if (setting.value.kind !== "group") throw new DomainMappingError(`Expected '${name}' to be a group`, path);
  return setting.value;
}

function optionalList(group: GroupNode, name: string, path: string): ListNode | undefined {
  const setting = findSetting(group, name);
  if (!setting) return undefined;
  if (setting.value.kind !== "list") throw new DomainMappingError(`Expected '${name}' to be a list`, path);
  return setting.value;
}

export function requireGroupItems(list: ListNode, path: string): GroupNode[] {
  return list.items.map((item, idx) => {
    if (item.kind !== "group") {
      throw new DomainMappingError(`Expected list item to be a group`, `${path}[${idx}]`);
    }
    return item;
  });
}

function scalarItemsToNumbers(list: ListNode, name: string, path: string): number[] {
  return list.items.map((item, idx) => {
    if (item.kind !== "scalar" || (item.type !== "int" && item.type !== "int64" && item.type !== "float")) {
      throw new DomainMappingError(`Expected '${name}' list item to be numeric`, `${path}[${idx}]`);
    }
    return item.value as number;
  });
}

function scalarItemsToHzNumbers(list: ListNode, name: string, path: string): number[] {
  return list.items.map((item, idx) => {
    if (item.kind !== "scalar") throw new DomainMappingError(`Expected '${name}' list item to be numeric`, `${path}[${idx}]`);
    return toHz(item, name, `${path}[${idx}]`);
  });
}

function scalarItemsToStrings(list: ListNode, name: string, path: string): string[] {
  return list.items.map((item, idx) => {
    if (item.kind !== "scalar" || item.type !== "string") {
      throw new DomainMappingError(`Expected '${name}' list item to be a string`, `${path}[${idx}]`);
    }
    return item.value as string;
  });
}

/** Reads a required Hz-valued list field, e.g. scan-mode `freqs`. */
export function requireHzNumberList(group: GroupNode, name: string, path: string): number[] {
  const list = requireList(group, name, path);
  return scalarItemsToHzNumbers(list, name, path);
}

/** Reads an optional field that may be a single number or a list of numbers, e.g. scan-mode `ampfactor`. */
export function optionalNumberOrList(group: GroupNode, name: string, path: string): number | number[] | undefined {
  const setting = findSetting(group, name);
  if (!setting) return undefined;
  if (setting.value.kind === "list") return scalarItemsToNumbers(setting.value, name, path);
  if (setting.value.kind === "scalar") return optionalNumber(group, name, path);
  throw new DomainMappingError(`Expected '${name}' to be a number or a list of numbers`, path);
}

/** Like optionalNumberOrList, but scalar values are Hz-converted (float literal = MHz), e.g. scan-mode `bandwidth`. */
export function optionalHzNumberOrList(group: GroupNode, name: string, path: string): number | number[] | undefined {
  const setting = findSetting(group, name);
  if (!setting) return undefined;
  if (setting.value.kind === "list") return scalarItemsToHzNumbers(setting.value, name, path);
  if (setting.value.kind === "scalar") return toHz(setting.value, name, path);
  throw new DomainMappingError(`Expected '${name}' to be a number or a list of numbers`, path);
}

/** Reads an optional list-of-strings field, e.g. scan-mode `modulations`/`labels`. */
export function optionalStringList(group: GroupNode, name: string, path: string): string[] | undefined {
  const list = optionalList(group, name, path);
  if (!list) return undefined;
  return scalarItemsToStrings(list, name, path);
}

/** Reads an optional field that may be a number or a string, e.g. SoapySDR `gain`. */
export function optionalNumberOrString(group: GroupNode, name: string, path: string): number | string | undefined {
  const s = optionalScalar(group, name, path);
  if (!s) return undefined;
  if (s.type === "string") return s.value as string;
  if (s.type === "int" || s.type === "int64" || s.type === "float") return s.value as number;
  throw new DomainMappingError(`Expected '${name}' to be a number or a string`, path);
}

/** Builds a setting node; groups/lists conventionally use ':', scalars use '='. */
export function setting(name: string, value: ValueNode): SettingNode {
  return { name, value, assignOp: value.kind === "scalar" ? "=" : ":" };
}

export function group(members: SettingNode[]): GroupNode {
  return { kind: "group", members };
}

export function list(items: ValueNode[], bracket: "(" | "[" = "("): ListNode {
  return { kind: "list", bracket, items };
}

export function stringSetting(name: string, value: string): SettingNode {
  return setting(name, scalar("string", value));
}

export function boolSetting(name: string, value: boolean): SettingNode {
  return setting(name, scalar("bool", value));
}

export function numberSetting(name: string, value: number, type: "int" | "float"): SettingNode {
  return setting(name, scalar(type, value));
}

export function numberListSetting(name: string, values: number[], type: "int" | "float"): SettingNode {
  return setting(name, list(values.map((v) => scalar(type, v))));
}

/** Builds a setting whose value may be a single number or a list of numbers, e.g. scan-mode `ampfactor`. */
export function numberOrListSetting(name: string, value: number | number[], type: "int" | "float"): SettingNode {
  return Array.isArray(value) ? numberListSetting(name, value, type) : numberSetting(name, value, type);
}

export function stringListSetting(name: string, values: string[]): SettingNode {
  return setting(name, list(values.map((v) => scalar("string", v))));
}

/** Builds a setting whose value may be a number or a string, e.g. SoapySDR `gain`. */
export function numberOrStringSetting(name: string, value: number | string): SettingNode {
  if (typeof value === "string") return stringSetting(name, value);
  return numberSetting(name, value, Number.isInteger(value) ? "int" : "float");
}
