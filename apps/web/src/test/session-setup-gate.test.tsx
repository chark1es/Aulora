import type { ServerProfile } from "@aulora/core";
import { notifyAuthChanged } from "@aulora/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_WAIT_TIMEOUT_MS, SessionGate } from "../components/SessionGate";

/**
 * A missing public-config answer is not "setup required". These cover the two
 * ways the old gate broke the signed-in tree: a config query that returns
 * `undefined` again after it has loaded, and a fresh client that mounts before
 * the query has answered.
 */

const PROFILE: ServerProfile = {
  id: "https://chat.example.com",
  baseUrl: "https://chat.example.com",
  name: "Acme",
  iconSeed: "acme",
  version: "1.4.0",
  apiVersion: 1,
  convexUrl: "https://chat.example.com",
  siteUrl: "https://chat.example.com",
  auth: { local: { enabled: true, signup: true }, providers: [] },
  addedAt: 0,
};

const harness = vi.hoisted(() => ({
  config: undefined as unknown,
  user: { id: "u1", name: "Ada", email: "ada@example.com" } as unknown,
  refetch: (() => Promise.resolve()) as () => Promise<void>,
}));

const providerAuthSpy = vi.hoisted(() => ({
  identities: [] as string[],
  resets: 0,
}));

vi.mock("@aulora/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aulora/core")>()),
  setProviderTokenIdentity: (_client: unknown, identity: string) => {
    providerAuthSpy.identities.push(identity);
  },
  resetProviderToken: () => {
    providerAuthSpy.resets += 1;
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "server:publicConfig") return harness.config;
    if (name === "members:me") return { member: { userId: "u1" }, isOwner: false };
    return undefined;
  },
  useConvexAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    isRefreshing: false,
  }),
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));

vi.mock("@convex-dev/better-auth/react", () => ({
  ConvexBetterAuthProvider: ({ children }: { readonly children: ReactNode }) => children,
}));

vi.mock("../lib/auth-client", () => ({
  // `useSession` is called directly on the client the gate receives.
  authActionsFromClient: () => ({
    signInEmail: () => Promise.resolve({ error: null }),
    signUpEmail: () => Promise.resolve({ error: null }),
    signInSocial: () => Promise.resolve({ error: null }),
    signInOAuth2: () => Promise.resolve({ error: null }),
    signOut: () => Promise.resolve({ error: null }),
  }),
}));

vi.mock("../lib/use-server-recovery", () => ({
  useServerRecovery: (_profile: unknown, onRetry: () => void) => ({
    recovery: {
      serverName: "Acme",
      canRemoveServer: false,
      onRetry,
      onSwitchServer: () => undefined,
    },
    switchServer: () => undefined,
  }),
}));

vi.mock("../components/SetupScreen", () => ({
  SetupScreen: () => <div>Set up your workspace</div>,
}));

vi.mock("../components/chat/ChatSessionShell", () => ({
  ChatSessionShell: () => <div>Signed in</div>,
}));

vi.mock("../components/MembershipGate", () => ({
  MembershipGate: ({ children }: { readonly children: ReactNode }) => children,
}));

function authClient() {
  return {
    useSession: () => ({
      data: harness.user === undefined ? undefined : { user: harness.user },
      error: null,
      isPending: false,
      refetch: harness.refetch,
    }),
  } as never;
}

const CONFIG = { setupRequired: false, version: "1.4.0", features: {}, clientVersion: {} };

const CLIENT = {
  subscribeToConnectionState: () => () => undefined,
  query: vi.fn(() => Promise.resolve(CONFIG)),
} as unknown as ConvexReactClient;

const CONNECTION = {
  retry: vi.fn(),
  stuck: vi.fn(),
  healthy: vi.fn(),
  attempts: () => 0,
  dispose: vi.fn(),
};

function renderGate() {
  return render(
    <SessionGate
      profile={PROFILE}
      authClient={authClient()}
      client={CLIENT}
      connection={CONNECTION}
    />,
  );
}

beforeEach(() => {
  harness.config = CONFIG;
  harness.user = { id: "u1", name: "Ada", email: "ada@example.com" };
  harness.refetch = vi.fn(() => Promise.resolve());
  providerAuthSpy.identities.length = 0;
  providerAuthSpy.resets = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionGate setup gate", () => {
  it("keeps the signed-in shell when the config answer briefly disappears", () => {
    const view = renderGate();
    expect(screen.getByText("Signed in")).toBeInTheDocument();

    harness.config = undefined;
    view.rerender(
      <SessionGate
        profile={PROFILE}
        authClient={authClient()}
        client={CLIENT}
        connection={CONNECTION}
      />,
    );

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.queryByText("Set up your workspace")).not.toBeInTheDocument();
  });

  it("waits instead of showing sign-in when the config has not answered", () => {
    harness.config = undefined;
    harness.user = undefined;
    renderGate();

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("still shows the claim screen when the server reports setup required", async () => {
    harness.config = { ...CONFIG, setupRequired: true };
    harness.user = undefined;
    renderGate();

    expect(await screen.findByText("Set up your workspace")).toBeInTheDocument();
  });

  it("drops back to sign-in only after the config says setup is complete", () => {
    harness.config = CONFIG;
    harness.user = undefined;
    renderGate();

    expect(screen.queryByText("Set up your workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Sign in to Acme")).toBeInTheDocument();
  });

  it("re-binds the Convex token cache when the session identity changes", () => {
    const view = renderGate();
    expect(providerAuthSpy.identities.at(-1)).toBe(":u1");

    harness.user = { id: "u2", name: "Grace", email: "grace@example.com" };
    view.rerender(
      <SessionGate
        profile={PROFILE}
        authClient={authClient()}
        client={CLIENT}
        connection={CONNECTION}
      />,
    );

    expect(providerAuthSpy.identities.at(-1)).toBe(":u2");
  });

  it("refetches the session for an external auth handoff instead of reloading", async () => {
    renderGate();
    await act(async () => {
      notifyAuthChanged();
    });
    expect(harness.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows sign-in with a retry notice after the config wait times out", async () => {
    vi.useFakeTimers();
    harness.config = undefined;
    harness.user = undefined;
    renderGate();

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("Set up your workspace")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIG_WAIT_TIMEOUT_MS);
    });

    // A missing answer still never means "setup required"; the form is usable
    // with a soft notice and a retry instead of blocking sign-in forever.
    expect(screen.queryByText("Set up your workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Sign in to Acme")).toBeInTheDocument();
    expect(screen.getByText("Can’t reach the workspace config. Retrying")).toBeInTheDocument();
    expect(CLIENT.query).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(CLIENT.query).toHaveBeenCalledTimes(2);
  });
});
