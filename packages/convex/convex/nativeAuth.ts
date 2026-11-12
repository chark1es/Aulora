import type { HttpRouter } from "convex/server";
import { api, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { createAuth } from "./auth";
import { getBetterAuthSecret } from "./lib/env";
import {
  type AuthReturnTarget,
  HANDOFF_CHALLENGE_PARAM,
  HANDOFF_CODE_PARAM,
  HANDOFF_ERROR_PARAM,
  HANDOFF_HASH_CODE,
  HANDOFF_HASH_ERROR,
  HANDOFF_HASH_SERVER,
  HANDOFF_SERVER_PARAM,
  HANDOFF_TX_PARAM,
  isHandoffChallenge,
  isHandoffTx,
  NATIVE_AUTH_EXCHANGE_GLOBAL,
  NATIVE_AUTH_EXCHANGE_PER_IP,
  NATIVE_AUTH_EXPIRED_ERROR,
  NATIVE_AUTH_FINISH_GLOBAL,
  NATIVE_AUTH_FINISH_PER_IP,
  NATIVE_AUTH_FINISH_PER_SESSION,
  NATIVE_AUTH_RATE_WINDOW_MS,
  NATIVE_AUTH_START_GLOBAL,
  NATIVE_AUTH_START_PER_IP,
  NATIVE_AUTH_TX_COOKIE_GRACE_MS,
  NATIVE_AUTH_TX_TTL_MS,
  nativeAuthTxCookieName,
  nativeAuthUrls,
  parseAuthReturnTarget,
  readHandoffTransaction,
  sanitizeHandoffError,
  signHandoffTransaction,
  withHandoffParams,
} from "./lib/nativeAuth";

/**
 * First-party OAuth start, finish and exchange routes for native and desktop
 * clients.
 *
 * The start route is a navigation on the workspace origin, so Better Auth sets
 * its signed `state` cookie in the same browsing context that will receive the
 * provider callback. The finish route reads the session the callback created
 * and sends a short-lived, single-use code to the client; the exchange route
 * trades that code and the client-held verifier for the bearer token.
 */

type AuthLike = ReturnType<typeof createAuth>;

/** An error code has no value a client should ever display verbatim. */
const GENERIC_HANDOFF_ERROR = "auth_failed";
/** One generic answer for unknown, expired, consumed and wrong-verifier codes. */
const INVALID_CODE = "invalid_code";

/**
 * Counts one hit without throwing, so the route can choose its response.
 * `globalLimit` is set only for unauthenticated actions; a `verified` caller
 * proved a transaction or code and skips that shared emergency ceiling.
 */
async function allowNativeAuth(
  ctx: ActionCtx,
  action: string,
  subject: string,
  limit: number,
  globalLimit?: number,
  verified: boolean = false,
): Promise<boolean> {
  const result = await ctx.runMutation(internal.nativeAuthHandoff.consumeNativeAuthRateLimit, {
    action,
    subject,
    limit,
    windowMs: NATIVE_AUTH_RATE_WINDOW_MS,
    ...(globalLimit !== undefined ? { globalLimit } : {}),
    ...(verified ? { verified } : {}),
  });
  return result.allowed;
}

/**
 * Spends one hit of an action's shared anonymous ceiling without touching any
 * per-subject bucket. The exchange route charges the per-subject allowance
 * first, so it can only decide about the shared bucket afterwards.
 */
async function allowNativeAuthGlobal(
  ctx: ActionCtx,
  action: string,
  limit: number,
): Promise<boolean> {
  const result = await ctx.runMutation(internal.nativeAuthHandoff.consumeNativeAuthGlobalLimit, {
    action,
    limit,
    windowMs: NATIVE_AUTH_RATE_WINDOW_MS,
  });
  return result.allowed;
}

/**
 * The peer address. The shipped nginx template overwrites `X-Real-IP` with
 * `$remote_addr` on every proxied location, so that header is authoritative
 * behind the deployment's own proxy. A client-controlled `X-Forwarded-For` is
 * only a fallback for an operator who terminated TLS elsewhere; its LAST hop is
 * the one appended by the nearest proxy, never the first hop the caller wrote.
 *
 * Trusted-proxy assumption: an edge proxy in front of this container must also
 * overwrite `X-Real-IP` (or append itself to `X-Forwarded-For`) rather than pass
 * a caller-supplied value through.
 */
function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp !== undefined && realIp.length > 0) {
    return realIp;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const last = hops[hops.length - 1];
    if (last !== undefined) {
      return last;
    }
  }
  return "unknown";
}

/** Reads one cookie value from the request, if present. */
function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null || header.length === 0) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function secureCookies(siteOrigin: string): boolean {
  return siteOrigin.startsWith("https://");
}

function txCookieAttributes(siteOrigin: string): string {
  return [
    "Path=/api/auth/native",
    "HttpOnly",
    "SameSite=Lax",
    ...(secureCookies(siteOrigin) ? ["Secure"] : []),
  ].join("; ");
}

async function transactionCookie(secret: string, tx: string, siteOrigin: string): Promise<string> {
  const value = await signHandoffTransaction(secret, tx);
  const name = await nativeAuthTxCookieName(tx);
  const maxAge = Math.ceil((NATIVE_AUTH_TX_TTL_MS + NATIVE_AUTH_TX_COOKIE_GRACE_MS) / 1000);
  return `${name}=${value}; ${txCookieAttributes(siteOrigin)}; Max-Age=${maxAge}`;
}

/**
 * Expires only the cookie for this one transaction. A mismatch must never clear
 * another flow's cookie: two sign-ins can be in flight in the same browser.
 */
async function clearedTransactionCookie(tx: string, siteOrigin: string): Promise<string> {
  const name = await nativeAuthTxCookieName(tx);
  return `${name}=; ${txCookieAttributes(siteOrigin)}; Max-Age=0`;
}

/** The auth signing secret shared with Better Auth's session cookies. */
function authSecret(): string {
  return getBetterAuthSecret(process.env) ?? "";
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  // Headers instances are iterable, not plain records. Spreading one drops
  // the CORS headers, so a desktop exchange consumes its code but the webview
  // cannot read the returned session token.
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  noStore(responseHeaders);
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function setCookies(headers: Headers): string[] {
  const getSetCookie = (headers as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(headers);
    if (Array.isArray(values)) {
      return values;
    }
  }
  const combined = headers.get("set-cookie");
  return combined === null || combined.length === 0 ? [] : [combined];
}

function noStore(headers: Headers): Headers {
  headers.set("cache-control", "no-store");
  return headers;
}

async function corsHeaders(auth: AuthLike, request: Request): Promise<Headers> {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (origin === null || origin.length === 0) {
    return headers;
  }
  // A Tauri webview on some platforms sends `Origin: null` for a custom-scheme
  // page. The exchange carries no cookie, so its own short-lived code is the
  // credential; allowing the null origin only lets that app read its answer.
  if (origin === "null") {
    headers.set("access-control-allow-origin", "null");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("vary", "origin");
    return headers;
  }
  const context = await auth.$context;
  if (!context.isTrustedOrigin(origin, { allowRelativePaths: false })) {
    return headers;
  }
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "origin");
  return headers;
}

/**
 * Runs Better Auth's sign-in route as a same-origin POST and turns the answer
 * into a redirect while keeping every cookie it set.
 */
async function providerAuthorization(
  auth: AuthLike,
  authBase: string,
  siteOrigin: string,
  providerId: string,
  kind: "oauth" | "oidc",
  callbackURL: string,
  request: Request,
): Promise<{ redirect: string; cookies: string[] } | { error: string }> {
  const endpoint = kind === "oidc" ? "/sign-in/oauth2" : "/sign-in/social";
  const body =
    kind === "oidc"
      ? { providerId, callbackURL, errorCallbackURL: callbackURL, disableRedirect: true }
      : { provider: providerId, callbackURL, errorCallbackURL: callbackURL, disableRedirect: true };
  // `authBase` already ends in `/api/auth`; only a real origin is a valid
  // `Origin` header, so send the browser-facing origin here.
  const headers = new Headers({
    "content-type": "application/json",
    origin: siteOrigin,
    "cache-control": "no-store",
  });
  const userAgent = request.headers.get("user-agent");
  if (userAgent !== null) {
    headers.set("user-agent", userAgent);
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    headers.set("x-forwarded-for", forwardedFor);
  }
  const response = await auth.handler(
    new Request(`${authBase}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  if (!response.ok) {
    return { error: "provider_unavailable" };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { error: "provider_unavailable" };
  }
  const url =
    typeof data === "object" && data !== null && "url" in data
      ? (data as { url?: unknown }).url
      : undefined;
  if (typeof url !== "string" || url.length === 0) {
    return { error: "provider_unavailable" };
  }
  const cookies = setCookies(response.headers);
  return { redirect: url, cookies };
}

function redirectTo(location: string, cookies: readonly string[] = []): Response {
  const headers = noStore(new Headers({ location }));
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}

/** The fragment or query key this return target reads its error from. */
function errorParam(target: { readonly kind: string }): string {
  return target.kind === "custom" ? HANDOFF_ERROR_PARAM : HANDOFF_HASH_ERROR;
}

/** The fragment or query key carrying the issuing workspace origin. */
function serverParam(target: { readonly kind: string }): string {
  return target.kind === "custom" ? HANDOFF_SERVER_PARAM : HANDOFF_HASH_SERVER;
}

function redirectError(
  target: AuthReturnTarget,
  code: string,
  siteOrigin: string,
  tx: string | null = null,
  cookies: readonly string[] = [],
): Response {
  return redirectTo(
    withHandoffParams(target, {
      [errorParam(target)]: code,
      // Clients require this to match the pending transaction before showing
      // the error, so an arbitrary link cannot paint one into the app.
      [serverParam(target)]: siteOrigin,
      ...(tx !== null ? { [HANDOFF_TX_PARAM]: tx } : {}),
    }),
    cookies,
  );
}

/**
 * A return target the deployment already controls, used when the requested
 * `return` is missing or untrusted. A raw JSON 400 strands a browser that
 * started OAuth; the workspace origin is always safe and its app can show the
 * allowlisted error code.
 */
function safeErrorTarget(siteOrigin: string): AuthReturnTarget {
  return { kind: "web", url: siteOrigin };
}

/** A same-origin web return needs no code: the callback already set a cookie. */
function isSameOriginWebReturn(
  target: { readonly kind: string; readonly url: string },
  siteOrigin: string,
): boolean {
  return target.kind === "web" && target.url === siteOrigin;
}

export function registerNativeAuthRoutes(http: HttpRouter) {
  http.route({
    path: "/api/auth/native/start",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const providerId = url.searchParams.get("provider");
      const kind = url.searchParams.get("kind");
      const rawReturn = url.searchParams.get("return");
      const challenge = url.searchParams.get(HANDOFF_CHALLENGE_PARAM);
      const tx = url.searchParams.get(HANDOFF_TX_PARAM);
      const echoedTx = isHandoffTx(tx) ? tx : null;
      const auth = createAuth(ctx);
      const context = await auth.$context;
      const { authBase, siteOrigin } = nativeAuthUrls(context.baseURL);
      const target = parseAuthReturnTarget(rawReturn, context.trustedOrigins, siteOrigin);
      if (target === null) {
        return redirectError(safeErrorTarget(siteOrigin), "invalid_return", siteOrigin, echoedTx);
      }
      if (
        !(await allowNativeAuth(
          ctx,
          "start",
          clientIp(request),
          NATIVE_AUTH_START_PER_IP,
          NATIVE_AUTH_START_GLOBAL,
        ))
      ) {
        return redirectError(target, "rate_limited", siteOrigin, echoedTx);
      }
      // Any target that receives a code must be paired with the client's
      // verifier challenge and transaction id. A same-origin web return never
      // mints a code and needs neither.
      const needsCode = !isSameOriginWebReturn(target, siteOrigin);
      if (needsCode && !isHandoffChallenge(challenge)) {
        return redirectError(target, "invalid_request", siteOrigin, echoedTx);
      }
      if (needsCode && !isHandoffTx(tx)) {
        return redirectError(target, "invalid_request", siteOrigin, echoedTx);
      }
      if (providerId === null || providerId.length === 0 || (kind !== "oauth" && kind !== "oidc")) {
        return redirectError(target, "invalid_provider", siteOrigin, echoedTx);
      }

      const config = await ctx.runQuery(api.server.publicConfig, {});
      const provider = config.auth.providers.find((entry) => entry.id === providerId);
      if (provider === undefined || provider.type !== kind) {
        return redirectError(target, "invalid_provider", siteOrigin, echoedTx);
      }

      // The finish route only mints a code when the browser that follows this
      // navigation also presents the transaction cookie set here. The cookie is
      // the binding the ambient session cookie cannot provide: a cross-site
      // top-level navigation sends the session, but not a transaction the
      // attacker cannot create in the victim's browser.
      const secret = authSecret();
      if (
        needsCode &&
        (secret.length === 0 || !isHandoffTx(tx) || !isHandoffChallenge(challenge))
      ) {
        return redirectError(target, "server_error", siteOrigin, isHandoffTx(tx) ? tx : null);
      }
      if (needsCode && isHandoffTx(tx) && isHandoffChallenge(challenge)) {
        await ctx.runMutation(internal.nativeAuthHandoff.createTransaction, {
          tx,
          challenge,
          returnTarget: rawReturn ?? "",
        });
      }

      // The callback returns to this workspace first, so the finish route can
      // read the session the callback just set. The challenge and transaction
      // ride along in the query (the challenge is a digest, not the verifier).
      // A same-origin web return also carries `tx` so every redirect back can
      // echo it; it still mints no code and creates no transaction.
      const finish = new URL(`${authBase}/native/finish`);
      finish.searchParams.set("return", rawReturn ?? "");
      if (isHandoffChallenge(challenge)) {
        finish.searchParams.set(HANDOFF_CHALLENGE_PARAM, challenge);
      }
      if (isHandoffTx(tx)) {
        finish.searchParams.set(HANDOFF_TX_PARAM, tx);
      }
      let result: Awaited<ReturnType<typeof providerAuthorization>>;
      try {
        result = await providerAuthorization(
          auth,
          authBase,
          siteOrigin,
          provider.id,
          kind,
          finish.toString(),
          request,
        );
      } catch {
        result = { error: "provider_unavailable" };
      }
      if ("error" in result) {
        let consumed = false;
        if (needsCode && isHandoffTx(tx) && isHandoffChallenge(challenge)) {
          consumed = await ctx.runMutation(internal.nativeAuthHandoff.consumeTransaction, {
            tx,
            challenge,
            returnTarget: rawReturn ?? "",
          });
        }
        return redirectError(
          target,
          result.error,
          siteOrigin,
          // Echo the client's own transaction id on every error, including a
          // same-origin web return, so the client can bind the message to the
          // sign-in it started.
          isHandoffTx(tx) ? tx : null,
          consumed && isHandoffTx(tx) ? [await clearedTransactionCookie(tx, siteOrigin)] : [],
        );
      }
      const cookies = [...result.cookies];
      if (needsCode && isHandoffTx(tx)) {
        cookies.push(await transactionCookie(secret, tx, siteOrigin));
      }
      return redirectTo(result.redirect, cookies);
    }),
  });

  http.route({
    path: "/api/auth/native/finish",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const rawReturn = url.searchParams.get("return");
      const challenge = url.searchParams.get(HANDOFF_CHALLENGE_PARAM);
      const queryTx = url.searchParams.get(HANDOFF_TX_PARAM);
      const auth = createAuth(ctx);
      const context = await auth.$context;
      const { siteOrigin } = nativeAuthUrls(context.baseURL);
      const secret = authSecret();
      // Every start transaction owns its own cookie name. Only the cookie named
      // by this request's `tx` can bind it; a cookie for a concurrent flow is
      // never read or cleared.
      const cookieTx =
        isHandoffTx(queryTx) && secret.length > 0
          ? await readHandoffTransaction(
              secret,
              cookieValue(request, await nativeAuthTxCookieName(queryTx)),
            )
          : null;
      const echoedTx = isHandoffTx(queryTx) ? queryTx : null;
      // Never relay the provider's own text: only an allowlisted code reaches
      // the client, and an unknown value becomes a generic one.
      const providerError = sanitizeHandoffError(url.searchParams.get("error"));
      const target = parseAuthReturnTarget(rawReturn, context.trustedOrigins, siteOrigin);
      if (target === null) {
        return redirectError(safeErrorTarget(siteOrigin), "invalid_return", siteOrigin, echoedTx);
      }
      if (
        !(await allowNativeAuth(
          ctx,
          "finish",
          clientIp(request),
          NATIVE_AUTH_FINISH_PER_IP,
          // The shared ceiling is charged separately below, once the request is
          // known not to name a live transaction. A signature-valid cookie is
          // not proof of one: it can outlive its row.
        ))
      ) {
        return redirectError(target, "rate_limited", siteOrigin, echoedTx);
      }

      // A same-origin web return already has the session cookie: no code or
      // token needs to cross the address bar, so it needs no transaction. It
      // still echoes the client's `tx` so a cancelled or failed provider
      // attempt can be shown against the sign-in this tab started.
      if (isSameOriginWebReturn(target, siteOrigin)) {
        if (!(await allowNativeAuthGlobal(ctx, "finish", NATIVE_AUTH_FINISH_GLOBAL))) {
          return redirectError(target, "rate_limited", siteOrigin, echoedTx);
        }
        if (providerError !== null) {
          return redirectError(target, providerError, siteOrigin, echoedTx);
        }
        const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
        if (session === null) {
          return redirectError(target, "auth_cancelled", siteOrigin, echoedTx);
        }
        return redirectTo(
          echoedTx === null
            ? target.url
            : withHandoffParams(target, { [HANDOFF_TX_PARAM]: echoedTx }),
        );
      }

      // Without the cookie that `native/start` set in this browser, there is no
      // transaction this request may redeem. The ambient session cookie alone
      // is not proof that this browser started the flow: a cross-site top-level
      // navigation sends it too. Mint nothing and land on the workspace's own
      // error page instead of an attacker-supplied return target. A mismatch
      // never clears a cookie: another sign-in may still need its own.
      if (cookieTx === null) {
        if (!(await allowNativeAuthGlobal(ctx, "finish", NATIVE_AUTH_FINISH_GLOBAL))) {
          return redirectError(target, "rate_limited", siteOrigin, echoedTx);
        }
        return redirectError(
          safeErrorTarget(siteOrigin),
          "invalid_request",
          siteOrigin,
          isHandoffTx(queryTx) ? queryTx : null,
        );
      }
      if (!isHandoffTx(queryTx) || queryTx !== cookieTx) {
        if (!(await allowNativeAuthGlobal(ctx, "finish", NATIVE_AUTH_FINISH_GLOBAL))) {
          return redirectError(target, "rate_limited", siteOrigin, echoedTx);
        }
        return redirectError(safeErrorTarget(siteOrigin), "invalid_request", siteOrigin, echoedTx);
      }
      // Charge the finish against this exact live transaction. The counter lives
      // on its own row, so precomputing transaction ids that cover every shared
      // hash bucket cannot spend another flow's allowance. A missing or expired
      // id charges nothing and remains behind the anonymous shared ceiling.
      const charged = await ctx.runMutation(internal.nativeAuthHandoff.chargeTransactionFinish, {
        tx: cookieTx,
      });
      if (charged.status === "rate_limited") {
        return redirectError(target, "rate_limited", siteOrigin, cookieTx);
      }
      if (charged.status === "expired") {
        // An expired row is anonymous work like a missing one: it does not get
        // the live-transaction bypass of the shared ceiling.
        if (!(await allowNativeAuthGlobal(ctx, "finish", NATIVE_AUTH_FINISH_GLOBAL))) {
          return redirectError(target, "rate_limited", siteOrigin, cookieTx);
        }
        // The redirect already tells the client `auth_expired`; drop the stale
        // cookie too so a refresh cannot replay it into `auth_failed`.
        return redirectError(target, NATIVE_AUTH_EXPIRED_ERROR, siteOrigin, cookieTx, [
          await clearedTransactionCookie(cookieTx, siteOrigin),
        ]);
      }
      if (
        charged.status !== "allowed" &&
        !(await allowNativeAuthGlobal(ctx, "finish", NATIVE_AUTH_FINISH_GLOBAL))
      ) {
        return redirectError(target, "rate_limited", siteOrigin, cookieTx);
      }

      if (providerError !== null) {
        const consumed = await ctx.runMutation(internal.nativeAuthHandoff.consumeTransaction, {
          tx: cookieTx,
          challenge: challenge ?? "",
          returnTarget: rawReturn ?? "",
        });
        return redirectError(
          target,
          providerError,
          siteOrigin,
          cookieTx,
          consumed ? [await clearedTransactionCookie(cookieTx, siteOrigin)] : [],
        );
      }
      const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
      if (session === null) {
        const consumed = await ctx.runMutation(internal.nativeAuthHandoff.consumeTransaction, {
          tx: cookieTx,
          challenge: challenge ?? "",
          returnTarget: rawReturn ?? "",
        });
        return redirectError(
          target,
          "auth_cancelled",
          siteOrigin,
          cookieTx,
          consumed ? [await clearedTransactionCookie(cookieTx, siteOrigin)] : [],
        );
      }
      if (!isHandoffChallenge(challenge)) {
        const consumed = await ctx.runMutation(internal.nativeAuthHandoff.consumeTransaction, {
          tx: cookieTx,
          challenge: challenge ?? "",
          returnTarget: rawReturn ?? "",
        });
        return redirectError(
          target,
          "invalid_request",
          siteOrigin,
          cookieTx,
          consumed ? [await clearedTransactionCookie(cookieTx, siteOrigin)] : [],
        );
      }
      // One session may only mint a bounded number of codes per window, so a
      // valid session cannot turn the finish route into a row-writing loop.
      if (
        !(await allowNativeAuth(
          ctx,
          "finish-session",
          session.session.id,
          NATIVE_AUTH_FINISH_PER_SESSION,
        ))
      ) {
        return redirectError(target, "rate_limited", siteOrigin, cookieTx);
      }
      let code: string;
      try {
        // The transaction is checked and deleted in the same mutation that
        // inserts the code, so a replay or a concurrent duplicate mints nothing.
        const minted = await ctx.runMutation(internal.nativeAuthHandoff.create, {
          token: session.session.token,
          challenge,
          server: siteOrigin,
          tx: cookieTx,
          returnTarget: rawReturn ?? "",
        });
        if (minted.status === "expired") {
          // The transaction expired between the charge and the mint; the
          // redirect already says `auth_expired`, so expire its cookie too.
          return redirectError(target, NATIVE_AUTH_EXPIRED_ERROR, siteOrigin, cookieTx, [
            await clearedTransactionCookie(cookieTx, siteOrigin),
          ]);
        }
        if (minted.status !== "ok") {
          return redirectError(target, GENERIC_HANDOFF_ERROR, siteOrigin, cookieTx);
        }
        code = minted.code;
      } catch {
        return redirectError(target, GENERIC_HANDOFF_ERROR, siteOrigin, cookieTx);
      }
      const params: Record<string, string> =
        target.kind === "custom"
          ? {
              [HANDOFF_CODE_PARAM]: code,
              [HANDOFF_SERVER_PARAM]: siteOrigin,
              [HANDOFF_TX_PARAM]: cookieTx,
            }
          : {
              [HANDOFF_HASH_CODE]: code,
              [HANDOFF_HASH_SERVER]: siteOrigin,
              [HANDOFF_TX_PARAM]: cookieTx,
            };
      return redirectTo(withHandoffParams(target, params), [
        await clearedTransactionCookie(cookieTx, siteOrigin),
      ]);
    }),
  });

  http.route({
    path: "/api/auth/native/exchange",
    method: "OPTIONS",
    handler: httpAction(async (ctx, request) => {
      const headers = await corsHeaders(createAuth(ctx), request);
      return new Response(null, { status: 204, headers: noStore(headers) });
    }),
  });

  http.route({
    path: "/api/auth/native/exchange",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const auth = createAuth(ctx);
      const headers = await corsHeaders(auth, request);
      if (request.headers.get("origin") !== null && !headers.has("access-control-allow-origin")) {
        return json({ error: "origin_not_allowed" }, 403, headers);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, headers);
      }
      if (typeof body !== "object" || body === null) {
        return json({ error: INVALID_CODE }, 400, headers);
      }
      const record = body as { code?: unknown; verifier?: unknown };
      if (typeof record.code !== "string" || typeof record.verifier !== "string") {
        return json({ error: INVALID_CODE }, 400, headers);
      }
      // Charge the per-subject allowance before any database lookup: an
      // already-limited caller must not be able to drive handoff reads. A
      // refused caller gets the 429 without `peek` ever running.
      if (
        !(await allowNativeAuth(ctx, "exchange", clientIp(request), NATIVE_AUTH_EXCHANGE_PER_IP))
      ) {
        return json({ error: "rate_limited" }, 429, headers);
      }
      // A code+verifier that could still be redeemed is proof of a real
      // sign-in, so it skips the shared anonymous ceiling. `peek` never
      // consumes; `consume` below remains the authoritative single-use check.
      const verified = await ctx.runQuery(internal.nativeAuthHandoff.peek, {
        code: record.code,
        verifier: record.verifier,
      });
      // Only unverified work spends the shared ceiling, and it does so after
      // the cheap proof of possession: a valid code bypasses this bucket even
      // when an anonymous flood has exhausted it.
      if (
        !verified &&
        !(await allowNativeAuthGlobal(ctx, "exchange", NATIVE_AUTH_EXCHANGE_GLOBAL))
      ) {
        return json({ error: "rate_limited" }, 429, headers);
      }
      const consumed = await ctx.runMutation(internal.nativeAuthHandoff.consume, {
        code: record.code,
        verifier: record.verifier,
      });
      if (consumed === null) {
        return json({ error: INVALID_CODE }, 400, headers);
      }
      return json({ token: consumed.token, server: consumed.server }, 200, headers);
    }),
  });
}
