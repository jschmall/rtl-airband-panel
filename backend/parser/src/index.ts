export type { ConfigFile, GroupNode, ListNode, ScalarNode, SettingNode, ValueNode } from "./ast.js";
export { parseConfig } from "./parser.js";
export { serializeConfig } from "./serializer.js";
export { toDomain, fromDomain } from "./mapper.js";
export { DomainMappingError } from "./ast-utils.js";
export type {
  Channel,
  Device,
  FileOutput,
  IcecastOutput,
  MixerOutput,
  Output,
  PulseOutput,
  RawFileOutput,
  RtlAirbandConfig,
  UdpStreamOutput,
} from "./domain.js";

import { parseConfig } from "./parser.js";
import { serializeConfig } from "./serializer.js";
import { toDomain, fromDomain } from "./mapper.js";
import type { RtlAirbandConfig } from "./domain.js";

/** Reads an RTLSDR-Airband .conf file's text and produces the JSON domain model. */
export function parseConfigFile(source: string): RtlAirbandConfig {
  return toDomain(parseConfig(source));
}

/** Serializes the JSON domain model back into .conf file text. */
export function serializeConfigFile(config: RtlAirbandConfig): string {
  return serializeConfig(fromDomain(config));
}
