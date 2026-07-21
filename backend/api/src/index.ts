import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { parseCliArgs, HELP_TEXT } from "./cli.js";
import { ConfigStore } from "./config-store.js";
import { InstanceService } from "./instance-service.js";
import { MockSystemdAdapter } from "./systemd/mock-adapter.js";
import { SudoSystemctlAdapter } from "./systemd/sudo-adapter.js";
import { StatsStore } from "./stats/store.js";
import { StatsPoller } from "./stats/poller.js";
import { StatsService } from "./stats/stats-service.js";
import { buildApp } from "./app.js";

let cli;
try {
  cli = parseCliArgs(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error("\nRun with --help for usage.");
  process.exit(1);
}

if (cli.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// dotenv only fills in keys not already present in process.env, so real
// env vars set by the caller (e.g. systemd Environment=) always win over
// a .env file. Missing file is not an error -- it's an optional layer.
//
// dotenv's own default resolves ".env" against process.cwd(), but `npm
// start --workspace=backend/api` runs this file with cwd set to
// backend/api/, not the directory the user invoked npm from. Prefer npm's
// INIT_CWD (the original invocation directory) so a .env dropped next to
// package.json at the repo root -- as the README instructs -- is actually
// found. Falls back to dotenv's own cwd-based default outside of npm.
const defaultEnvPath = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD, ".env") : undefined;
const dotenvResult = loadDotenv({
  quiet: true,
  ...(cli.envFile ? { path: cli.envFile } : defaultEnvPath ? { path: defaultEnvPath } : {}),
});
if (cli.envFile && dotenvResult.error) {
  console.error(`Warning: --env-file '${cli.envFile}' could not be loaded: ${dotenvResult.error.message}`);
}

const config = loadConfig(process.env, cli.overrides);
const configStore = new ConfigStore(config.instancesDir);
const systemd = config.systemdMode === "sudo" ? new SudoSystemctlAdapter(config.unitDir) : new MockSystemdAdapter();
const service = new InstanceService(configStore, systemd, {
  instancesDir: config.instancesDir,
  rtlAirbandBinary: config.rtlAirbandBinary,
});

const statsStore = new StatsStore(config.statsDbPath);
const statsService = new StatsService(configStore, statsStore);

const app = buildApp(service, statsService, { frontendDistPath: config.frontendDistPath });

const poller = new StatsPoller(
  configStore,
  statsStore,
  { intervalMs: config.statsPollIntervalMs, retentionDays: config.statsRetentionDays },
  (instance, err) => app.log.warn({ instance, err }, "failed to poll stats for instance")
);
poller.start();

if (config.systemdMode === "mock") {
  app.log.warn(
    "RTL_PANEL_SYSTEMD_MODE=mock: systemd actions are simulated, not real. Set RTL_PANEL_SYSTEMD_MODE=sudo to control real units."
  );
}

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    poller.stop();
    statsStore.close();
    void app.close().finally(() => process.exit(0));
  });
}
