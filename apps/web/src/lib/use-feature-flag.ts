import { type FeatureFlagName, resolveFeatureFlags } from "@aulora/core";
import { useQuery } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * Reads one server-advertised kill switch. The value is the flag's own
 * boolean: `true` means the feature is disabled, matching the `disable*` name.
 * Before the config loads, and when the server does not advertise the flag, it
 * is `false` so the feature stays available.
 *
 * Feature owners wire this at their call site; the mechanism itself does not
 * change any behavior.
 */
export function useFeatureFlag(name: FeatureFlagName): boolean {
  const config = useQuery(api.server.publicConfig, {});
  return resolveFeatureFlags(config?.features)[name];
}
