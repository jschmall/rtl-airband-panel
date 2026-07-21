import { parseArgs } from "node:util";
import type { ApiConfig } from "./config.js";

const OPTIONS = {
  "instances-dir": { type: "string" },
  "unit-dir": { type: "string" },
  "rtl-airband-bin": { type: "string" },
  "systemd-mode": { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  "stats-db-path": { type: "string" },
  "stats-poll-interval-ms": { type: "string" },
  "stats-retention-days": { type: "string" },
  "frontend-dist": { type: "string" },
  "env-file": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

export interface CliResult {
  help: boolean;
  /** Explicit --env-file path, if given; undefined means dotenv's own default (.env in the cwd). */
  envFile: string | undefined;
  overrides: Partial<ApiConfig>;
}

/**
 * Command-line flags mirror the RTL_PANEL_* env vars 1:1 (see config.ts) so
 * either can be used interchangeably. Flags take precedence over env vars
 * when both are given -- applied as an overrides layer on top of
 * loadConfig's env-based result, not parsed independently.
 */
export function parseCliArgs(argv: string[]): CliResult {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true });

  const overrides: Partial<ApiConfig> = {};
  if (values["instances-dir"] !== undefined) overrides.instancesDir = values["instances-dir"];
  if (values["unit-dir"] !== undefined) overrides.unitDir = values["unit-dir"];
  if (values["rtl-airband-bin"] !== undefined) overrides.rtlAirbandBinary = values["rtl-airband-bin"];
  if (values["systemd-mode"] !== undefined) overrides.systemdMode = values["systemd-mode"] === "sudo" ? "sudo" : "mock";
  if (values.port !== undefined) overrides.port = Number(values.port);
  if (values.host !== undefined) overrides.host = values.host;
  if (values["stats-db-path"] !== undefined) overrides.statsDbPath = values["stats-db-path"];
  if (values["stats-poll-interval-ms"] !== undefined) overrides.statsPollIntervalMs = Number(values["stats-poll-interval-ms"]);
  if (values["stats-retention-days"] !== undefined) overrides.statsRetentionDays = Number(values["stats-retention-days"]);
  if (values["frontend-dist"] !== undefined) overrides.frontendDistPath = values["frontend-dist"];

  return {
    help: values.help ?? false,
    envFile: values["env-file"],
    overrides,
  };
}

export const HELP_TEXT = `rtl-airband-panel API server

Usage: node dist/index.js [options]

Options:
  --instances-dir <path>        Directory containing per-instance .conf files (default: /etc/rtl-airband-panel/instances)
  --unit-dir <path>             Where systemd unit files are installed (default: /etc/systemd/system)
  --rtl-airband-bin <path>      Binary path used in generated unit files (default: /usr/local/bin/rtl_airband)
  --systemd-mode <mock|sudo>    mock (safe, no real systemctl calls) or sudo (default: mock)
  --port <number>               API listen port (default: 3000)
  --host <address>              API listen host (default: 127.0.0.1)
  --stats-db-path <path>        SQLite file for historical stats samples (default: ~/.rtl-airband-panel/stats.db)
  --stats-poll-interval-ms <n>  How often each instance's stats file is re-read (default: 15000)
  --stats-retention-days <n>    Stats samples older than this are pruned; 0 disables pruning (default: 7)
  --frontend-dist <path>        Where to look for the built frontend to serve (default: frontend/dist)
  --env-file <path>             Load environment variables from this .env file (default: .env in the current directory, if present)
  -h, --help                    Show this help and exit

Every option can also be set via a RTL_PANEL_* environment variable or a
.env file. Precedence, highest first: command-line flags, then real
environment variables, then a .env file, then the defaults above.
`;
