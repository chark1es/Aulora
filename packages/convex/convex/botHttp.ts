/**
 * HTTP surface of the bots feature: `POST /bots/token` (bot API token -> JWT)
 * plus the runner endpoints from `botRunnerHttp.ts`. See `docs/bots-design.md`.
 */
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { registerRunnerRoutes } from "./botRunnerHttp";
import { botJwtConfigured, hashBotToken, signBotJwt } from "./lib/botAuth";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Extracts the token from `Authorization: Bot <token>`; never logged. */
function readBotToken(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const [scheme, value] = header.split(" ");
  if (scheme !== "Bot" || value === undefined || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Exchanges a bot API token for a short-lived JWT. The hash is rate limited
 * before lookup so a wrong token cannot be probed at speed; the account state
 * decides 401 (unknown) versus 403 (disabled).
 */
function registerTokenRoute(http: HttpRouter): void {
  http.route({
    path: "/bots/token",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (!botJwtConfigured(process.env)) {
        return json({ error: "bots_unavailable" }, 503);
      }
      const token = readBotToken(request.headers.get("Authorization"));
      if (token === null) {
        return json({ error: "invalid_token" }, 401);
      }
      const tokenHash = await hashBotToken(token);
      try {
        await ctx.runMutation(internal.botAuthInternal.enforceTokenRateLimit, { tokenHash });
      } catch {
        // The limiter is the only thing that rejects here; anything else would
        // still be a refusal, so fail closed with the same status.
        return json({ error: "rate_limited" }, 429);
      }
      const bot = await ctx.runQuery(internal.botAuthInternal.findByTokenHash, { tokenHash });
      if (bot === null) {
        return json({ error: "invalid_token" }, 401);
      }
      if (!bot.enabled) {
        return json({ error: "bot_disabled" }, 403);
      }
      const signed = await signBotJwt({ userId: bot.userId });
      return json(
        {
          token: signed.token,
          expiresAt: signed.expiresAt,
          userId: bot.userId,
          botId: bot.botId,
          name: bot.name,
        },
        200,
      );
    }),
  });
}

export function registerBotRoutes(http: HttpRouter): void {
  registerRunnerRoutes(http);
  registerTokenRoute(http);
}
