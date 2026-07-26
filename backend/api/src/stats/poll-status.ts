export interface PollStatus {
  /** When this instance's stats file was last read without error, if ever. */
  lastSuccessMs?: number;
  /** When the most recent poll error happened, if the instance currently has one. */
  lastErrorMs?: number;
  /** The most recent poll error's message, if it currently has one. Cleared by the next successful poll. */
  lastError?: string;
}

/**
 * Shared between StatsPoller (which records) and StatsService (which
 * exposes it via the API) so a silently-broken stats pipeline for one
 * instance among many is visible to a client instead of only in server
 * logs. In-memory only — a restart just means the poller re-establishes
 * status on its next cycle, which is fine; nothing here needs to survive
 * a restart.
 */
export class PollStatusTracker {
  private readonly status = new Map<string, PollStatus>();

  recordSuccess(instance: string, atMs: number): void {
    this.status.set(instance, { lastSuccessMs: atMs });
  }

  recordError(instance: string, atMs: number, message: string): void {
    const lastSuccessMs = this.status.get(instance)?.lastSuccessMs;
    this.status.set(instance, lastSuccessMs === undefined ? { lastErrorMs: atMs, lastError: message } : { lastSuccessMs, lastErrorMs: atMs, lastError: message });
  }

  get(instance: string): PollStatus {
    return this.status.get(instance) ?? {};
  }
}
