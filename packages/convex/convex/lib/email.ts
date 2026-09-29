/**
 * Outbound email. Two transports are supported:
 *  - `resend`: a plain HTTPS call to the Resend API (works in the Convex
 *    runtime, which has no raw TCP).
 *  - `smtp`: an HTTP bridge (`SMTP_GATEWAY_URL`) that speaks SMTP on the
 *    server's behalf, because Convex actions cannot open raw sockets.
 * An unconfigured deployment no-ops and logs, so email is never required for a
 * core flow such as inviting a user.
 */

export type EmailProvider = "resend" | "smtp" | "none";

export interface EmailConfig {
  readonly provider: EmailProvider;
  readonly from: string;
  readonly resendApiKey: string | undefined;
  readonly smtpGatewayUrl: string | undefined;
}

export type EmailSkipReason = "unconfigured" | "error";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface SendEmailResult {
  readonly sent: boolean;
  readonly provider: EmailProvider;
  readonly skipped?: EmailSkipReason;
}

export const DEFAULT_EMAIL_FROM = "Aulora <no-reply@aulora.local>";

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function normalizeProvider(raw: string | undefined): EmailProvider | null {
  if (raw === "resend" || raw === "smtp" || raw === "none") {
    return raw;
  }
  return null;
}

/**
 * Resolves the email transport from the environment. An explicit
 * `AULORA_EMAIL_PROVIDER` wins; otherwise the presence of `RESEND_API_KEY` or
 * `SMTP_GATEWAY_URL` is inferred. A configured provider without its required
 * endpoint degrades to `none`.
 */
export function parseEmailConfig(env: Env = process.env): EmailConfig {
  const resendApiKey = read(env, "RESEND_API_KEY");
  const smtpGatewayUrl = read(env, "SMTP_GATEWAY_URL");
  const from = read(env, "AULORA_EMAIL_FROM") ?? DEFAULT_EMAIL_FROM;

  let provider = normalizeProvider(read(env, "AULORA_EMAIL_PROVIDER")?.toLowerCase());
  if (provider === null) {
    provider =
      resendApiKey !== undefined ? "resend" : smtpGatewayUrl !== undefined ? "smtp" : "none";
  }
  if (provider === "resend" && resendApiKey === undefined) {
    provider = "none";
  }
  if (provider === "smtp" && smtpGatewayUrl === undefined) {
    provider = "none";
  }

  return { provider, from, resendApiKey, smtpGatewayUrl };
}

export interface SendEmailDeps {
  readonly env?: Env;
  readonly fetch?: typeof fetch;
}

/**
 * Sends one message over the configured transport. Failures are returned,
 * never thrown, so a scheduled invite or notification cannot break a mutation.
 * Nothing here logs the API key or gateway URL.
 */
export async function sendEmail(
  message: EmailMessage,
  deps: SendEmailDeps = {},
): Promise<SendEmailResult> {
  const env = deps.env ?? process.env;
  const config = parseEmailConfig(env);
  if (config.provider === "none") {
    console.info(`[email] no provider configured; skipping message to ${message.to}`);
    return { sent: false, provider: "none", skipped: "unconfigured" };
  }

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { sent: false, provider: config.provider, skipped: "error" };
  }

  try {
    if (config.provider === "resend") {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.resendApiKey ?? ""}`,
        },
        body: JSON.stringify({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html !== undefined ? { html: message.html } : {}),
        }),
      });
      return response.ok
        ? { sent: true, provider: "resend" }
        : { sent: false, provider: "resend", skipped: "error" };
    }

    const response = await fetchImpl(config.smtpGatewayUrl ?? "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html !== undefined ? { html: message.html } : {}),
      }),
    });
    return response.ok
      ? { sent: true, provider: "smtp" }
      : { sent: false, provider: "smtp", skipped: "error" };
  } catch {
    return { sent: false, provider: config.provider, skipped: "error" };
  }
}
