import type { ControlSocketClient, ReloadDiffResult } from "./types.js";

/**
 * Records every call it receives instead of opening a real socket, mirroring
 * MockSystemdAdapter's shape. Seed a socket path's result before exercising
 * a test; an unseeded path defaults to "unreachable" (ENOENT) so tests that
 * don't care about live-apply still get graceful-degradation behavior for
 * free, same as a fresh instance with nothing listening yet.
 */
export class MockControlSocketClient implements ControlSocketClient {
  readonly calls: string[] = [];
  readonly results = new Map<string, ReloadDiffResult>();

  async reloadDiff(socketPath: string): Promise<ReloadDiffResult> {
    this.calls.push(`reload-diff ${socketPath}`);
    return this.results.get(socketPath) ?? { kind: "unreachable", reason: "ENOENT" };
  }
}
