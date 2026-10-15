import type { WellKnownAuth } from "@aulora/core";
import { resolveSignInMethods } from "@aulora/core";
import { describe, expect, it } from "vitest";

const github: WellKnownAuth["providers"][number] = {
  id: "github",
  type: "oauth",
  displayName: "GitHub",
};

function auth(
  local: WellKnownAuth["local"],
  providers: WellKnownAuth["providers"] = [github],
): WellKnownAuth {
  return { local, providers };
}

describe("resolveSignInMethods", () => {
  it("shows the local form and the provider buttons when both are on", () => {
    expect(resolveSignInMethods(auth({ enabled: true, signup: true }))).toEqual({
      hasProviders: true,
      showLocalForm: true,
      showDivider: true,
      showSignUp: true,
      hasAnyMethod: true,
    });
  });

  it("hides the local form and the divider when local sign-in is off", () => {
    expect(resolveSignInMethods(auth({ enabled: false, signup: true }))).toEqual({
      hasProviders: true,
      showLocalForm: false,
      showDivider: false,
      showSignUp: false,
      hasAnyMethod: true,
    });
  });

  it("drops the sign-up toggle when local signup is closed", () => {
    expect(resolveSignInMethods(auth({ enabled: true, signup: false })).showSignUp).toBe(false);
  });

  it("reports no method when nothing is offered", () => {
    expect(resolveSignInMethods(auth({ enabled: false, signup: false }, [])).hasAnyMethod).toBe(
      false,
    );
  });
});
