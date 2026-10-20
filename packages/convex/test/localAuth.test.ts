import { describe, expect, it } from "vitest";
import {
  type AuthProviderToggles,
  type Env,
  hasOtherSignInProvider,
  resolveLocalAuthEnabled,
} from "../convex/lib/env";

const GITHUB: Env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" };
const OIDC: Env = {
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_DISCOVERY_URL: "https://idp.example.com/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
};

describe("resolveLocalAuthEnabled", () => {
  it("defaults to enabled", () => {
    expect(resolveLocalAuthEnabled({})).toEqual({ enabled: true, lockoutPrevented: false });
  });

  it("honors AUTH_LOCAL_ENABLED=false once another provider is configured", () => {
    expect(resolveLocalAuthEnabled({ ...GITHUB, AUTH_LOCAL_ENABLED: "false" })).toEqual({
      enabled: false,
      lockoutPrevented: false,
    });
  });

  it("refuses to disable local sign-in when nothing else is configured", () => {
    expect(resolveLocalAuthEnabled({ AUTH_LOCAL_ENABLED: "false" })).toEqual({
      enabled: true,
      lockoutPrevented: true,
    });
  });

  it("refuses when the only other provider is switched off", () => {
    const toggles: AuthProviderToggles = { github: false, local: false };
    expect(resolveLocalAuthEnabled({ ...GITHUB, AUTH_LOCAL_ENABLED: "false" }, toggles)).toEqual({
      enabled: true,
      lockoutPrevented: true,
    });
  });

  it("lets the instance setting override the env, both ways", () => {
    expect(resolveLocalAuthEnabled({ AUTH_LOCAL_ENABLED: "false" }, { local: true })).toEqual({
      enabled: true,
      lockoutPrevented: false,
    });
    expect(resolveLocalAuthEnabled({}, { local: false })).toEqual({
      enabled: true,
      lockoutPrevented: true,
    });
    expect(resolveLocalAuthEnabled(GITHUB, { local: false })).toEqual({
      enabled: false,
      lockoutPrevented: false,
    });
  });
});

describe("hasOtherSignInProvider", () => {
  it("is false with no credentials or an incomplete pair", () => {
    expect(hasOtherSignInProvider({})).toBe(false);
    expect(hasOtherSignInProvider({ GITHUB_CLIENT_ID: "id" })).toBe(false);
  });

  it("counts a configured OIDC provider and the social ones", () => {
    expect(hasOtherSignInProvider(GITHUB)).toBe(true);
    expect(hasOtherSignInProvider(OIDC)).toBe(true);
  });

  it("respects the per-provider toggles", () => {
    expect(hasOtherSignInProvider(GITHUB, { github: false })).toBe(false);
    expect(hasOtherSignInProvider(OIDC, { oidc: false })).toBe(false);
    expect(hasOtherSignInProvider(GITHUB, { google: false })).toBe(true);
  });
});
