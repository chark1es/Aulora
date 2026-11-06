import { createServerProfile, type WellKnown } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { isAbsoluteServerUrl, profileUrlProblem } from "../src/lib/session-profile";

function wellKnown(overrides: Partial<WellKnown> = {}): WellKnown {
  return {
    name: "Acme",
    version: "0.4.0",
    apiVersion: 1,
    convexUrl: "https://convex.acme.com",
    siteUrl: "https://chat.acme.com",
    iconSeed: "aulora:server:acme",
    auth: {
      local: { enabled: true, signup: true },
      providers: [],
    },
    ...overrides,
  };
}

describe("isAbsoluteServerUrl", () => {
  it("accepts absolute http and https addresses", () => {
    expect(isAbsoluteServerUrl("https://chat.acme.com")).toBe(true);
    expect(isAbsoluteServerUrl("https://chat.acme.com/aulora")).toBe(true);
    expect(isAbsoluteServerUrl("http://192.168.1.5:3210")).toBe(true);
    expect(isAbsoluteServerUrl("http://localhost:3210")).toBe(true);
  });

  it("rejects what the clients cannot use", () => {
    // `ConvexReactClient` throws "Provided address was not an absolute URL."
    // for the first two, during render.
    expect(isAbsoluteServerUrl("chat.acme.com")).toBe(false);
    expect(isAbsoluteServerUrl("/convex")).toBe(false);
    expect(isAbsoluteServerUrl("")).toBe(false);
    expect(isAbsoluteServerUrl("ftp://chat.acme.com")).toBe(false);
    expect(isAbsoluteServerUrl("https://")).toBe(false);
  });
});

describe("profileUrlProblem", () => {
  it("passes a profile the server described completely", () => {
    expect(profileUrlProblem(createServerProfile("chat.acme.com", wellKnown()))).toBeNull();
  });

  it("names a scheme-less Convex address", () => {
    const profile = createServerProfile(
      "chat.acme.com",
      wellKnown({ convexUrl: "convex.acme.com" }),
    );

    expect(profileUrlProblem(profile)).toBe("convexUrl");
  });

  it("names a relative site address", () => {
    const profile = createServerProfile("chat.acme.com", wellKnown({ siteUrl: "/api/auth" }));

    expect(profileUrlProblem(profile)).toBe("siteUrl");
  });

  it("names a hand-edited base address", () => {
    const profile = { ...createServerProfile("chat.acme.com", wellKnown()), baseUrl: "nope" };

    expect(profileUrlProblem(profile)).toBe("baseUrl");
  });
});
