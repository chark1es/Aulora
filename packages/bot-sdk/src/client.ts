/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { BotIdentity, ResolvedBotConfig } from "./config.js";
import { AuloraError, isAuthenticationError } from "./errors.js";
import { decodeConvexValue } from "./int64.js";
import type { TokenManager } from "./token.js";
import { asRecord, readResponse, serverMessage } from "./transport.js";
import { buildUrls, type CallKind, type EndpointUrls } from "./urls.js";

export type CallArgs = Record<string, unknown>;

const READ_RETRY_DELAYS_MS = [100, 250, 500] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof AuloraError)) {
    return false;
  }
  return error.code === "network_error" || (error.status !== null && error.status >= 500);
}

function isAuthReplayable(error: unknown): boolean {
  return error instanceof AuloraError && error.retryAuth && isAuthenticationError(error);
}

function looksUnauthenticated(message: string): boolean {
  return /unauthenticated|not authenticated|invalid token|authentication/i.test(message);
}

function errorCode(record: Record<string, unknown>, message: string): string {
  const data = asRecord(record.errorData);
  const code = data?.code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }
  return looksUnauthenticated(message) ? "unauthenticated" : "convex_error";
}

/**
 * Convex HTTP transport. Every request is `POST /api/{kind}` with
 * `{path,args,format:"json"}` and a Bearer JWT. Queries retry transient
 * failures; mutations and actions do not, so a retry can never duplicate work.
 */
export class ConvexClient {
  private readonly urls: EndpointUrls;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: ResolvedBotConfig,
    private readonly tokens: TokenManager,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.urls = buildUrls(config);
    this.fetchImpl = fetchImpl;
  }

  get identity(): BotIdentity | null {
    return this.tokens.identity;
  }

  /** Escape hatch used by every typed helper: `client.call("messages:send", args, "mutation")`. */
  async call<T>(
    path: string,
    args: CallArgs = {},
    kind: CallKind = "query",
    signal?: AbortSignal,
  ): Promise<T> {
    let authRetried = false;
    let readAttempt = 0;
    for (;;) {
      try {
        return await this.request<T>(path, args, kind, signal);
      } catch (error) {
        if (signal?.aborted === true) {
          throw error;
        }
        if (!authRetried && isAuthReplayable(error)) {
          authRetried = true;
          await this.tokens.refresh();
          continue;
        }
        const delay = READ_RETRY_DELAYS_MS.at(readAttempt);
        if (kind === "query" && delay !== undefined && isRetryable(error)) {
          readAttempt += 1;
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  private async request<T>(
    path: string,
    args: CallArgs,
    kind: CallKind,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = await this.tokens.getToken();
    let response: Response;
    try {
      response = await this.fetchImpl(this.urls.api(kind), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ path, args, format: "json" }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw new AuloraError("Could not reach the Convex deployment", {
        code: "network_error",
        cause: error,
      });
    }
    const raw = await readResponse(response);
    const record = asRecord(raw.payload);
    if (!raw.ok) {
      const message = serverMessage(raw.payload, `Convex request failed with HTTP ${raw.status}`);
      throw new AuloraError(message, {
        code: raw.status === 401 ? "unauthenticated" : "http_error",
        status: raw.status,
        data: raw.payload,
      });
    }
    if (record === null || record.status !== "success") {
      const message = serverMessage(raw.payload, "Convex request failed");
      throw new AuloraError(message, {
        code: record === null ? "invalid_response" : errorCode(record, message),
        status: raw.status,
        data: record?.errorData ?? raw.payload,
      });
    }
    return decodeConvexValue(record.value) as T;
  }
}
