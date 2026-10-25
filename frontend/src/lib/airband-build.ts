import type { AirbandBuild } from "../api/client.js";

/**
 * Whether a fork feature can be used: true unless the instance is known to
 * run a build without it. An unidentified build (kind "unknown") or one
 * still loading (null) locks nothing.
 */
export function hasFeature(build: AirbandBuild | null, feature: string): boolean {
  if (!build || build.kind === "unknown") return true;
  return build.features.includes(feature);
}

/** Short label for the instance header, e.g. "rtl_airband v6.5.0 (fork)". */
export function buildLabel(build: AirbandBuild): string {
  const version = build.version ? ` ${build.version}` : "";
  const kind = build.kind === "fork" ? " (fork)" : build.kind === "stock" ? " (stock)" : "";
  return `rtl_airband${version}${kind}`;
}
