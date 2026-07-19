import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore } from "../src/config-store.js";
import { InstanceService } from "../src/instance-service.js";
import { MockSystemdAdapter } from "../src/systemd/mock-adapter.js";
import { StatsStore } from "../src/stats/store.js";
import { StatsService } from "../src/stats/stats-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = path.join(here, "../../../fixtures/151719.conf");
export const FIXTURE_INSTANCE_NAME = "rtl_151719";

export async function makeScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "rtl-panel-test-"));
}

export async function cleanupScratchDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function seedFixture(instancesDir: string, name = FIXTURE_INSTANCE_NAME): Promise<void> {
  await copyFile(FIXTURE_PATH, path.join(instancesDir, `${name}.conf`));
}

export interface TestHarness {
  instancesDir: string;
  configStore: ConfigStore;
  systemd: MockSystemdAdapter;
  service: InstanceService;
  statsStore: StatsStore;
  statsService: StatsService;
}

export async function buildHarness(): Promise<TestHarness> {
  const instancesDir = await makeScratchDir();
  const configStore = new ConfigStore(instancesDir);
  const systemd = new MockSystemdAdapter();
  const service = new InstanceService(configStore, systemd, {
    instancesDir,
    rtlAirbandBinary: "/usr/local/bin/rtl_airband",
  });
  const statsStore = new StatsStore(":memory:");
  const statsService = new StatsService(configStore, statsStore);
  return { instancesDir, configStore, systemd, service, statsStore, statsService };
}

export async function teardownHarness(h: TestHarness): Promise<void> {
  h.statsStore.close();
  await cleanupScratchDir(h.instancesDir);
}
