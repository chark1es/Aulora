import {
  createMemoryProfileStore,
  createServerProfile,
  type ServerProfile,
  type WellKnown,
} from "@aulora/core";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ConnectScreen } from "../components/ConnectScreen";
import { SignInScreen } from "../components/SignInScreen";
import type { AuthActions } from "../lib/auth-client";
import { demoProfileStore } from "./demo";

/**
 * Dev-only visual harness for the pre-session screens: the real
 * {@link ConnectScreen} and {@link SignInScreen} over fixtures, so every state
 * (empty, typing, checking, discovered, error, recents; local + SSO, SSO-only,
 * signing up, submitting, failed) can be rendered and captured without a
 * backend. Registered at `/__preview/auth` only in development builds.
 *
 * Everything is driven by the query string, which is what makes the screenshots
 * reproducible:
 *
 *   /__preview/auth?screen=signin&workspace=local-sso&outcome=ok
 *   /__preview/auth?screen=connect&fetch=delay&host=acme.studio&recents=1
 *
 * `outcome=hang` never settles, which is how the loading state is captured;
 * `fetch=delay` does the same for a discovery that is still in flight.
 */

/** How a fixture auth call behaves. `hang` is the loading state, on purpose. */
type Outcome = "ok" | "error" | "hang";
/** How the fixture well-known request behaves. */
type FetchMode = "ok" | "delay" | "fail";

const HOST = "https://acme.studio";

const WELL_KNOWN: WellKnown = {
  name: "Acme Studio",
  version: "1.4.2",
  apiVersion: 1,
  convexUrl: "http://127.0.0.1:9",
  siteUrl: HOST,
  iconSeed: "aulora:server:acme-studio",
  auth: {
    local: { enabled: true, signup: true },
    providers: [
      { id: "github", type: "oauth", displayName: "GitHub" },
      {
        id: "keycloak",
        type: "oidc",
        displayName: "Keycloak",
        issuer: "https://idp.acme.studio/realms/acme",
        discoveryUrl: "https://idp.acme.studio/realms/acme/.well-known/openid-configuration",
        clientId: "aulora",
        scopes: ["openid", "email"],
      },
    ],
  },
};

/** Well-known documents per workspace preset, so SSO-only is a real state. */
const PRESETS: Record<string, WellKnown> = {
  "local-sso": WELL_KNOWN,
  "sso-only": {
    ...WELL_KNOWN,
    auth: { ...WELL_KNOWN.auth, local: { enabled: false, signup: false } },
  },
  "no-methods": {
    ...WELL_KNOWN,
    auth: { local: { enabled: false, signup: false }, providers: [] },
  },
};

function presetWellKnown(preset: string): WellKnown {
  return PRESETS[preset] ?? WELL_KNOWN;
}

function profileFor(preset: string): ServerProfile {
  return createServerProfile(HOST, presetWellKnown(preset));
}

/**
 * In-memory auth actions. `hang` returns a promise that never settles, which
 * keeps the button in its busy state long enough to photograph.
 */
function fixtureActions(outcome: Outcome): AuthActions {
  const settle = (): Promise<{ error: { message?: string } | null }> => {
    if (outcome === "hang") {
      return new Promise(() => undefined);
    }
    if (outcome === "error") {
      return Promise.resolve({ error: { message: "That email and password don’t match." } });
    }
    return Promise.resolve({ error: null });
  };
  return {
    signInEmail: settle,
    signUpEmail: settle,
    signInSocial: settle,
    signInOAuth2: settle,
    signOut: settle,
  };
}

/** Answers `/.well-known/aulora.json` from the fixture, or fails like a network. */
function useFixtureFetch(mode: FetchMode, wellKnown: WellKnown): void {
  useEffect(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/.well-known/aulora.json")) {
        return original(input);
      }
      if (mode === "fail") {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      const body = JSON.stringify(wellKnown);
      const respond = () =>
        new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      return mode === "delay"
        ? new Promise((resolve) => setTimeout(() => resolve(respond()), 30_000))
        : Promise.resolve(respond());
    };
    return () => {
      globalThis.fetch = original;
    };
  }, [mode, wellKnown]);
}

function param(params: URLSearchParams, key: string, fallback: string): string {
  const value = params.get(key);
  return value === null || value.length === 0 ? fallback : value;
}

function isFetchMode(value: string): value is FetchMode {
  return value === "ok" || value === "delay" || value === "fail";
}

function isOutcome(value: string): value is Outcome {
  return value === "ok" || value === "error" || value === "hang";
}

function ConnectFixture({ params }: { readonly params: URLSearchParams }) {
  const preset = param(params, "workspace", "local-sso");
  const wellKnown = presetWellKnown(preset);
  const mode = param(params, "fetch", "ok");
  useFixtureFetch(isFetchMode(mode) ? mode : "ok", wellKnown);
  const store = useMemo(
    () => (params.get("recents") === "1" ? demoProfileStore() : createMemoryProfileStore()),
    [params],
  );
  const host = params.get("host") ?? "";
  return (
    <ConnectScreen
      store={store}
      onConnected={() => undefined}
      {...(host.length > 0 ? { initialHost: host } : {})}
    />
  );
}

function SignInFixture({ params }: { readonly params: URLSearchParams }) {
  const preset = param(params, "workspace", "local-sso");
  const outcome = param(params, "outcome", "ok");
  const profile = useMemo(() => profileFor(preset), [preset]);
  const actions = useMemo(() => fixtureActions(isOutcome(outcome) ? outcome : "ok"), [outcome]);
  return (
    <SignInScreen
      profile={profile}
      actions={actions}
      onSwitchServer={() => {
        globalThis.location.assign("/__preview/auth?screen=connect");
      }}
    />
  );
}

/** Reads the harness directive from the live query string. */
function useSearchParams(): URLSearchParams {
  const [params] = useState(() => new URLSearchParams(globalThis.location.search));
  return params;
}

export function AuthPreviewRoute() {
  const params = useSearchParams();
  const convex = useMemo(() => new ConvexReactClient("http://127.0.0.1:9"), []);
  const screen = param(params, "screen", "signin");
  return (
    <ConvexProvider client={convex}>
      {screen === "connect" ? (
        <ConnectFixture params={params} />
      ) : (
        <SignInFixture params={params} />
      )}
    </ConvexProvider>
  );
}
