import type { LogLine } from "./types.js";

/** Parses one `journalctl -o short-iso` line into {timestamp, message}. */
export function parseShortIsoLine(line: string): LogLine {
  const match = /^(\S+)\s+(.*)$/.exec(line);
  return match ? { timestamp: match[1]!, message: match[2]! } : { timestamp: "", message: line };
}
