import path from "node:path";

/**
 * Instance names become filenames and systemd unit names, both used in
 * shell/file-path contexts elsewhere in this package. Restrict to a safe
 * slug so nothing derived from a name can ever escape its directory or
 * break out of a systemctl argument, regardless of how it reached here
 * (HTTP path param, existing filename on disk, etc).
 */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidInstanceNameError extends Error {
  constructor(name: string) {
    super(`Invalid instance name '${name}': must match ${SAFE_NAME}`);
    this.name = "InvalidInstanceNameError";
  }
}

export function assertValidInstanceName(name: string): void {
  if (!SAFE_NAME.test(name)) {
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
