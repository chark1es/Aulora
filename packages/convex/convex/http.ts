import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Mounts the full Better Auth HTTP surface (sign-in/up, callbacks, OAuth, ...).
authComponent.registerRoutes(http, createAuth, { cors: true });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * First-run setup endpoint for the setup CLI container. The token may be sent
 * as `setupToken` in the JSON body or as the `x-setup-token` header. It is
 * never echoed back or logged.
 */
http.route({
  path: "/setup/initialize",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ ok: false, error: "INVALID_BODY" }, 400);
    }
    const record = body as Record<string, unknown>;

    const token = readString(record, "setupToken") ?? request.headers.get("x-setup-token");
    const name = readString(record, "name");
    const email = readString(record, "email");
    const password = readString(record, "password");
    if (token === null || name === null || email === null || password === null) {
      return json({ ok: false, error: "MISSING_FIELDS" }, 400);
    }

    const displayName = readString(record, "displayName");
    try {
      const result = await ctx.runAction(api.setup.initialize, {
        token,
        name,
        email,
        password,
        ...(displayName !== null ? { displayName } : {}),
      });
      return json({ ok: true, ...result }, 200);
    } catch {
      return json({ ok: false, error: "SETUP_FAILED" }, 400);
    }
  }),
});

export default http;
