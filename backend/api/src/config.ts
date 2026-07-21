import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// backend/api/dist/config.js -> repo root -> frontend/dist
const DEFAULT_FRONTEND_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../frontend/dist");

export interface ApiConfig {
  /** Directory containing per-instance .conf files. */
  instancesDir: string;
  /** Directory system-level unit files are installed into. */
  unitDir: string;
  /** Path to the rtl_airband binary referenced by generated unit files. */
  rtlAirbandBinary: string;
  /** "mock" logs systemd actions without touching the system; "sudo" shells out for real. */
  systemdMode: "mock" | "sudo";
  /**
   * In "sudo" mode, SudoSystemctlAdapter refuses to act on any unit whose
   * name doesn't start with this prefix -- e.g. "rtl_" if all your
   * instances are named that way. Empty string (the default) means no
   * extra restriction beyond the existing instance-name charset check, so
   * instances can be named however you like out of the box; set this (and
   * a matching sudoers glob, see deploy/rtl-airband-panel.sudoers) if you
   * want real unit-identity scoping for the sudo grant.
   */
  sudoUnitNamePrefix: string;
  port: number;
  host: string;
  /** SQLite file the stats poller writes historical samples to. */
  statsDbPath: string;
  /** How often to re-read each instance's stats file. */
  statsPollIntervalMs: number;
  /** Samples older than this are pruned on each poll cycle. 0 or negative disables pruning (keep forever). */
  statsRetentionDays: number;
  /** Directory to serve the built frontend from, if it exists (see static.ts). Doesn't need to exist -- absent means dev mode via a separate Vite server. */
  frontendDistPath: string;
}

/**
 * `env` is expected to already reflect any loaded .env file (dotenv only
 * fills in keys not already set, so real env vars naturally win over a
 * .env file). `overrides` is the CLI-flags layer (see cli.ts), applied on
 * top so a command-line flag always wins over both.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<ApiConfig> = {}): ApiConfig {
  const base: ApiConfig = {
    instancesDir: env.RTL_PANEL_INSTANCES_DIR ?? "/etc/rtl-airband-panel/instances",
    unitDir: env.RTL_PANEL_UNIT_DIR ?? "/etc/systemd/system",
    rtlAirbandBinary: env.RTL_PANEL_RTL_AIRBAND_BIN ?? "/usr/local/bin/rtl_airband",
    systemdMode: env.RTL_PANEL_SYSTEMD_MODE === "sudo" ? "sudo" : "mock",
    sudoUnitNamePrefix: env.RTL_PANEL_SUDO_UNIT_PREFIX ?? "",
    port: env.RTL_PANEL_PORT ? Number(env.RTL_PANEL_PORT) : 3000,
    host: env.RTL_PANEL_HOST ?? "127.0.0.1",
    statsDbPath: env.RTL_PANEL_STATS_DB_PATH ?? path.join(os.homedir(), ".rtl-airband-panel", "stats.db"),
    statsPollIntervalMs: env.RTL_PANEL_STATS_POLL_INTERVAL_MS ? Number(env.RTL_PANEL_STATS_POLL_INTERVAL_MS) : 15_000,
    statsRetentionDays: env.RTL_PANEL_STATS_RETENTION_DAYS ? Number(env.RTL_PANEL_STATS_RETENTION_DAYS) : 7,
    frontendDistPath: env.RTL_PANEL_FRONTEND_DIST ?? DEFAULT_FRONTEND_DIST,
  };
  return { ...base, ...overrides };
}
