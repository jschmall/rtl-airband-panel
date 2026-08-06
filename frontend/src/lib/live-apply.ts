/**
 * `skippedRequiresRestart` from a `reload_diff` response is no longer
 * uniformly "you must restart the systemd unit" -- the fork's
 * `compute_and_apply_diff()` (dynamic_reload branch, src/live_reconfig.cpp)
 * also puts confirmed-but-transient hardware failures (e.g. a retune that
 * didn't reach the radio) into this same array, tagged with the substring
 * "no restart needed" in the message itself. Those just need another
 * `reload_diff` attempt, not a restart -- split them out so the UI doesn't
 * tell the user to restart right above a message saying not to.
 */
export function classifySkippedRequiresRestart(items: string[]): { needsRestart: string[]; retryable: string[] } {
  const needsRestart: string[] = [];
  const retryable: string[] = [];
  for (const item of items) {
    (item.includes("no restart needed") ? retryable : needsRestart).push(item);
  }
  return { needsRestart, retryable };
}
