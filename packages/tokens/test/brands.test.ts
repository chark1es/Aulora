import { describe, expect, it } from "vitest";
import { brandIcons, providerBrand, providerButtonLabel } from "../src";

describe("providerBrand", () => {
  it("recognises the built-in providers by id", () => {
    expect(providerBrand("google", "Continue with Google")).toBe("google");
    expect(providerBrand("github", "GitHub")).toBe("github");
    expect(providerBrand("microsoft", "Microsoft")).toBe("microsoft");
    expect(providerBrand("apple", "Apple")).toBe("apple");
  });

  it("recognises common aliases and display names", () => {
    expect(providerBrand("azure-ad", "Acme directory")).toBe("microsoft");
    expect(providerBrand("acme", "Google Workspace SSO")).toBe("google");
    expect(providerBrand("acme", "Entra ID")).toBe("microsoft");
  });

  it("returns null for a provider with no shipped brand mark", () => {
    expect(providerBrand("keycloak", "Keycloak")).toBeNull();
    expect(providerBrand("oidc", "Acme SSO")).toBeNull();
  });

  it("keeps the operator's name when there is no brand", () => {
    expect(providerButtonLabel("keycloak", "Keycloak")).toBe("Keycloak");
    expect(providerButtonLabel("google", "Company Google")).toBe("Google");
  });
});

describe("brandIcons", () => {
  it("draws every mark in the shared 24px box", () => {
    for (const icon of Object.values(brandIcons)) {
      expect(icon.paths.length).toBeGreaterThan(0);
      for (const path of icon.paths) {
        expect(path.d.length).toBeGreaterThan(0);
        expect(path.fill.length).toBeGreaterThan(0);
      }
    }
  });
});
