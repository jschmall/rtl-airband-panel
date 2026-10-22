/** Shared auto-refresh cadence for anything polling the API in the background (instance list/health, stats). */
export const AUTO_REFRESH_MS = 20_000;

/** Background refresh while the /api/ws push channel is connected -- a safety net, since changes arrive as pushes. */
export const LIVE_SAFETY_REFRESH_MS = 60_000;
