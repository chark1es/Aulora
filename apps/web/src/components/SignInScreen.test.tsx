import type { ServerProfile, WellKnownAuth } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AuthActions } from "../lib/auth-client";
import { SignInScreen } from "./SignInScreen";

const providers: WellKnownAuth["providers"] = [
  { id: "github", type: "oauth", displayName: "GitHub" },
  {
    id: "keycloak",
    type: "oidc",
    displayName: "Keycloak",
    issuer: "https://idp.acme.com/realms/acme",
    discoveryUrl: "https://idp.acme.com/realms/acme/.well-known/openid-configuration",
    clientId: "aulora",
    scopes: ["openid", "email"],
  },
];

function makeProfile(local: WellKnownAuth["local"]): ServerProfile {
  return {
    id: "https://chat.acme.com",
    baseUrl: "https://chat.acme.com",
    name: "Acme Chat",
    iconSeed: "aulora:server:acme",
    version: "0.1.0",
    apiVersion: 1,
    convexUrl: "https://convex.acme.com",
    siteUrl: "https://chat.acme.com",
    auth: { local, providers },
    addedAt: 0,
  };
}

function fakeActions(): AuthActions {
  return {
    signInEmail: vi.fn(async () => ({ error: null })),
    signUpEmail: vi.fn(async () => ({ error: null })),
    signInSocial: vi.fn(async () => ({ error: null })),
    signInOAuth2: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
}

describe("SignInScreen", () => {
  it("renders exactly the providers from the well-known and the local form", () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Keycloak" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create an account/ })).toBeNull();
  });

  it("hides the local form when local auth is disabled", () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: false, signup: false })}
        actions={fakeActions()}
      />,
    );

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Keycloak" })).toBeInTheDocument();
  });

  it("signs in through the generic OIDC action for an oidc provider", async () => {
    const actions = fakeActions();
    const user = userEvent.setup();
    render(
      <SignInScreen profile={makeProfile({ enabled: true, signup: false })} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue with Keycloak" }));

    await waitFor(() =>
      expect(actions.signInOAuth2).toHaveBeenCalledWith({
        providerId: "keycloak",
        callbackURL: expect.any(String),
      }),
    );
  });

  it("uses signIn.social for a built-in oauth provider", async () => {
    const actions = fakeActions();
    const user = userEvent.setup();
    render(
      <SignInScreen profile={makeProfile({ enabled: true, signup: false })} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    await waitFor(() =>
      expect(actions.signInSocial).toHaveBeenCalledWith({
        provider: "github",
        callbackURL: expect.any(String),
      }),
    );
  });

  it("shows the sign-up toggle only when signup is enabled", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: true })}
        actions={fakeActions()}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Create an account" });
    await user.click(toggle);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });
});
