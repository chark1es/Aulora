import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.2.0" }));

import {
  MOBILE_CLIENT_VERSION,
  MOBILE_STORE_URL,
  mobileStoreUrl,
  mobileVersionState,
} from "../src/lib/client-version";

describe("mobile client version", () => {
  it("uses the native application version", () => {
    expect(MOBILE_CLIENT_VERSION).toBe("1.2.0");
  });

  it("requires an update below the server minimum", () => {
    expect(mobileVersionState({ minClientVersion: "1.3.0" })).toBe("required");
    expect(mobileVersionState({ minClientVersion: "1.2.0" })).toBe("ok");
    expect(mobileVersionState(null)).toBe("ok");
  });

  it("links to the beta channel for each platform", () => {
    expect(mobileStoreUrl("ios")).toContain("testflight.apple.com");
    expect(mobileStoreUrl("android")).toContain("play.google.com");
    expect(MOBILE_STORE_URL).toContain("play.google.com");
  });
});
