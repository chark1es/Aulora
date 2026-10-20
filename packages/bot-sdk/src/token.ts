import type { BotIdentity, ResolvedBotConfig } from "./config.js";
import { AuloraError } from "./errors.js";
import { asRecord, readResponse, tokenError } from "./transport.js";
import { buildUrls, type EndpointUrls } from "./urls.js";

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly identity: BotIdentity;
}

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 55 * 60 * 1000;

function isExpiring(expiresAt: number, now: number): boolean {
  return expiresAt - now <= EXPIRY_MARGIN_MS;
}

function readIdentity(record: Record<string, unknown>, config: ResolvedBotConfig): BotIdentity {
  const userId = record.userId;
  const name = record.name;
  const botId = record.botId;
  return {
    userId: typeof userId === "string" ? userId : (config.identity?.userId ?? ""),
    name: typeof name === "string" ? name : (config.identity?.name ?? ""),
    ...(typeof botId === "string" && botId.length > 0
      ? { botId }
      : config.identity?.botId !== undefined
        ? { botId: config.identity.botId }
        : {}),
  };
}

/**
 * Exchanges the long-lived API token for a one-hour JWT and refreshes it five
 * minutes before expiry. Concurrent callers share one in-flight exchange.
 */
export class TokenManager {
  private readonly urls: EndpointUrls;
  private readonly fetchImpl: typeof fetch;
  private cached: CachedToken | null = null;
  private refreshing: Promise<CachedToken> | null = null;

  constructor(
    private readonly config: ResolvedBotConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.urls = buildUrls(config);
    this.fetchImpl = fetchImpl;
  }

  get identity(): BotIdentity | null {
    return this.cached?.identity ?? this.config.identity;
  }

  /** Returns a valid JWT, exchanging the API token when the cache is stale. */
  async getToken(): Promise<string> {
    const cached = this.cached;
    if (cached !== null && !isExpiring(cached.expiresAt, Date.now())) {
      return cached.token;
    }
    return (await this.exchange()).token;
  }

  /** Forces a new JWT after the server rejects the cached one. */
  async refresh(): Promise<string> {
    this.cached = null;
    return (await this.exchange()).token;
  }

  private exchange(): Promise<CachedToken> {
    if (this.refreshing !== null) {
      return this.refreshing;
    }
    const pending = this.requestToken().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = pending;
    return pending;
  }

  private async requestToken(): Promise<CachedToken> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.urls.token, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.config.token}`,
          Accept: "application/json",
        },
      });
    } catch (error) {
      throw new AuloraError("Could not reach the Aulora token endpoint", {
        code: "network_error",
        cause: error,
      });
    }
    const raw = await readResponse(response);
    if (!raw.ok) {
      throw tokenError(raw.status, raw.payload);
    }
    const record = asRecord(raw.payload);
    const jwt = record?.token;
    if (record === null || typeof jwt !== "string" || jwt.length === 0) {
      throw new AuloraError("The token endpoint returned a malformed response", {
        code: "invalid_response",
        status: raw.status,
        data: raw.payload,
      });
    }
    const expiresAt =
      typeof record.expiresAt === "number" ? record.expiresAt : Date.now() + FALLBACK_TTL_MS;
    this.cached = { token: jwt, expiresAt, identity: readIdentity(record, this.config) };
    return this.cached;
  }
}
