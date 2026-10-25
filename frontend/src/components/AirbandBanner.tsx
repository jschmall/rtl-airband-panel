import type { AirbandBuild } from "../api/client.js";

const FORK_URL = "https://github.com/jschmall/RTLSDR-Airband";

/** Explains what's limited when an instance doesn't run the jschmall fork; nothing for the fork itself. */
export function AirbandBanner({ build }: { build: AirbandBuild | null }) {
  if (!build || build.kind === "fork") return null;
  if (build.kind === "stock") {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300" role="status">
        <p className="font-medium">
          This instance runs a stock rtl_airband{build.version ? ` (${build.version})` : ""}, not the{" "}
          <a href={FORK_URL} target="_blank" rel="noreferrer" className="underline">
            jschmall fork
          </a>
          .
        </p>
        <p className="mt-1 text-amber-200/90">
          The basics work. Fork-only features are limited: saving restarts the instance instead of applying live, the Hardware page has no live
          readings, and fork-only settings are ignored or refused. To use them, point this instance at the fork (the panel's release bundles it).
        </p>
        <p className="mt-1 font-mono text-xs text-amber-200/70">{build.binary}</p>
      </div>
    );
  }
  return (
    <div className="rounded border border-slate-600 bg-slate-800/50 p-3 text-sm text-slate-300" role="status">
      <p>
        {build.basis === "not-runnable"
          ? `Couldn't run ${build.binary} to see which rtl_airband this instance uses.`
          : `Couldn't tell whether ${build.binary}${build.version ? ` (${build.version})` : ""} is the jschmall fork.`}{" "}
        Fork-only features stay available, but may not work if it isn't.
      </p>
    </div>
  );
}
