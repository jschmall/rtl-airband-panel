export type ScalarType = "int" | "int64" | "float" | "bool" | "string";

export interface ScalarNode {
  kind: "scalar";
  type: ScalarType;
  value: number | boolean | string;
  /** Original literal source text, e.g. "151.780", "5.0", "true", '"nfm"'. */
  raw: string;
}

export interface GroupNode {
  kind: "group";
  members: SettingNode[];
}

export interface ListNode {
  kind: "list";
  /** '(' for a libconfig list (heterogeneous), '[' for an array (homogeneous). */
  bracket: "(" | "[";
  items: ValueNode[];
}

export type ValueNode = ScalarNode | GroupNode | ListNode;

export interface SettingNode {
  name: string;
  value: ValueNode;
  /** Original assignment operator used in source, preserved for round-trip fidelity. */
  assignOp: "=" | ":";
}

/** The root of a config file is an implicit, brace-less group of settings. */
export interface ConfigFile {
  members: SettingNode[];
}

export function scalar(type: ScalarType, value: number | boolean | string, raw?: string): ScalarNode {
  return { kind: "scalar", type, value, raw: raw ?? formatScalarRaw(type, value) };
}

export function formatScalarRaw(type: ScalarType, value: number | boolean | string): string {
  switch (type) {
    case "bool":
      return value ? "true" : "false";
    case "string":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "int":
    case "int64":
      return String(value);
    case "float": {
      const n = Number(value);
      // libconfig floats always contain a decimal point.
      return Number.isInteger(n) ? `${n}.0` : String(n);
    }
  }
}
