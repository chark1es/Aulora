import { describe, expect, it } from "vitest";
import { providerInitial, resolveSignInMethods } from "../src";

describe("providerInitial", () => {
  it("upper-cases the first letter of the name", () => {
    expect(providerInitial("github")).toBe("G");
    expect(providerInitial("  Keycloak")).toBe("K");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(providerInitial("")).toBe("?");
    expect(providerInitial("   ")).toBe("?");
  });

  it("keeps a whole code point", () => {
    expect(providerInitial("😀 Team")).toBe("😀");
  });
});

describe("resolveSignInMethods", () => {
  const providers = [{ id: "github", displayName: "GitHub", type: "oauth" as const }];

  it("offers only providers when local sign-in is off", () => {
    const methods = resolveSignInMethods({ local: { enabled: false, signup: false }, providers });
    expect(methods.showLocalForm).toBe(false);
    expect(methods.hasProviders).toBe(true);
    expect(methods.showDivider).toBe(false);
  });

  it("separates the form and the providers with a divider", () => {
    const methods = resolveSignInMethods({ local: { enabled: true, signup: true }, providers });
    expect(methods.showDivider).toBe(true);
    expect(methods.showSignUp).toBe(true);
  });
});
