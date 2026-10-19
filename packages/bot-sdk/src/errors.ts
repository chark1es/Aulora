/**
 * Errors raised by the SDK. Every failure the server reports (a missing
 * permission, a disabled bot, a malformed request) becomes an {@link AuloraError}
 * so bot code can branch on `code` instead of parsing messages.
 */
export interface AuloraErrorOptions {
  readonly code?: string;
  readonly data?: unknown;
  readonly status?: number | null;
  readonly cause?: unknown;
  /**
   * Whether a 401 should trigger a JWT refresh and replay. Token-exchange
   * failures set this to `false`; the API token itself is wrong, not the JWT.
   */
  readonly retryAuth?: boolean;
}

export class AuloraError extends Error {
  /** Stable machine-readable code, e.g. `invalid_token` or `convex_error`. */
  readonly code: string;
  /** `errorData` from Convex or the token endpoint body, when present. */
  readonly data: unknown;
  /** HTTP status, or `null` for network failures. */
  readonly status: number | null;
  readonly retryAuth: boolean;

  constructor(message: string, options: AuloraErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AuloraError";
    this.code = options.code ?? "aulora_error";
    this.data = options.data ?? null;
    this.status = options.status ?? null;
    this.retryAuth = options.retryAuth ?? true;
  }
}

/** True for a rejected JWT, so the client can refresh once and replay the call. */
export function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof AuloraError)) {
    return false;
  }
  if (error.status === 401) {
    return true;
  }
  const code = error.code.toLowerCase();
  if (code.includes("unauthenticated") || code.includes("unauthorized")) {
    return true;
  }
  return /unauthenticated|not authenticated|invalid token|authentication/i.test(error.message);
}

/** Coerces an unknown thrown value into an `Error` for the `error` event. */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("Unknown bot error");
}
