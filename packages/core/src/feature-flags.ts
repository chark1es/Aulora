/**
 * Server-advertised kill switches. Every flag defaults to `false`, which means
 * the corresponding feature stays on; an operator opts out by setting it to
 * `true`. The names describe what is disabled so a missing field can never
 * accidentally turn a feature off.
 */
export const FEATURE_FLAG_NAMES = [
  "disableNewCallTransport",
  "disablePipVideo",
  "disableAutoDegrade",
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

export type FeatureFlags = Readonly<Record<FeatureFlagName, boolean>>;

/** Safe defaults: every feature is enabled. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  disableNewCallTransport: false,
  disablePipVideo: false,
  disableAutoDegrade: false,
};

/**
 * Normalizes a `server.publicConfig.features` payload (or a persisted
 * `server.settings` object). Unknown keys are dropped and non-boolean values
 * fall back to the safe default, so a malformed setting cannot disable a
 * feature and a newer server can add flags an older client does not know.
 */
export function resolveFeatureFlags(value: unknown): FeatureFlags {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const flags = { ...DEFAULT_FEATURE_FLAGS };
  for (const name of FEATURE_FLAG_NAMES) {
    const candidate = record[name];
    if (typeof candidate === "boolean") {
      flags[name] = candidate;
    }
  }
  return flags;
}
