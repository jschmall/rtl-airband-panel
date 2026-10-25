import { createContext, useContext } from "react";
import type { AirbandBuild } from "../api/client.js";
import { hasFeature } from "../lib/airband-build.js";

const AirbandBuildContext = createContext<AirbandBuild | null>(null);

/** The rtl_airband build of the instance being edited (null: loading, failed, or a new instance). */
export const AirbandBuildProvider = AirbandBuildContext.Provider;

/** Whether the edited instance's rtl_airband supports `feature`; true with no feature, or when the build is unknown. */
export function useForkFeature(feature: string | undefined): boolean {
  const build = useContext(AirbandBuildContext);
  return feature === undefined || hasFeature(build, feature);
}
