import { AuloraError } from "./errors.js";

/** The bot's own identity, as carried by the JWT and the event poll. */
export interface BotIdentity {
  readonly userId: string;
  readonly name: string;
  readonly botId?: string;
}

/** Constructor options. Explicit values override the `AULORA_*` environment. */
export interface BotOptions {
  /** API token (`abt_...`). Defaults to `AULORA_TOKEN`. */
  readonly token?: string;
  /** Convex site origin that serves `POST /bots/token`. Defaults to `AULORA_SITE_URL`. */
  readonly siteUrl?: string;
  /** Convex deployment origin that serves `/api/query|mutation|action`. Defaults to `AULORA_CONVEX_URL`. */
  readonly convexUrl?: string;
  /** Event poll interval in milliseconds (default 1000). */
  readonly pollIntervalMs?: number;
  /** Deliver the bot's own events. Defaults to `false`. */
  readonly includeSelf?: boolean;
  /** Stop on SIGTERM/SIGINT. Defaults to `true`; set `false` when embedding. */
  readonly handleSignals?: boolean;
}

export interface ResolvedBotConfig {
  readonly token: string;
  readonly siteUrl: string;
  readonly convexUrl: string;
  readonly pollIntervalMs: number;
  readonly includeSelf: boolean;
  readonly handleSignals: boolean;
  /** Runner-injected identity, available before the first token exchange. */
  readonly identity: BotIdentity | null;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

function normalizeUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuloraError(`${label} must be an absolute URL`, {
      code: "invalid_config",
      data: { label },
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AuloraError(`${label} must use http or https`, {
      code: "invalid_config",
      data: { label },
    });
  }
  return parsed.toString().replace(/\/+$/, "");
}

function readPollInterval(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new AuloraError("pollIntervalMs must be a positive number", {
      code: "invalid_config",
    });
  }
  return value;
}

function envIdentity(): BotIdentity | null {
  const userId = process.env.AULORA_BOT_USER_ID;
  if (userId === undefined || userId.length === 0) {
    return null;
  }
  const botId = process.env.AULORA_BOT_ID;
  return {
    userId,
    name: process.env.AULORA_BOT_NAME ?? "",
    ...(botId !== undefined && botId.length > 0 ? { botId } : {}),
  };
}

/**
 * Validates the configuration once, at construction, so every later module can
 * trust the URLs. Missing values are a programming error, not a retryable one.
 */
export function resolveBotConfig(options: BotOptions = {}): ResolvedBotConfig {
  const apiToken = options.token ?? process.env.AULORA_TOKEN;
  if (apiToken === undefined || apiToken.length === 0) {
    throw new AuloraError("A bot token is required (pass token or set AULORA_TOKEN)", {
      code: "invalid_config",
    });
  }
  const siteUrl = options.siteUrl ?? process.env.AULORA_SITE_URL;
  if (siteUrl === undefined || siteUrl.length === 0) {
    throw new AuloraError("A site URL is required (pass siteUrl or set AULORA_SITE_URL)", {
      code: "invalid_config",
    });
  }
  const convexUrl = options.convexUrl ?? process.env.AULORA_CONVEX_URL;
  if (convexUrl === undefined || convexUrl.length === 0) {
    throw new AuloraError("A Convex URL is required (pass convexUrl or set AULORA_CONVEX_URL)", {
      code: "invalid_config",
    });
  }
  return {
    token: apiToken,
    siteUrl: normalizeUrl(siteUrl, "siteUrl"),
    convexUrl: normalizeUrl(convexUrl, "convexUrl"),
    pollIntervalMs: readPollInterval(options.pollIntervalMs),
    includeSelf: options.includeSelf ?? false,
    handleSignals: options.handleSignals ?? true,
    identity: envIdentity(),
  };
}
