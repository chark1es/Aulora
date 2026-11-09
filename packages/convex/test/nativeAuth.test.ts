import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import {
  HANDOFF_CHALLENGE_PARAM,
  HANDOFF_TX_PARAM,
  isHandoffChallenge,
  NATIVE_AUTH_EXCHANGE_GLOBAL,
  NATIVE_AUTH_EXCHANGE_PER_IP,
  NATIVE_AUTH_FINISH_PER_TX,
  NATIVE_AUTH_START_GLOBAL,
  NATIVE_AUTH_TX_COOKIE_PREFIX,
  nativeAuthTxCookieName,
  nativeAuthUrls,
  parseAuthReturnTarget,
  sanitizeHandoffError,
  signHandoffTransaction,
  withHandoffParams,
} from "../convex/lib/nativeAuth";
import { newTestWithAccounts, SERVER_SETTINGS } from "./helpers";

/**
 * Counts reads of `internal.nativeAuthHandoff.peek`. The route only reads that
 * reference when it is about to run the query, so a refused exchange must leave
 * the counter untouched.
 */
const peekAccess = vi.hoisted(() => ({ count: 0 }));

vi.mock("../convex/_generated/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../convex/_generated/api")>();
  const wrapped = new Proxy(actual.internal, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "nativeAuthHandoff" && typeof value === "object" && value !== null) {
        return new Proxy(value, {
          get(namespace, namespaceProp, namespaceReceiver) {
            if (namespaceProp === "peek") {
              peekAccess.count += 1;
            }
            return Reflect.get(namespace, namespaceProp, namespaceReceiver) as unknown;
          },
        });
      }
      return value;
    },
  }) as typeof actual.internal;
  return { ...actual, internal: wrapped };
});

const SITE = "https://chat.example.com";
const TRUSTED = [SITE, "http://localhost:5173"];
const SECRET = "test-secret-0123456789-0123456789-0123456789";
const RETURN_URL = "aulora://auth/callback";

beforeEach(() => {
  vi.stubEnv("SITE_URL", SITE);
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_RATE_LIMIT_MAX", "10000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseAuthReturnTarget", () => {
  it("accepts the app's own custom scheme", () => {
    expect(parseAuthReturnTarget("aulora://auth/callback", TRUSTED, SITE)).toEqual({
      kind: "custom",
      url: "aulora://auth/callback",
    });
  });

  it("accepts the desktop shell's own origins", () => {
    expect(parseAuthReturnTarget("tauri://localhost", TRUSTED, SITE)?.kind).toBe("app");
    expect(parseAuthReturnTarget("http://tauri.localhost", TRUSTED, SITE)?.kind).toBe("app");
  });

  it("accepts the workspace origin and other trusted web origins", () => {
    expect(parseAuthReturnTarget(SITE, TRUSTED, SITE)).toEqual({ kind: "web", url: SITE });
    expect(parseAuthReturnTarget("http://localhost:5173", TRUSTED, SITE)?.kind).toBe("web");
  });

  it("rejects an origin the deployment does not trust", () => {
    expect(parseAuthReturnTarget("https://evil.example", TRUSTED, SITE)).toBeNull();
    expect(parseAuthReturnTarget("javascript:alert(1)", TRUSTED, SITE)).toBeNull();
    expect(parseAuthReturnTarget("not a url", TRUSTED, SITE)).toBeNull();
  });

  it("only allows Expo's development scheme on a loopback workspace", () => {
    expect(
      parseAuthReturnTarget(
        "exp://192.168.1.5:8081/--/auth/callback",
        TRUSTED,
        "http://localhost:8080",
      )?.kind,
    ).toBe("custom");
    expect(
      parseAuthReturnTarget("exp://192.168.1.5:8081/--/auth/callback", TRUSTED, SITE),
    ).toBeNull();
  });
});

describe("withHandoffParams", () => {
  it("uses the query string for a custom scheme", () => {
    expect(
      withHandoffParams(
        { kind: "custom", url: "aulora://auth/callback" },
        { code: "abc", server: SITE },
      ),
    ).toBe(`aulora://auth/callback?code=abc&server=${encodeURIComponent(SITE)}`);
  });

  it("uses the fragment for the app and web returns", () => {
    const result = withHandoffParams(
      { kind: "app", url: "tauri://localhost" },
      { "aulora-auth-code": "abc" },
    );
    expect(result).toBe("tauri://localhost#aulora-auth-code=abc");
  });
});

describe("nativeAuthUrls", () => {
  it("splits Better Auth's base URL into the workspace origin and auth base", () => {
    expect(nativeAuthUrls(`${SITE}/api/auth`)).toEqual({
      siteOrigin: SITE,
      authBase: `${SITE}/api/auth`,
    });
    expect(nativeAuthUrls(`${SITE}/api/auth/`)).toEqual({
      siteOrigin: SITE,
      authBase: `${SITE}/api/auth`,
    });
  });
});

describe("handoff challenge and errors", () => {
  it("accepts only a SHA-256 hex digest as the challenge", () => {
    expect(isHandoffChallenge("a".repeat(64))).toBe(true);
    expect(isHandoffChallenge("A".repeat(64))).toBe(false);
    expect(isHandoffChallenge("a".repeat(63))).toBe(false);
    expect(isHandoffChallenge(null)).toBe(false);
  });

  it("allows only known error codes and folds cancellation spelling", () => {
    expect(sanitizeHandoffError("access_denied")).toBe("auth_cancelled");
    expect(sanitizeHandoffError("state_mismatch")).toBe("state_mismatch");
    expect(sanitizeHandoffError("<script>alert(1)</script>")).toBe("auth_failed");
    expect(sanitizeHandoffError("")).toBeNull();
    expect(sanitizeHandoffError(null)).toBeNull();
  });
});

/** A workspace that accepts a brand-new account, so sign-up can mint a session. */
async function seedSignupWorkspace(t: ReturnType<typeof newTestWithAccounts>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("server", {
      name: "Acme",
      iconSeed: "seed",
      ownerId: "owner-1",
      settings: { ...SERVER_SETTINGS, inviteOnly: false },
    });
  });
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const values =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [response.headers.get("set-cookie") ?? ""];
  return values
    .filter((value) => value.length > 0)
    .map((value) => value.split(";")[0] ?? "")
    .filter((value) => value.length > 0)
    .join("; ");
}

function hexDigest(value: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

let nextIp = 10;
let nextStartIp = 10;

async function signUp(t: ReturnType<typeof newTestWithAccounts>): Promise<string> {
  const response = await t.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE,
      // Better Auth rate-limits sign-up per client IP; one fake IP per test
      // keeps the shared in-process limiter out of these assertions.
      "x-forwarded-for": `10.0.0.${nextIp++}`,
    },
    body: JSON.stringify({
      email: "ada@example.com",
      password: "correct horse battery staple",
      name: "Ada",
    }),
  });
  expect(response.status).toBe(200);
  const cookie = cookieHeader(response);
  expect(cookie.length).toBeGreaterThan(0);
  return cookie;
}

/** A syntactically valid client transaction id. */
function txId(seed: string): string {
  return seed.repeat(Math.ceil(32 / seed.length)).slice(0, 32);
}

/** Records the transaction `native/start` would have created. */
async function startTransaction(
  t: ReturnType<typeof newTestWithAccounts>,
  tx: string,
  challenge: string,
  returnTarget: string = RETURN_URL,
): Promise<void> {
  await t.mutation(internal.nativeAuthHandoff.createTransaction, {
    tx,
    challenge,
    returnTarget,
  });
}

async function transactionCookie(tx: string): Promise<string> {
  return `${await nativeAuthTxCookieName(tx)}=${await signHandoffTransaction(SECRET, tx)}`;
}

async function finish(
  t: ReturnType<typeof newTestWithAccounts>,
  cookie: string,
  challenge: string,
  tx: string,
  options: { readonly returnTarget?: string; readonly queryTx?: string } = {},
): Promise<string> {
  const returnTarget = options.returnTarget ?? RETURN_URL;
  const queryTx = options.queryTx ?? tx;
  const response = await t.fetch(
    `/api/auth/native/finish?return=${encodeURIComponent(returnTarget)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${queryTx}`,
    { headers: { cookie: `${await transactionCookie(tx)}; ${cookie}` } },
  );
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return location ?? "";
}

/** A finish with no transaction cookie, as a cross-site navigation would send. */
async function finishWithoutCookie(
  t: ReturnType<typeof newTestWithAccounts>,
  challenge: string,
  tx: string,
): Promise<Response> {
  return await t.fetch(
    `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
  );
}

/** Every `Set-Cookie` value on a response. */
function setCookieValues(response: Response): string[] {
  const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const values =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [response.headers.get("set-cookie") ?? ""];
  return values.filter((value) => value.length > 0);
}

/** Applies a response's cookies to a browser-like jar, honoring Max-Age=0. */
function applyCookies(response: Response, jar: Map<string, string>): void {
  for (const raw of setCookieValues(response)) {
    const pair = raw.split(";")[0];
    if (pair === undefined) {
      continue;
    }
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value.length === 0 || /(?:^|;)\s*max-age=0(?:;|$)/i.test(raw)) {
      jar.delete(name);
    } else {
      jar.set(name, `${name}=${value}`);
    }
  }
}

function jarCookieHeader(jar: Map<string, string>): string {
  return [...jar.values()].join("; ");
}

async function startForJar(
  t: ReturnType<typeof newTestWithAccounts>,
  jar: Map<string, string>,
  challenge: string,
  tx: string,
): Promise<Response> {
  const response = await t.fetch(
    `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
    // A distinct peer per start keeps Better Auth's built-in sign-in limiter
    // (which has rules stricter than `AUTH_RATE_LIMIT_MAX`) from rejecting the
    // fourth provider authorization in this file.
    { headers: { "x-forwarded-for": `198.51.100.${nextStartIp++}` } },
  );
  expect(response.status).toBe(302);
  applyCookies(response, jar);
  return response;
}

async function finishWithJar(
  t: ReturnType<typeof newTestWithAccounts>,
  jar: Map<string, string>,
  sessionCookie: string,
  challenge: string,
  tx: string,
): Promise<Response> {
  const response = await t.fetch(
    `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
    { headers: { cookie: `${jarCookieHeader(jar)}; ${sessionCookie}` } },
  );
  expect(response.status).toBe(302);
  applyCookies(response, jar);
  return response;
}

// The first route test cold-loads Better Auth and the Convex test harness, which
// can exceed the 5 s default on a loaded CI runner.
describe("native OAuth HTTP routes", { timeout: 30_000 }, () => {
  it("builds provider and finish URLs without duplicating /api/auth", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const verifier = "a".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("a");

    const response = await t.fetch(
      `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("/api/auth/api/auth");
    const provider = new URL(location);
    expect(provider.searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/callback/github`);

    // The start navigation sets the HttpOnly transaction cookie that binds the
    // finish request to this browsing context.
    const getSetCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie;
    const startCookies =
      typeof getSetCookie === "function"
        ? getSetCookie.call(response.headers)
        : [response.headers.get("set-cookie") ?? ""];
    const txSetCookie = startCookies.find((value) =>
      value.startsWith(NATIVE_AUTH_TX_COOKIE_PREFIX),
    );
    expect(txSetCookie).toBeDefined();
    expect(txSetCookie).toContain("Path=/api/auth/native");
    expect(txSetCookie).toContain("HttpOnly");
    expect(txSetCookie).toContain("SameSite=Lax");
    expect(txSetCookie).toContain("Secure");
    expect(txSetCookie).toContain("Max-Age=630");

    // The finish URL lives in the signed state cookie's payload; drive the
    // finish route directly with the same parameters instead of decoding it.
    const cookie = await signUp(t);
    const finishLocation = await finish(t, cookie, challenge, tx);
    expect(finishLocation).not.toContain("/api/auth/api/auth");
    const callback = new URL(finishLocation);
    expect(callback.searchParams.get("server")).toBe(SITE);
    expect(callback.searchParams.get("tx")).toBe(tx);
    expect(callback.searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
    expect(callback.search).not.toContain("cookie=");

    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({
        code: callback.searchParams.get("code"),
        verifier,
      }),
    });
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as { server?: string };
    expect(body.server).toBe(SITE);
  });

  it("exchanges a code once with the verifier and rejects a replay", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "b".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("b");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const callback = new URL(finishLocation);
    const code = callback.searchParams.get("code") ?? "";

    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as { token?: string; server?: string };
    expect(body.token?.length ?? 0).toBeGreaterThan(0);
    expect(body.server).toBe(SITE);

    const replay = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_code" });
  });

  it("authenticates a later request with the exchanged bearer token", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "1".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("1");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";

    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(exchanged.status).toBe(200);
    const { token } = (await exchanged.json()) as { token?: string };
    expect(token).toBeDefined();

    const session = await t.fetch("/api/auth/get-session", {
      headers: { authorization: `Bearer ${token ?? ""}` },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as {
      user?: { email?: string };
      session?: { id?: string };
    };
    expect(body.user?.email).toBe("ada@example.com");
    expect(body.session?.id).toBeTruthy();
  });

  it("lets exactly one of two concurrent exchanges consume the code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "2".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("2");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";

    const exchange = () =>
      t.fetch("/api/auth/native/exchange", {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE },
        body: JSON.stringify({ code, verifier }),
      });
    const [first, second] = await Promise.all([exchange(), exchange()]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);
    const failed = first.status === 400 ? first : second;
    expect(await failed.json()).toEqual({ error: "invalid_code" });
  });

  it("stores neither the plaintext code nor the plaintext session token", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "3".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("3");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    const stored = await t.run(async (ctx) => {
      const row = await ctx.db.query("nativeAuthHandoffs").first();
      return row === null ? null : JSON.stringify(row);
    });
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(code);

    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(exchanged.status).toBe(200);
    const { token } = (await exchanged.json()) as { token?: string };
    expect(token?.length ?? 0).toBeGreaterThan(0);
    expect(stored).not.toContain(token);
  });

  it("rejects a wrong verifier without burning the code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "c".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("c");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";

    const wrong = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier: "d".repeat(64) }),
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "invalid_code" });

    const right = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(right.status).toBe(200);
  });

  it("rejects an expired code with the same generic error", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "e".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("e");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";

    await t.run(async (ctx) => {
      const row = await ctx.db.query("nativeAuthHandoffs").first();
      expect(row).not.toBeNull();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    const expired = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "invalid_code" });
  });

  it("gates the exchange by trusted origin and CORS preflight", async () => {
    const t = newTestWithAccounts();

    const preflight = await t.fetch("/api/auth/native/exchange", {
      method: "OPTIONS",
      headers: { origin: SITE, "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(SITE);

    const evilPreflight = await t.fetch("/api/auth/native/exchange", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(evilPreflight.headers.get("access-control-allow-origin")).toBeNull();

    const evil = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ code: "x", verifier: "y" }),
    });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("rejects an untrusted return target on start and finish", async () => {
    const t = newTestWithAccounts();
    const start = await t.fetch(
      `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent("https://evil.example")}`,
    );
    expect(start.status).toBe(302);
    const startLocation = new URL(start.headers.get("location") ?? "");
    expect(startLocation.origin).toBe(SITE);
    const startHash = new URLSearchParams(startLocation.hash.slice(1));
    expect(startHash.get("aulora-auth-error")).toBe("invalid_return");
    expect(startHash.get("aulora-auth-server")).toBe(SITE);

    const finish = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent("https://evil.example")}`,
    );
    expect(finish.status).toBe(302);
    const finishLocation = new URL(finish.headers.get("location") ?? "");
    expect(finishLocation.origin).toBe(SITE);
    const finishHash = new URLSearchParams(finishLocation.hash.slice(1));
    expect(finishHash.get("aulora-auth-error")).toBe("invalid_return");
    expect(finishHash.get("aulora-auth-server")).toBe(SITE);
  });

  it("sanitizes an attacker-written provider error", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("8".repeat(64));
    const tx = txId("8");
    await startTransaction(t, tx, challenge);
    const response = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}&error=${encodeURIComponent("<script>alert(1)</script>")}`,
      { headers: { cookie: `${await transactionCookie(tx)}; ${cookie}` } },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("auth_failed");
    expect(location.searchParams.get("tx")).toBe(tx);
  });

  it("returns a same-origin web callback without a code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const response = await t.fetch(`/api/auth/native/finish?return=${encodeURIComponent(SITE)}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SITE);
  });

  it("prunes expired handoff rows through the expiry index", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("f".repeat(64));
    const tx = txId("f");
    await startTransaction(t, tx, challenge);
    await finish(t, cookie, challenge, tx);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("nativeAuthHandoffs").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    expect(await t.mutation(internal.nativeAuthHandoff.pruneExpired, {})).toBe(1);
    expect(await t.run(async (ctx) => await ctx.db.query("nativeAuthHandoffs").first())).toBeNull();
  });

  it("requires a challenge only for a return target that receives a code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const custom = await t.fetch(
      `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent("aulora://auth/callback")}`,
    );
    expect(custom.status).toBe(302);
    expect(new URL(custom.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_request",
    );

    // A custom/app finish target needs a challenge even with a real session and
    // transaction; otherwise the route would mint a code no client verifier can
    // redeem.
    const cookie = await signUp(t);
    const challenge = await hexDigest("7".repeat(64));
    const tx = txId("7");
    await startTransaction(t, tx, challenge);
    const finish = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_TX_PARAM}=${tx}`,
      { headers: { cookie: `${await transactionCookie(tx)}; ${cookie}` } },
    );
    expect(finish.status).toBe(302);
    const finishLocation = new URL(finish.headers.get("location") ?? "");
    expect(finishLocation.searchParams.get("error")).toBe("invalid_request");
    expect(finishLocation.searchParams.get("server")).toBe(SITE);
    expect(finishLocation.searchParams.get("tx")).toBe(tx);
    expect(finishLocation.searchParams.get("code")).toBeNull();

    const web = await t.fetch(
      `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent(SITE)}`,
    );
    // No provider is configured in this test; the important part is that the
    // missing challenge is not itself rejected for a same-origin web return.
    expect(web.status).toBe(302);
  });

  it("mints nothing when finish has no start transaction cookie", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("4".repeat(64));
    const tx = txId("4");

    // A cross-site top-level navigation sends the session cookie but cannot set
    // the HttpOnly transaction cookie that the start page wrote.
    const response = await finishWithoutCookie(t, challenge, tx);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(SITE);
    expect(new URLSearchParams(location.hash.slice(1)).get("aulora-auth-error")).toBe(
      "invalid_request",
    );
    expect(location.searchParams.get("code")).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.query("nativeAuthHandoffs").first())).toBeNull();
    // The session is untouched: the victim is not signed in to anything new.
    expect(cookie.length).toBeGreaterThan(0);
  });

  it("rejects a transaction started in another browser", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("5".repeat(64));
    const realTx = txId("5");
    const otherTx = txId("6");
    await startTransaction(t, realTx, challenge);
    await startTransaction(t, otherTx, challenge);

    // This browser presents the transaction cookie for its own start, but asks
    // to finish the transaction another browser started (the ids do not match).
    const mismatch = await finish(t, cookie, challenge, otherTx, { queryTx: realTx });
    const mismatchLocation = new URL(mismatch);
    expect(mismatchLocation.origin).toBe(SITE);
    expect(new URLSearchParams(mismatchLocation.hash.slice(1)).get("aulora-auth-error")).toBe(
      "invalid_request",
    );
    expect(mismatchLocation.searchParams.get("code")).toBeNull();

    // The real transaction was not burned by the mismatch.
    const finishLocation = await finish(t, cookie, challenge, realTx);
    expect(new URL(finishLocation).searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a tampered challenge or return without burning the real transaction", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("9".repeat(64));
    const tx = txId("9");
    await startTransaction(t, tx, challenge);

    const wrongChallenge = await finish(t, cookie, "a".repeat(64), tx);
    expect(new URL(wrongChallenge).searchParams.get("error")).toBe("auth_failed");
    expect(new URL(wrongChallenge).searchParams.get("code")).toBeNull();

    const wrongReturn = await finish(t, cookie, challenge, tx, {
      returnTarget: "tauri://localhost",
    });
    const wrongReturnLocation = new URL(wrongReturn);
    const wrongReturnHash = new URLSearchParams(wrongReturnLocation.hash.slice(1));
    expect(wrongReturnHash.get("aulora-auth-error")).toBe("auth_failed");
    expect(wrongReturnHash.get("aulora-auth-code")).toBeNull();

    const finishLocation = await finish(t, cookie, challenge, tx);
    expect(new URL(finishLocation).searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a replayed finish", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("6".repeat(64));
    const tx = txId("6");
    await startTransaction(t, tx, challenge);

    const first = await finish(t, cookie, challenge, tx);
    expect(new URL(first).searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);

    // Replaying the same finish URL cannot mint a second code: the transaction
    // was deleted in the same mutation that inserted the first one.
    const replay = await finish(t, cookie, challenge, tx);
    const replayLocation = new URL(replay);
    expect(replayLocation.searchParams.get("code")).toBeNull();
    expect(replayLocation.searchParams.get("error")).toBe("auth_failed");
    const handoffs = await t.run(async (ctx) => await ctx.db.query("nativeAuthHandoffs").collect());
    expect(handoffs).toHaveLength(1);
  });

  it("redirects an expired start transaction with the explicit auth_expired code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("0a".repeat(32));
    const tx = txId("0a");
    await startTransaction(t, tx, challenge);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("nativeAuthTransactions").first();
      if (row !== null) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });

    const response = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
      { headers: { cookie: `${await transactionCookie(tx)}; ${cookie}` } },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("auth_expired");
    expect(location.searchParams.get("tx")).toBe(tx);
    expect(location.searchParams.get("code")).toBeNull();
    // The redirect already carries `auth_expired`; drop the stale cookie so a
    // refresh cannot replay it into `auth_failed` or `rate_limited`.
    const txCookieName = await nativeAuthTxCookieName(tx);
    expect(
      setCookieValues(response).some(
        (value) => value.startsWith(`${txCookieName}=`) && /max-age=0/i.test(value),
      ),
    ).toBe(true);
  });

  it("echoes a sanitized provider error for a same-origin web return", async () => {
    const t = newTestWithAccounts();
    const tx = txId("0b");
    const cancelled = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(SITE)}&${HANDOFF_TX_PARAM}=${tx}&error=access_denied`,
    );
    expect(cancelled.status).toBe(302);
    const cancelledLocation = new URL(cancelled.headers.get("location") ?? "");
    expect(cancelledLocation.origin).toBe(SITE);
    const cancelledHash = new URLSearchParams(cancelledLocation.hash.slice(1));
    expect(cancelledHash.get("aulora-auth-error")).toBe("auth_cancelled");
    expect(cancelledHash.get("aulora-auth-server")).toBe(SITE);
    expect(cancelledHash.get("tx")).toBe(tx);

    const hostile = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(SITE)}&${HANDOFF_TX_PARAM}=${tx}&error=${encodeURIComponent("<script>alert(1)</script>")}`,
    );
    const hostileLocation = new URL(hostile.headers.get("location") ?? "");
    const hostileHash = new URLSearchParams(hostileLocation.hash.slice(1));
    expect(hostileHash.get("aulora-auth-error")).toBe("auth_failed");
    expect(hostileHash.get("tx")).toBe(tx);
  });

  it("does not clear another transaction's cookie when finish sees a mismatch", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const sessionCookie = await signUp(t);
    const jar = new Map<string, string>();
    const challenge = await hexDigest("d1".repeat(32));
    const firstTx = txId("d1");
    const secondTx = txId("d2");
    await startForJar(t, jar, challenge, firstTx);
    await startForJar(t, jar, challenge, secondTx);

    // Present only the first transaction's cookie while asking to finish the
    // second: the mismatch must not expire the first flow's cookie.
    const firstCookie = await transactionCookie(firstTx);
    const response = await t.fetch(
      `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${secondTx}`,
      { headers: { cookie: `${firstCookie}; ${sessionCookie}` } },
    );
    expect(response.status).toBe(302);
    const mismatchLocation = new URL(response.headers.get("location") ?? "");
    expect(new URLSearchParams(mismatchLocation.hash.slice(1)).get("aulora-auth-error")).toBe(
      "invalid_request",
    );
    expect(setCookieValues(response)).toHaveLength(0);

    const finishLocation = new URL(await finish(t, sessionCookie, challenge, firstTx));
    expect(finishLocation.searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps two concurrent starts in one browser and finishes both in either order", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    const orders = [
      ["first", "second"],
      ["second", "first"],
    ] as const;

    for (const order of orders) {
      const t = newTestWithAccounts();
      await seedSignupWorkspace(t);
      const sessionCookie = await signUp(t);
      const jar = new Map<string, string>();
      const firstChallenge = await hexDigest("c1".repeat(32));
      const secondChallenge = await hexDigest("c2".repeat(32));
      const firstTx = txId("c1");
      const secondTx = txId("c2");
      await startForJar(t, jar, firstChallenge, firstTx);
      await startForJar(t, jar, secondChallenge, secondTx);

      const txCookies = [...jar.keys()].filter((name) =>
        name.startsWith(NATIVE_AUTH_TX_COOKIE_PREFIX),
      );
      expect(txCookies).toHaveLength(2);
      expect(new Set(txCookies).size).toBe(2);

      for (const which of order) {
        const [challenge, tx] =
          which === "first" ? [firstChallenge, firstTx] : [secondChallenge, secondTx];
        const response = await finishWithJar(t, jar, sessionCookie, challenge, tx);
        const location = new URL(response.headers.get("location") ?? "");
        expect(location.searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

describe("native auth rate limits", { timeout: 30_000 }, () => {
  it("keeps a bounded key space and applies a global unauthenticated ceiling", async () => {
    const t = newTestWithAccounts();
    for (let index = 0; index < 400; index += 1) {
      await t.mutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
        action: "bounded",
        subject: `spoofed-address-${index}`,
        limit: 5,
        windowMs: 60_000,
      });
    }
    const keys = await t.run(async (ctx) =>
      (await ctx.db.query("rateLimits").collect()).map((row) => row.key),
    );
    expect(keys.filter((key) => key.startsWith("native-auth:bounded:")).length).toBeLessThanOrEqual(
      4096,
    );

    for (let index = 0; index < 2; index += 1) {
      await expect(
        t.mutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
          action: "global",
          subject: `address-${index}`,
          limit: 100,
          windowMs: 60_000,
          globalLimit: 2,
        }),
      ).resolves.toMatchObject({ allowed: true });
    }
    await expect(
      t.mutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
        action: "global",
        subject: "address-3",
        limit: 100,
        windowMs: 60_000,
        globalLimit: 2,
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("uses the last X-Forwarded-For hop so a spoofed first hop cannot evade a limit", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const startUrl = `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent(SITE)}`;

    for (let index = 0; index < 30; index += 1) {
      const response = await t.fetch(startUrl, {
        headers: { "x-forwarded-for": `${index}.1.1.1, 10.9.9.9` },
      });
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location") ?? "").hash).not.toContain("rate_limited");
    }
    const limited = await t.fetch(startUrl, {
      headers: { "x-forwarded-for": "99.1.1.1, 10.9.9.9" },
    });
    expect(limited.status).toBe(302);
    expect(new URL(limited.headers.get("location") ?? "").hash).toContain("rate_limited");
  });

  it("does not spend the shared ceiling for a subject the per-subject bucket refused", async () => {
    const t = newTestWithAccounts();
    const attempt = (subject: string) =>
      t.mutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
        action: "refusal",
        subject,
        limit: 1,
        windowMs: 60_000,
        globalLimit: 2,
      });

    await expect(attempt("limited")).resolves.toMatchObject({ allowed: true });
    await expect(attempt("limited")).resolves.toMatchObject({ allowed: false });
    // The refused second attempt must not have consumed the second global slot.
    await expect(attempt("second")).resolves.toMatchObject({ allowed: true });
    await expect(attempt("third")).resolves.toMatchObject({ allowed: false });
  });

  it("lets a verified request skip the shared ceiling without spending it", async () => {
    const t = newTestWithAccounts();
    const attempt = (subject: string, verified = false) =>
      t.mutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
        action: "verified",
        subject,
        limit: 5,
        windowMs: 60_000,
        globalLimit: 1,
        ...(verified ? { verified } : {}),
      });

    await expect(attempt("anonymous")).resolves.toMatchObject({ allowed: true });
    await expect(attempt("exhausted")).resolves.toMatchObject({ allowed: false });
    await expect(attempt("transaction", true)).resolves.toMatchObject({ allowed: true });
    // A verified request did not refill or spend the shared bucket.
    await expect(attempt("still-exhausted")).resolves.toMatchObject({ allowed: false });
  });

  it("keeps a per-address start flood from exhausting the shared ceiling", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    // An invalid provider is rejected after the rate-limit check, so this
    // floods the per-address bucket without starting provider work.
    const flooded = `/api/auth/native/start?provider=missing&kind=oauth&return=${encodeURIComponent(SITE)}`;
    for (let index = 0; index < NATIVE_AUTH_START_GLOBAL; index += 1) {
      const response = await t.fetch(flooded, {
        headers: { "x-forwarded-for": "203.0.113.9" },
      });
      expect(response.status).toBe(302);
    }

    // A different address still starts a real flow: the limited flood did not
    // exhaust the global budget for everyone else.
    const verifier = "b".repeat(64);
    const challenge = await hexDigest(verifier);
    const tx = txId("b");
    const start = await t.fetch(
      `/api/auth/native/start?provider=github&kind=oauth&return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${challenge}&${HANDOFF_TX_PARAM}=${tx}`,
      { headers: { "x-forwarded-for": "198.51.100.7" } },
    );
    expect(start.status).toBe(302);
    const startLocation = start.headers.get("location") ?? "";
    expect(startLocation).not.toContain("rate_limited");
    expect(startLocation).toContain("github.com");

    const sessionCookie = await signUp(t);
    const finishLocation = new URL(await finish(t, sessionCookie, challenge, tx));
    const code = finishLocation.searchParams.get("code") ?? "";
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ code, verifier }),
    });
    expect(exchanged.status).toBe(200);
  });

  it("refuses an exhausted exchange subject before peeking at the code", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const ip = "203.0.113.42";
    // The route hashes the peer address into one of 4096 buckets (the same
    // bound `consumeNativeAuthRateLimit` enforces).
    const fingerprint = await hexDigest(`native-auth:exchange:${ip}`);
    const bucket = Number.parseInt(fingerprint.slice(0, 8), 16) % 4096;
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: `native-auth:exchange:${bucket}`,
        windowStart: Date.now(),
        count: NATIVE_AUTH_EXCHANGE_PER_IP + 1,
      });
    });

    peekAccess.count = 0;
    const response = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ code: "c".repeat(64), verifier: "v".repeat(64) }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    // The old order ran `peek` first; an already-limited caller must not get a
    // free database read out of the refusal path.
    expect(peekAccess.count).toBe(0);
  });

  it("lets a valid code bypass an exhausted shared exchange ceiling", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const verifier = "a1".repeat(32);
    const challenge = await hexDigest(verifier);
    const tx = txId("a1");
    await startTransaction(t, tx, challenge);
    const finishLocation = await finish(t, cookie, challenge, tx);
    const code = new URL(finishLocation).searchParams.get("code") ?? "";
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: "native-auth:exchange:global",
        windowStart: Date.now(),
        count: NATIVE_AUTH_EXCHANGE_GLOBAL + 1,
      });
    });

    // An invalid caller from a fresh address is refused by the exhausted shared
    // bucket, so the bypass below is not just an empty limiter.
    const invalid = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE,
        "x-forwarded-for": "198.51.100.99",
      },
      body: JSON.stringify({ code: "d".repeat(64), verifier: "e".repeat(64) }),
    });
    expect(invalid.status).toBe(429);

    const exchanged = await t.fetch("/api/auth/native/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE,
        "x-forwarded-for": "198.51.100.100",
      },
      body: JSON.stringify({ code, verifier }),
    });
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as { token?: string };
    expect(body.token?.length ?? 0).toBeGreaterThan(0);
  });

  it("limits repeated finishes on one live transaction", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("2b".repeat(32));
    const tx = txId("2b");
    await startTransaction(t, tx, challenge);
    const txCookie = await transactionCookie(tx);
    // A well-formed but wrong challenge leaves the transaction row live, so
    // every attempt is charged against it instead of consuming the flow.
    const wrongChallenge = await hexDigest("2c".repeat(32));
    const finishUrl = `/api/auth/native/finish?return=${encodeURIComponent(RETURN_URL)}&${HANDOFF_CHALLENGE_PARAM}=${wrongChallenge}&${HANDOFF_TX_PARAM}=${tx}`;
    const call = () => t.fetch(finishUrl, { headers: { cookie: `${txCookie}; ${cookie}` } });

    for (let index = 0; index < NATIVE_AUTH_FINISH_PER_TX; index += 1) {
      const response = await call();
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).not.toBe(
        "rate_limited",
      );
    }
    const limited = await call();
    expect(limited.status).toBe(302);
    expect(new URL(limited.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "rate_limited",
    );
  });

  it("isolates the finish counter from precharged shared buckets", async () => {
    const t = newTestWithAccounts();
    await seedSignupWorkspace(t);
    const cookie = await signUp(t);
    const challenge = await hexDigest("2e".repeat(32));
    const tx = txId("2e");
    await startTransaction(t, tx, challenge);
    // The old limiter hashed tx ids into 4096 shared buckets, so a caller who
    // precomputed ids covering every bucket could exhaust a victim's bucket.
    // Fill the victim's old bucket to prove a live transaction no longer reads
    // that shared counter.
    const fingerprint = await hexDigest(`native-auth:finish-transaction:${tx}`);
    const bucket = Number.parseInt(fingerprint.slice(0, 8), 16) % 4096;
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: `native-auth:finish-transaction:${bucket}`,
        windowStart: Date.now(),
        count: NATIVE_AUTH_FINISH_PER_TX + 1,
      });
    });

    const location = await finish(t, cookie, challenge, tx);
    expect(new URL(location).searchParams.get("code")).toMatch(/^[0-9a-f]{64}$/);
    expect(new URL(location).searchParams.get("error")).toBeNull();
  });

  it("charges no transaction for an unknown or expired id", async () => {
    const t = newTestWithAccounts();
    const liveTx = txId("2f");
    const liveChallenge = await hexDigest("2f".repeat(32));
    await startTransaction(t, liveTx, liveChallenge);
    const expiredTx = txId("3a");
    const expiredChallenge = await hexDigest("3a".repeat(32));
    await startTransaction(t, expiredTx, expiredChallenge);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("nativeAuthTransactions").collect();
      const expired = rows.find((row) => row.challenge === expiredChallenge);
      if (expired !== undefined) {
        await ctx.db.patch(expired._id, { expiresAt: Date.now() - 1 });
      }
    });

    await expect(
      t.mutation(internal.nativeAuthHandoff.chargeTransactionFinish, { tx: txId("3b") }),
    ).resolves.toEqual({ status: "missing" });
    await expect(
      t.mutation(internal.nativeAuthHandoff.chargeTransactionFinish, { tx: expiredTx }),
    ).resolves.toEqual({ status: "expired" });

    const live = await t.run(async (ctx) =>
      (await ctx.db.query("nativeAuthTransactions").collect()).find(
        (row) => row.challenge === liveChallenge,
      ),
    );
    expect(live?.finishAttempts).toBeUndefined();
    const rateLimits = await t.run(async (ctx) => await ctx.db.query("rateLimits").collect());
    expect(rateLimits).toEqual([]);
  });
});
