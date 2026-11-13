import type { ServerProfile, WellKnownAuth } from "@aulora/core";
import { notifyAuthError } from "@aulora/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthActions } from "../lib/auth-client";
import { beginOAuth, storeAuthHandoffError } from "../lib/oauth-start";
import { SignInScreen } from "./SignInScreen";

vi.mock("convex/react", () => ({ useQuery: vi.fn(() => undefined) }));

const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("../lib/desktop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/desktop")>();
  return { ...actual, isDesktop: () => desktop.value };
});

vi.mock("../lib/oauth-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/oauth-start")>();
  return { ...actual, beginOAuth: vi.fn() };
});

const heroWatch = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("./BlobatarHero", () => ({
  BlobatarHero: (props: { readonly watch?: unknown; readonly src?: string | null }) => {
    heroWatch.current = props.watch;
    // Keep the workspace-logo path visible to the existing public-config test.
    return props.src ? <img src={props.src} alt="" /> : null;
  },
}));

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
    signInEmail: vi.fn(() => Promise.resolve({ error: null })),
    signUpEmail: vi.fn(() => Promise.resolve({ error: null })),
    signInSocial: vi.fn(() => Promise.resolve({ error: null })),
    signInOAuth2: vi.fn(() => Promise.resolve({ error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
}

describe("SignInScreen", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    desktop.value = false;
    vi.mocked(beginOAuth).mockClear();
  });

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

  it("shows only the SSO buttons and an explanation when local sign-in is off", () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: false, signup: true })}
        actions={fakeActions()}
      />,
    );

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create an account" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByText(/signs in through its configured provider/i)).toBeInTheDocument();
  });

  it("starts OAuth through the workspace origin for an OIDC provider", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue with Keycloak" }));

    await waitFor(() => {
      expect(beginOAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/native/start?provider=keycloak&kind=oidc"),
        "in-app",
      );
    });
  });

  it("starts OAuth through the workspace origin for a built-in provider", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    await waitFor(() => {
      expect(beginOAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/auth/native/start?provider=github&kind=oauth"),
        "in-app",
      );
    });
  });

  it("shows a real brand mark only for a provider that has one", () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }).querySelector("svg"),
    ).not.toBeNull();
    // Keycloak has no shipped mark, so its button is text only.
    expect(
      screen.getByRole("button", { name: "Continue with Keycloak" }).querySelector("svg"),
    ).toBeNull();
  });

  it("opens desktop sign-in directly in the system browser", async () => {
    desktop.value = true;
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(screen.queryByText("Sign in in app")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The handoff is prepared asynchronously before the browser opens.
    await waitFor(() => {
      expect(beginOAuth).toHaveBeenCalledWith(expect.any(String), "external");
      const url = new URL(vi.mocked(beginOAuth).mock.calls[0]?.[0] ?? "");
      expect(url.searchParams.get("return")).toBe("aulora://auth/callback");
      expect(url.searchParams.get("challenge")).toHaveLength(64);
      expect(url.searchParams.get("tx")).toHaveLength(64);
    });
  });

  it("shows the sign-up toggle only when signup is enabled", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: true })}
        actions={fakeActions()}
      />,
    );

    const toggle = screen.getByRole("tab", { name: "Create an account" });
    await user.click(toggle);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("shows the workspace description and logo from the public config", () => {
    vi.mocked(useQuery).mockReturnValue({
      description: "A calm place to ship.",
      logoUrl: "https://chat.acme.com/logo.png",
    });
    const { container } = render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    expect(screen.getByText("A calm place to ship.")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "https://chat.acme.com/logo.png");
  });

  it("shows a provider enabled after the workspace was added, from the live config", () => {
    // The stored profile is a snapshot; the server now also offers GitHub.
    vi.mocked(useQuery).mockReturnValue({
      auth: {
        local: { enabled: true, signup: false },
        providers: [{ id: "github", type: "oauth", displayName: "GitHub" }],
      },
    });
    const stale = {
      ...makeProfile({ enabled: true, signup: false }),
      auth: {
        local: { enabled: true, signup: false },
        providers: [],
      },
    };
    render(<SignInScreen profile={stale} actions={fakeActions()} />);

    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
  });

  it("has the hero follow the pointer until a field takes its attention", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    expect(heroWatch.current).toBe("pointer");

    const email = screen.getByLabelText("Email");
    await user.click(email);
    expect(heroWatch.current).toBe(email);

    await user.click(screen.getByLabelText("Password"));
    expect(heroWatch.current).toBe("rest");

    await user.tab();
    expect(heroWatch.current).toBe("pointer");
    expect(screen.queryByText(/team chat on your own server/)).toBeNull();
  });

  it("shows an accepted handoff error stored after the form mounted", async () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    storeAuthHandoffError("auth_expired", "https://chat.acme.com");
    act(() => {
      notifyAuthError();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-in took too long, please try again.",
    );
  });

  it("ignores a stored handoff error for another workspace", async () => {
    render(
      <SignInScreen
        profile={makeProfile({ enabled: true, signup: false })}
        actions={fakeActions()}
      />,
    );

    storeAuthHandoffError("auth_expired", "https://other.example.com");
    act(() => {
      notifyAuthError();
    });
    expect(screen.queryByRole("alert")).toBeNull();

    storeAuthHandoffError("auth_expired", "https://chat.acme.com");
    act(() => {
      notifyAuthError();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-in took too long, please try again.",
    );
  });
});
