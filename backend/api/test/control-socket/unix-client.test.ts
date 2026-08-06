import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnixControlSocketClient } from "../../src/control-socket/unix-client.js";

/**
 * Exercises UnixControlSocketClient against a real `node:net` Unix-domain
 * socket server speaking the exact wire protocol the fork's
 * src/control_socket.cpp implements (one JSON object per line in, one JSON
 * object per line out) -- no C++ binary needed, since this layer is purely
 * about socket/JSON framing, which a mock wouldn't actually exercise.
 */
describe("UnixControlSocketClient", () => {
  let dir: string;
  let socketPath: string;
  let server: net.Server | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "control-socket-test-"));
    socketPath = path.join(dir, "instance.sock");
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** Starts a listener that responds to the first line it receives with `responseLine` (or never responds, if omitted). */
  function startServer(onLine: (line: string, conn: net.Socket) => void): Promise<void> {
    return new Promise((resolve) => {
      server = net.createServer((conn) => {
        let buffer = "";
        conn.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const newline = buffer.indexOf("\n");
          if (newline === -1) return;
          onLine(buffer.slice(0, newline), conn);
        });
      });
      server.listen(socketPath, resolve);
    });
  }

  it("returns applied + skippedRequiresRestart on a well-formed ok response", async () => {
    await startServer((line, conn) => {
      expect(JSON.parse(line)).toEqual({ cmd: "reload_diff" });
      conn.end(`${JSON.stringify({ ok: true, applied: ["device[0] centerfreq"], skipped_requires_restart: ["device[0] sample_rate"] })}\n`);
    });

    const client = new UnixControlSocketClient(1000);
    const result = await client.reloadDiff(socketPath);
    expect(result).toEqual({ kind: "applied", applied: ["device[0] centerfreq"], skippedRequiresRestart: ["device[0] sample_rate"] });
  });

  it("returns protocol-error on an ok:false response", async () => {
    await startServer((_line, conn) => {
      conn.end(`${JSON.stringify({ ok: false, error: "no config file path known" })}\n`);
    });

    const client = new UnixControlSocketClient(1000);
    const result = await client.reloadDiff(socketPath);
    expect(result).toEqual({ kind: "protocol-error", message: "no config file path known" });
  });

  it("returns protocol-error on a garbage response line", async () => {
    await startServer((_line, conn) => {
      conn.end("not json at all\n");
    });

    const client = new UnixControlSocketClient(1000);
    const result = await client.reloadDiff(socketPath);
    expect(result.kind).toBe("protocol-error");
  });

  it("returns unreachable when there is no listener at the socket path", async () => {
    const client = new UnixControlSocketClient(1000);
    const result = await client.reloadDiff(path.join(dir, "nothing-here.sock"));
    expect(result).toMatchObject({ kind: "unreachable", reason: "ENOENT" });
  });

  it("returns unreachable on a timeout when the server never responds", async () => {
    await startServer(() => {
      // never respond
    });

    const client = new UnixControlSocketClient(50);
    const result = await client.reloadDiff(socketPath);
    expect(result).toEqual({ kind: "unreachable", reason: "timeout" });
  });
});
