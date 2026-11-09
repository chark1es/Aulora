import { describe, expect, it } from "vitest";
import { resolveSignInMethods } from "../src";

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
