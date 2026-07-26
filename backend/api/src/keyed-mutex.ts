/**
 * Serializes async operations that share a key, so two concurrent requests
 * touching the same instance (e.g. two overlapping saves, or two creates
 * racing for the same name) can never both act on the same
 * check-then-write window at once. This app is a single Node process (see
 * CLAUDE.md: one systemd unit per instance, managed by one panel process),
 * so an in-process mutex is a complete fix for that process, not a partial
 * one — there's no second process or host to also coordinate with.
 *
 * Operations for *different* keys still run fully concurrently; only same-key
 * operations queue behind each other, in call order.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    const normalized = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(key, normalized);
    void normalized.finally(() => {
      if (this.tails.get(key) === normalized) this.tails.delete(key);
    });
    return result;
  }
}
