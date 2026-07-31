import path from "node:path";

/**
 * Instance names become filenames and systemd unit names, both used in
 * shell/file-path contexts elsewhere in this package. Restrict to a safe
 * slug so nothing derived from a name can ever escape its directory or
 * break out of a systemctl argument, regardless of how it reached here
 * (HTTP path param, existing filename on disk, etc).
 */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Static sibling routes registered alongside `/instances/:name` (e.g.
 * `/instances/export`, `/instances/restart-pending`) — Fastify's router
 * always prefers a literal match over a param route at the same depth, so
 * these are already unambiguous today, but an instance actually named one of
 * these would become permanently unreachable through `/instances/:name`
 * (shadowed by the static route) the moment such a route existed. Reserved
 * outright so that can never happen, regardless of what routes get added later.
 */
const RESERVED_NAMES = new Set(["export", "import", "restart-pending", "health"]);

export class InvalidInstanceNameError extends Error {
  constructor(name: string) {
    super(`Invalid instance name '${name}': must match ${SAFE_NAME} and not be a reserved name (${[...RESERVED_NAMES].join(", ")})`);
    this.name = "InvalidInstanceNameError";
  }
}

export function assertValidInstanceName(name: string): void {
  if (!SAFE_NAME.test(name) || RESERVED_NAMES.has(name)) {
    throw new InvalidInstanceNameError(name);
  }
}

export function instanceNameFromConfFilename(filename: string): string | undefined {
  if (!filename.endsWith(".conf")) return undefined;
  const name = filename.slice(0, -".conf".length);
  return SAFE_NAME.test(name) ? name : undefined;
}

export function confFilePath(instancesDir: string, name: string): string {
  assertValidInstanceName(name);
  return path.join(instancesDir, `${name}.conf`);
}

export function unitFileName(name: string): string {
  assertValidInstanceName(name);
  return `${name}.service`;
}

export function unitFilePath(unitDir: string, name: string): string {
  assertValidInstanceName(name);
  return path.join(unitDir, unitFileName(name));
}
