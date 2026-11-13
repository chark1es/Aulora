import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthExchangeTimeoutError,
  beginOAuth,
  clearAuthHandoff,
  clearPendingHandoff,
  completeAuthHandoffFromLocation,
  completeDesktopAuthDeepLink,
  completeDesktopAuthErrorDeepLink,
  createHandoffTransactionId,
  DESKTOP_AUTH_RETURN,
  exchangeAuthHandoff,
  handoffChallenge,
  oauthStartUrl,
  PENDING_HANDOFF_TTL_MS,
  prepareOAuthStart,
  readAuthHandoff,
  readPendingHandoff,
  STORED_HANDOFF_ERROR_TTL_MS,
  storeAuthHandoffError,
  takeStoredAuthHandoffError,
} from "../lib/oauth-start";
import { readSessionToken } from "../lib/session-token";

const browser = vi.hoisted(() => ({ desktop: false, open: vi.fn() }));
vi.mock("./desktop", () => ({
  isDesktop: () => browser.desktop,
  openExternal: browser.open,
}));

beforeEach(() => {
  browser.desktop = false;
  browser.open.mockClear();
});

it("always opens the system browser on desktop, including legacy in-app requests", () => {
  browser.desktop = true;
  beginOAuth("https://chat.example.com/api/auth/native/start", "in-app");
  expect(browser.open).toHaveBeenCalledWith("https://chat.example.com/api/auth/native/start");
});

const SERVER = "https://chat.example.com";
const CHALLENGE = "a".repeat(64);
const TX = "tx-abcdefghijklmnopqrstuvwxyz0123456789";
const OTHER_TX = "tx-zyxwvutsrqponmlkjihgfedcba9876543210";

// The workspace echoes the transaction id into the fragment as plain `tx`,
// alongside the prefixed code/server/error keys.
function handoffHash(code: string, server = SERVER, tx = TX): string {
  return `#aulora-auth-code=${encodeURIComponent(code)}&aulora-auth-server=${encodeURIComponent(
    server,
  )}&tx=${encodeURIComponent(tx)}`;
}

function errorHash(message: string, server?: string, tx?: string): string {
  const params = new URLSearchParams({ "aulora-auth-error": message });
  if (server !== undefined) {
    params.set("aulora-auth-server", server);
  }
  if (tx !== undefined) {
    params.set("tx", tx);
  }
  return `#${params.toString()}`;
}

/** The transaction id `prepareOAuthStart` just stored in this tab. */
function pendingTx(): string {
  const pending = readPendingHandoff();
  expect(pending).not.toBeNull();
  return pending?.tx ?? "";
}

describe("oauthStartUrl", () => {
  it("starts on the workspace origin and names the provider, return, challenge and tx", () => {
    const url = new URL(
      oauthStartUrl(
        SERVER,
        { id: "google", type: "oauth" },
        "aulora://auth/callback",
        CHALLENGE,
        TX,
      ),
    );
    expect(url.origin).toBe(SERVER);
    expect(url.pathname).toBe("/api/auth/native/start");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("kind")).toBe("oauth");
    expect(url.searchParams.get("return")).toBe("aulora://auth/callback");
    expect(url.searchParams.get("challenge")).toBe(CHALLENGE);
    expect(url.searchParams.get("tx")).toBe(TX);
  });
});

describe("createHandoffTransactionId", () => {
  it("mints a URL-safe id well above the 128-bit floor", () => {
    const first = createHandoffTransactionId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(first).not.toBe(createHandoffTransactionId());
  });
});

describe("readAuthHandoff", () => {
  it("reads the code, workspace and transaction from the finish fragment", () => {
    expect(readAuthHandoff(handoffHash("abc+123"), "")).toEqual({
      kind: "handoff",
      handoff: { code: "abc+123", server: SERVER, tx: TX },
    });
  });

  it("reports an error left by the finish step", () => {
    expect(readAuthHandoff("#aulora-auth-error=auth_cancelled", "")).toEqual({
      kind: "error",
      message: "auth_cancelled",
      server: null,
      tx: undefined,
    });
  });

  it("reads the workspace and transaction from an error fragment", () => {
    expect(
      readAuthHandoff(
        `#aulora-auth-error=auth_cancelled&aulora-auth-server=${encodeURIComponent(
          SERVER,
        )}&tx=${TX}`,
        "",
      ),
    ).toEqual({
      kind: "error",
      message: "auth_cancelled",
      server: SERVER,
      tx: TX,
    });
  });

  it("also accepts the prefixed draft transaction key", () => {
    expect(
      readAuthHandoff(
        `#aulora-auth-error=auth_cancelled&aulora-auth-server=${encodeURIComponent(
          SERVER,
        )}&aulora-auth-tx=${TX}`,
        "",
      ),
    ).toEqual({
      kind: "error",
      message: "auth_cancelled",
      server: SERVER,
      tx: TX,
    });
  });

  it("ignores an unrelated fragment", () => {
    expect(readAuthHandoff("#settings", "")).toBeNull();
    expect(readAuthHandoff("#aulora-auth-code=abc", "")).toBeNull();
  });
});

describe("clearAuthHandoff", () => {
  it("removes the finish parameters from the address", () => {
    window.history.replaceState(null, "", `/?x=1${handoffHash("abc")}`);
    clearAuthHandoff();
    expect(window.location.hash).toBe("");
    expect(readAuthHandoff()).toBeNull();
  });
});

describe("pending handoff binding", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("uses the same ten-minute lifetime as the server transaction", () => {
    expect(PENDING_HANDOFF_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("stores a verifier whose digest is the challenge sent to the server", async () => {
    const { challenge, tx } = await prepareOAuthStart(SERVER, "aulora://auth/callback");
    const pending = readPendingHandoff();
    expect(pending).not.toBeNull();
    expect(pending?.server).toBe(SERVER);
    expect(pending?.tx).toBe(tx);
    expect(tx).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(await handoffChallenge(pending?.verifier ?? "")).toBe(challenge);
  });

  it("drops a pending transaction once its local TTL has passed", async () => {
    await prepareOAuthStart(
      SERVER,
      "aulora://auth/callback",
      Date.now() - PENDING_HANDOFF_TTL_MS - 1,
    );
    expect(readPendingHandoff()).toBeNull();
  });

  it("drops a pending row that predates the transaction binding", async () => {
    sessionStorage.setItem(
      "aulora.auth.pendingHandoff",
      JSON.stringify({
        verifier: "verifier",
        server: SERVER,
        returnUrl: "aulora://auth/callback",
        createdAt: Date.now(),
      }),
    );
    expect(readPendingHandoff()).toBeNull();
  });
});

describe("exchangeAuthHandoff", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("posts the code and verifier, then stores the token under the workspace", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ token: "token-1", server: SERVER }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;

    expect(
      await exchangeAuthHandoff({ code: "abc", server: SERVER, tx: TX }, "verifier", fetchImpl),
    ).toBe(true);
    expect(readSessionToken(SERVER)).toBe("token-1");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${SERVER}/api/auth/native/exchange`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ code: "abc", verifier: "verifier" });
  });

  it("does not store a token when the exchange is rejected", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response("{}", { status: 400 })),
    ) as unknown as typeof fetch;

    expect(await exchangeAuthHandoff({ code: "bad", server: SERVER, tx: TX }, "v", fetchImpl)).toBe(
      false,
    );
    expect(readSessionToken(SERVER)).toBeNull();
  });

  it("times out when headers arrive but the body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        ok: true,
        json: () => new Promise<unknown>(() => undefined),
      } as unknown as Response;
      const fetchImpl = vi.fn(async () => stalled) as unknown as typeof fetch;

      const pending = exchangeAuthHandoff(
        { code: "abc", server: SERVER, tx: TX },
        "verifier",
        fetchImpl,
        25,
      );
      const assertion = expect(pending).rejects.toBeInstanceOf(AuthExchangeTimeoutError);
      await vi.advanceTimersByTimeAsync(26);
      await assertion;
      expect(readSessionToken(SERVER)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("completeAuthHandoffFromLocation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("completes a handoff that matches the pending transaction", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${handoffHash("abc", SERVER, pendingTx())}`);
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ token: "token-2" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(true);
    expect(readSessionToken(SERVER)).toBe("token-2");
    expect(window.location.hash).toBe("");
    expect(readPendingHandoff()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects a callback when no sign-in is pending", async () => {
    window.history.replaceState(null, "", `/${handoffHash("abc")}`);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readSessionToken(SERVER)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects a callback for a different workspace without consuming the pending one", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(
      null,
      "",
      `/${handoffHash("abc", "https://other.example.com", pendingTx())}`,
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readPendingHandoff()?.server).toBe(SERVER);
    vi.unstubAllGlobals();
  });

  it("rejects a callback with the wrong transaction id without consuming the pending one", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${handoffHash("abc", SERVER, OTHER_TX)}`);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readPendingHandoff()?.server).toBe(SERVER);
    expect(readSessionToken(SERVER)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects a callback with no transaction id", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(
      null,
      "",
      `/#aulora-auth-code=abc&aulora-auth-server=${encodeURIComponent(SERVER)}`,
    );
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readPendingHandoff()).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects an expired pending transaction", async () => {
    await prepareOAuthStart(
      SERVER,
      "aulora://auth/callback",
      Date.now() - PENDING_HANDOFF_TTL_MS - 1,
    );
    window.history.replaceState(null, "", `/${handoffHash("abc")}`);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not paint an error from a link when no sign-in is pending", async () => {
    window.history.replaceState(null, "", `/${errorHash("auth_cancelled", SERVER, TX)}`);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
  });

  it("shows a late expired error only for the current workspace", async () => {
    window.history.replaceState(null, "", `/${errorHash("auth_expired", SERVER, TX)}`);

    expect(await completeAuthHandoffFromLocation(undefined, SERVER)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_expired");
  });

  it("shows the expired message when the local pending record lapsed first", async () => {
    await prepareOAuthStart(
      SERVER,
      "aulora://auth/callback",
      Date.now() - PENDING_HANDOFF_TTL_MS - 1,
    );
    window.history.replaceState(null, "", `/${errorHash("auth_expired", SERVER, TX)}`);

    expect(await completeAuthHandoffFromLocation(undefined, SERVER)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_expired");
  });

  it("ignores a late expired error for another workspace or without a current server", async () => {
    window.history.replaceState(null, "", `/${errorHash("auth_expired", SERVER, TX)}`);
    expect(await completeAuthHandoffFromLocation(undefined, "https://other.example.com")).toBe(
      false,
    );
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();

    window.history.replaceState(null, "", `/${errorHash("auth_expired", SERVER, TX)}`);
    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
  });

  it("ignores any other late error or a malformed transaction id", async () => {
    window.history.replaceState(null, "", `/${errorHash("auth_cancelled", SERVER, TX)}`);
    expect(await completeAuthHandoffFromLocation(undefined, SERVER)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();

    window.history.replaceState(null, "", `/${errorHash("auth_expired", SERVER, "short")}`);
    expect(await completeAuthHandoffFromLocation(undefined, SERVER)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
  });

  it("ignores an error for a different workspace without consuming the pending sign-in", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(
      null,
      "",
      `/${errorHash("auth_cancelled", "https://other.example.com", pendingTx())}`,
    );

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()?.server).toBe(SERVER);
  });

  it("ignores an error that names no workspace without consuming the pending sign-in", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(
      null,
      "",
      `/${errorHash("auth_cancelled", undefined, pendingTx())}`,
    );

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()?.server).toBe(SERVER);
  });

  it("ignores an error with the wrong transaction id without consuming the pending sign-in", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${errorHash("auth_cancelled", SERVER, OTHER_TX)}`);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()).not.toBeNull();
  });

  it("ignores an error with no transaction id without consuming the pending sign-in", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${errorHash("auth_cancelled", SERVER)}`);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()).not.toBeNull();
  });

  it("shows an error that matches the pending workspace and transaction", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${errorHash("auth_cancelled", SERVER, pendingTx())}`);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_cancelled");
    expect(readPendingHandoff()).toBeNull();
  });

  it("times out a hanging exchange, clears the transaction, and reports it", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    window.history.replaceState(null, "", `/${handoffHash("abc", SERVER, pendingTx())}`);
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeAuthHandoffFromLocation(10)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("Sign-in timed out, please try again");
    expect(readPendingHandoff()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("clears a transaction-only fragment left by a successful web finish", async () => {
    window.history.replaceState(null, "", `/#tx=${TX}`);

    expect(await completeAuthHandoffFromLocation()).toBe(false);
    expect(window.location.hash).toBe("");
  });
});

describe("completeDesktopAuthDeepLink", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("completes a deep link only against the pending workspace and transaction", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ token: "desktop-token" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeDesktopAuthDeepLink("abc", SERVER, pendingTx())).toBe(true);
    expect(readSessionToken(SERVER)).toBe("desktop-token");
    vi.unstubAllGlobals();
  });

  it("rejects a deep link with no pending transaction", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    expect(await completeDesktopAuthDeepLink("abc", SERVER, TX)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a deep link with another transaction id", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeDesktopAuthDeepLink("abc", SERVER, OTHER_TX)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readPendingHandoff()).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("rejects a deep link with no transaction id", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    expect(await completeDesktopAuthDeepLink("abc", SERVER, undefined)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readPendingHandoff()).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("completeDesktopAuthErrorDeepLink", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("stores a matching error and clears the pending transaction", async () => {
    await prepareOAuthStart(SERVER, DESKTOP_AUTH_RETURN);
    expect(await completeDesktopAuthErrorDeepLink("auth_cancelled", SERVER, pendingTx())).toBe(
      true,
    );
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_cancelled");
    expect(readPendingHandoff()).toBeNull();
  });

  it("ignores an error for another transaction without clearing the sign-in", async () => {
    await prepareOAuthStart(SERVER, DESKTOP_AUTH_RETURN);
    expect(await completeDesktopAuthErrorDeepLink("auth_cancelled", SERVER, OTHER_TX)).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()).not.toBeNull();
  });

  it("ignores an error that names no transaction or another workspace", async () => {
    await prepareOAuthStart(SERVER, DESKTOP_AUTH_RETURN);
    expect(await completeDesktopAuthErrorDeepLink("auth_cancelled", SERVER, undefined)).toBe(false);
    expect(
      await completeDesktopAuthErrorDeepLink(
        "auth_cancelled",
        "https://other.example.com",
        pendingTx(),
      ),
    ).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
    expect(readPendingHandoff()).not.toBeNull();
  });

  it("shows a late expired error without a pending record for the current workspace", async () => {
    expect(
      await completeDesktopAuthErrorDeepLink("auth_expired", SERVER, TX, Date.now(), SERVER),
    ).toBe(true);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_expired");
    expect(readPendingHandoff()).toBeNull();
  });

  it("ignores a late expired error without a matching current workspace", async () => {
    expect(
      await completeDesktopAuthErrorDeepLink(
        "auth_expired",
        SERVER,
        TX,
        Date.now(),
        "https://other.example.com",
      ),
    ).toBe(false);
    expect(
      await completeDesktopAuthErrorDeepLink("auth_cancelled", SERVER, TX, Date.now(), SERVER),
    ).toBe(false);
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
  });
});

describe("clearPendingHandoff", () => {
  it("removes the stored transaction", async () => {
    await prepareOAuthStart(SERVER, "aulora://auth/callback");
    clearPendingHandoff();
    expect(readPendingHandoff()).toBeNull();
  });
});

describe("stored handoff errors", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("only shows a stored error for the workspace that produced it", () => {
    storeAuthHandoffError("auth_expired", SERVER);
    // Another profile must not see it; switching back still can.
    expect(takeStoredAuthHandoffError("https://other.example.com")).toBeNull();
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_expired");
  });

  it("discards a record older than five minutes", () => {
    storeAuthHandoffError("auth_expired", SERVER);
    expect(
      takeStoredAuthHandoffError(SERVER, Date.now() + STORED_HANDOFF_ERROR_TTL_MS + 1),
    ).toBeNull();
  });

  it("consumes a matching record once", () => {
    storeAuthHandoffError("auth_expired", SERVER);
    expect(takeStoredAuthHandoffError(SERVER)).toBe("auth_expired");
    expect(takeStoredAuthHandoffError(SERVER)).toBeNull();
  });
});
