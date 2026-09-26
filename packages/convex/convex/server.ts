import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { API_VERSION, AULORA_VERSION, getPublicAuthConfig } from "./lib/env";

/**
 * Public server metadata. Never contains credentials: the auth block only
 * exposes provider ids/types/display names and, for OIDC, the issuer,
 * discovery URL, client id and scopes.
 */
async function buildPublicConfig(ctx: QueryCtx) {
  const env = process.env;
  const server = await ctx.db.query("server").first();
  const signupEnabled = server?.settings.signupEnabled ?? true;
  return {
    name: server?.name ?? "Aulora",
    iconSeed: server?.iconSeed ?? "aulora:server:default",
    version: AULORA_VERSION,
    apiVersion: API_VERSION,
    convexUrl: env.CONVEX_CLOUD_URL ?? "",
    siteUrl: env.SITE_URL ?? env.CONVEX_SITE_URL ?? "",
    auth: getPublicAuthConfig(env, signupEnabled),
  };
}

/** Public config for connected clients. */
export const publicConfig = query({
  args: {},
  handler: async (ctx) => await buildPublicConfig(ctx),
});

/** Alias kept for the server-connect screen. */
export const get = query({
  args: {},
  handler: async (ctx) => await buildPublicConfig(ctx),
});
