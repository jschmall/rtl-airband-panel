/**
 * Mirrors `REDACTED_SECRET` in backend/api/src/secrets.ts -- GET /instances/:name
 * substitutes this exact string for Icecast passwords and rdio-scanner API keys, so
 * the frontend needs to recognize it to know a field is showing a placeholder rather
 * than a real (if short) secret. Must stay byte-for-byte in sync with the backend
 * constant; nothing enforces that automatically since the two packages don't share
 * a runtime dependency here.
 */
export const REDACTED_SECRET_PLACEHOLDER = "••••••••";
