export interface ShutdownDeps {
  poller: { stop: () => Promise<void> };
  statsStore: { close: () => void };
  app: { close: () => Promise<void> };
  exit: (code: number) => void;
}

/**
 * The exact ordering that matters: the poller must fully stop (including any
 * poll cycle already in flight) before the stats DB it writes to is closed,
 * or a still-running insertBatch/prune call throws against an already-closed
 * handle. Extracted from index.ts so this sequence — previously only ever
 * exercised by a real SIGINT/SIGTERM in production — has a fast, direct test.
 */
export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  await deps.poller.stop();
  deps.statsStore.close();
  await deps.app.close();
  deps.exit(0);
}
