/**
 * `POST /api/webhooks/<id>/<token>`: posts a message into the webhook's channel.
 * The route lives under `/api/` so it rides the same edge rule as `/api/auth/`.
 */
import { parseWebhookPath, parseWebhookPayload, WEBHOOK_LIMITS } from "@aulora/core";
import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { hashWebhookToken } from "./lib/webhookAuth";

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

/** Reads the JSON body, refusing anything over the size cap before parsing it. */
async function readJsonBody(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > WEBHOOK_LIMITS.maxBodyBytes) {
    return { ok: false, response: json({ error: "payload_too_large" }, 413) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > WEBHOOK_LIMITS.maxBodyBytes) {
    return { ok: false, response: json({ error: "payload_too_large" }, 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}

export function registerWebhookRoutes(http: HttpRouter): void {
  http.route({
    pathPrefix: "/api/webhooks/",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const target = parseWebhookPath(new URL(request.url).pathname);
      if (target === null) {
        return json({ error: "unknown_webhook" }, 404);
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        return body.response;
      }
      const payload = parseWebhookPayload(body.value);
      if (!payload.ok) {
        return json({ error: payload.error }, 400);
      }
      const result = await ctx.runMutation(internal.webhookIngest.post, {
        webhookId: target.id,
        tokenHash: await hashWebhookToken(target.token),
        content: payload.content,
      });
      switch (result.status) {
        case "ok":
          return json({ id: result.messageId }, 200);
        case "rate_limited":
          return json({ error: "rate_limited" }, 429, { "retry-after": "10" });
        case "channel_unavailable":
          return json({ error: "channel_unavailable" }, 409);
        default:
          return json({ error: "unknown_webhook" }, 404);
      }
    }),
  });
}
