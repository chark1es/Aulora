import { ALL_PERMISSIONS, normalizeServerUrl, Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";

describe("@aulora/core package exports", () => {
  it("resolves the public entry point", () => {
    expect(normalizeServerUrl("chat.acme.com")).toBe("https://chat.acme.com");
    expect(Permission.Administrator > 0n).toBe(true);
    expect(ALL_PERMISSIONS > 0n).toBe(true);
  });
});
