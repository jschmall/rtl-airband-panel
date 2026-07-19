import type { ConfigStore } from "../config-store.js";
import { assertValidInstanceName } from "../instance-name.js";
import { InstanceNotFoundError } from "../instance-service.js";
import type { HistoryPoint, HistoryQuery, LatestSample, StatsStore } from "./store.js";

export class StatsService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly statsStore: StatsStore
  ) {}

  async latest(name: string): Promise<LatestSample[]> {
    await this.requireExists(name);
    return this.statsStore.latest(name);
  }

  async history(name: string, query: HistoryQuery): Promise<HistoryPoint[]> {
    await this.requireExists(name);
    return this.statsStore.history(name, query);
  }

  private async requireExists(name: string): Promise<void> {
    assertValidInstanceName(name);
    if (!(await this.configStore.exists(name))) throw new InstanceNotFoundError(name);
  }
}
