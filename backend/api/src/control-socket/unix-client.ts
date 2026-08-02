import net from "node:net";
import type { ControlSocketClient, ReloadDiffResult } from "./types.js";

/** Error codes from a failed/refused connection attempt -- all mean "couldn't reach the socket", never "the config is bad". */
const UNREACHABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES", "ECONNRESET", "EPIPE"]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

/**
 * Connects to a running instance's dynamic_reload control socket (a Unix
 * domain socket, JSON-lines wire protocol -- see the fork's
 * src/control_socket.cpp) and issues a single `reload_diff` command.
 *
 * Connect-per-request, no pooling: this is a local one-shot IPC call, not a
 * hot path, so there's nothing to gain from keeping a connection open
 * between saves.
 */
export class UnixControlSocketClient implements ControlSocketClient {
  constructor(private readonly timeoutMs = 8000) {}

  async reloadDiff(socketPath: string): Promise<ReloadDiffResult> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ReloadDiffResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };

      const socket = net.createConnection(socketPath);
      let buffer = "";

      const timer = setTimeout(() => {
        finish({ kind: "unreachable", reason: "timeout" });
      }, this.timeoutMs);

      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ cmd: "reload_diff" })}\n`);
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        finish(parseResponseLine(line));
      });

      socket.on("error", (err: NodeJS.ErrnoException) => {
        const code = err.code ?? "UNKNOWN";
        if (UNREACHABLE_CODES.has(code)) {
          finish({ kind: "unreachable", reason: code });
        } else {
          finish({ kind: "unreachable", reason: err.message });
        }
      });

      socket.on("close", () => {
        finish({ kind: "unreachable", reason: "connection closed before a response line arrived" });
      });
    });
  }
}

function parseResponseLine(line: string): ReloadDiffResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "protocol-error", message: `non-JSON response line: ${line}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "protocol-error", message: `expected a JSON object, got: ${line}` };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.ok === true && isStringArray(obj.applied) && isStringArray(obj.skipped_requires_restart)) {
    return { kind: "applied", applied: obj.applied, skippedRequiresRestart: obj.skipped_requires_restart };
  }
  if (obj.ok === false && typeof obj.error === "string") {
    return { kind: "protocol-error", message: obj.error };
  }
  return { kind: "protocol-error", message: `unrecognized response shape: ${line}` };
}
