import { AuloraError } from "./errors.js";

export interface RawResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly payload: unknown;
}

/** Narrows unknown JSON to an object without asserting a shape. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads a response body, tolerating empty and non-JSON replies. */
export async function readResponse(response: Response): Promise<RawResponse> {
  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, ok: response.ok, payload };
}

/** The human-readable part of a Convex or Aulora error body. */
export function serverMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  if (record !== null) {
    for (const key of ["errorMessage", "error", "message"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
  }
  if (typeof payload === "string" && payload.length > 0) {
    return payload;
  }
  return fallback;
}

const TOKEN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_token: "The bot API token is invalid",
  bot_disabled: "This bot is disabled",
  bots_unavailable: "Bots are not available on this deployment",
  rate_limited: "The bot token endpoint is rate limited; retry shortly",
};

/** Maps `POST /bots/token` failures to a code bots can branch on. */
export function tokenError(status: number, payload: unknown): AuloraError {
  const record = asRecord(payload);
  const errorValue = record?.error;
  const code =
    typeof errorValue === "string" && errorValue.length > 0 ? errorValue : `http_${status}`;
  const fallback = TOKEN_ERROR_MESSAGES[code] ?? `Token exchange failed with HTTP ${status}`;
  return new AuloraError(serverMessage(payload, fallback), {
    code,
    status,
    data: payload,
    retryAuth: false,
  });
}
