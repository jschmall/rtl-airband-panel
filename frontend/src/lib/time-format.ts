/** e.g. "3h 22m", "5d 1h", "<1m". "—" if `sinceIso` is missing/unparseable/in the future. */
export function formatUptime(sinceIso?: string): string {
  if (!sinceIso) return "—";
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return "—";
  const totalSeconds = Math.floor((Date.now() - since) / 1000);
  if (totalSeconds < 0) return "—";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

/** e.g. "2026-07-31 14:03", in the browser's local time zone. "Never" if `iso` is missing/unparseable. */
export function formatDateTime(iso?: string): string {
  if (!iso) return "Never";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "Never";

  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
