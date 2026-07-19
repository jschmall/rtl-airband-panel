import { loadConfig } from "./config.js";
import { ConfigStore } from "./config-store.js";
import { InstanceService } from "./instance-service.js";
import { MockSystemdAdapter } from "./systemd/mock-adapter.js";
import { SudoSystemctlAdapter } from "./systemd/sudo-adapter.js";
import { StatsStore } from "./stats/store.js";
import { StatsPoller } from "./stats/poller.js";
import { StatsService } from "./stats/stats-service.js";
import { buildApp } from "./app.js";

const config = loadConfig();
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
