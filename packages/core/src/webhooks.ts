/** Prefix of a webhook's author id (`webhook_<webhookDocId>`) on the messages it posts. */
export const WEBHOOK_USER_ID_PREFIX = "webhook_";

export function isWebhookUserId(userId: string): boolean {
  return userId.startsWith(WEBHOOK_USER_ID_PREFIX);
}

/** Secrets are `awh_` followed by 43 base64url characters (256 random bits). */
export const WEBHOOK_TOKEN_PREFIX = "awh_";

/** Where the Convex HTTP route lives, relative to the site origin. */
export const WEBHOOK_ROUTE_PREFIX = "/api/webhooks/";

/** Limits enforced by the server; the admin UI mirrors them. */
export const WEBHOOK_LIMITS = {
  maxPerChannel: 10,
  maxNameLength: 80,
  maxContentLength: 4000,
  /** Largest request body the endpoint reads, in bytes. */
  maxBodyBytes: 64 * 1024,
} as const;

/** Messages a single webhook may post per window; mirrors the member send limit. */
export const WEBHOOK_RATE_LIMIT = { limit: 30, windowMs: 10_000 } as const;

/**
 * The URL a webhook accepts POSTs at. `origin` is the workspace's public site
 * origin; the secret is part of the path, so treat the result like a password.
 */
export function webhookUrl(origin: string, webhookId: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${WEBHOOK_ROUTE_PREFIX}${webhookId}/${token}`;
}

/**
 * Pulls the webhook id and secret out of a request path, or `null` when the
 * path is not `/api/webhooks/<id>/<token>`. Does not validate either part.
 */
export function parseWebhookPath(pathname: string): { id: string; token: string } | null {
  if (!pathname.startsWith(WEBHOOK_ROUTE_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(WEBHOOK_ROUTE_PREFIX.length).split("/");
  const [id, token] = parts;
  if (parts.length !== 2 || id === undefined || token === undefined) {
    return null;
  }
  return id.length > 0 && token.length > 0 ? { id, token } : null;
}

export type WebhookPayloadResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: "invalid_payload" | "content_too_long" };

/**
 * Reads the message text from a webhook request body. `content` is the field;
 * `text` is accepted too so tools that speak Slack's incoming-webhook format
 * work unchanged. Anything else in the body is ignored.
 */
export function parseWebhookPayload(body: unknown): WebhookPayloadResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_payload" };
  }
  const record = body as Record<string, unknown>;
  const raw = typeof record.content === "string" ? record.content : record.text;
  if (typeof raw !== "string") {
    return { ok: false, error: "invalid_payload" };
  }
  const content = raw.trim();
  if (content.length === 0) {
    return { ok: false, error: "invalid_payload" };
  }
  if (content.length > WEBHOOK_LIMITS.maxContentLength) {
    return { ok: false, error: "content_too_long" };
  }
  return { ok: true, content };
}
