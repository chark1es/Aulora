import { describe, expect, it } from "vitest";
import { clientVersionState, compareClientVersions } from "../src/client-version";

describe("compareClientVersions", () => {
  it("orders stable versions numerically", () => {
    expect(compareClientVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareClientVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareClientVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats a prerelease as older than its stable version", () => {
    expect(compareClientVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareClientVersions("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0);
  });

  it("returns null when either side is not a version", () => {
    expect(compareClientVersions("development", "1.0.0")).toBeNull();
    expect(compareClientVersions("1.0.0", "")).toBeNull();
  });
});

describe("clientVersionState", () => {
  it("stays ok when no policy is advertised", () => {
    expect(clientVersionState("1.0.0", null)).toBe("ok");
    expect(clientVersionState("1.0.0", {})).toBe("ok");
    expect(clientVersionState("1.0.0", { minClientVersion: null })).toBe("ok");
  });

  it("requires an update below the minimum version", () => {
    expect(clientVersionState("1.0.0", { minClientVersion: "1.1.0" })).toBe("required");
    expect(clientVersionState("1.1.0", { minClientVersion: "1.1.0" })).toBe("ok");
    expect(clientVersionState("1.2.0", { minClientVersion: "1.1.0" })).toBe("ok");
  });

  it("recommends an update below the recommended version", () => {
    expect(clientVersionState("1.0.0", { recommendedClientVersion: "1.1.0" })).toBe("recommended");
    expect(clientVersionState("1.1.0", { recommendedClientVersion: "1.1.0" })).toBe("ok");
  });

  it("lets the required gate win over the recommended notice", () => {
    expect(
      clientVersionState("1.0.0", {
        minClientVersion: "1.1.0",
        recommendedClientVersion: "1.2.0",
      }),
    ).toBe("required");
  });

  it("ignores malformed policy values", () => {
    expect(clientVersionState("1.0.0", { minClientVersion: "next" })).toBe("ok");
    expect(clientVersionState("1.0.0", { recommendedClientVersion: " " })).toBe("ok");
  });

  it("does not block a client whose version cannot be compared", () => {
    expect(clientVersionState("development", { minClientVersion: "1.1.0" })).toBe("ok");
  });
});
