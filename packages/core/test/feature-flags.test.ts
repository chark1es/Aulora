import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_NAMES,
  resolveFeatureFlags,
} from "../src/feature-flags";

describe("feature flags", () => {
  it("defaults every disable flag to false so features stay on", () => {
    expect(resolveFeatureFlags(undefined)).toEqual(DEFAULT_FEATURE_FLAGS);
    expect(resolveFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS);
    for (const name of FEATURE_FLAG_NAMES) {
      expect(DEFAULT_FEATURE_FLAGS[name]).toBe(false);
    }
  });

  it("keeps explicit boolean values", () => {
    expect(resolveFeatureFlags({ disablePipVideo: true })).toMatchObject({
      disablePipVideo: true,
      disableNewCallTransport: false,
    });
  });

  it("drops unknown keys and malformed values", () => {
    expect(
      resolveFeatureFlags({
        disablePipVideo: "yes",
        disableAutoDegrade: 1,
        unknownFlag: true,
      }),
    ).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});
