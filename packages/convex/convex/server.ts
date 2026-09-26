import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { API_VERSION, AULORA_VERSION, getPublicAuthConfig } from "./lib/env";
import { requireWorkspacePermission } from "./lib/permissions";

/**
 * Public server metadata. Never contains credentials: the auth block only
 * exposes provider ids/types/display names and, for OIDC, the issuer,
 * discovery URL, client id and scopes.
 */
async function buildPublicConfig(ctx: QueryCtx) {
  const env = process.env;
  const server = await ctx.db.query("server").first();
  const signupEnabled = server?.settings.signupEnabled ?? true;
  const vapidPublicKey = env.VAPID_PUBLIC_KEY?.trim();
  return {
    name: server?.name ?? "Aulora",
    iconSeed: server?.iconSeed ?? "aulora:server:default",
    version: AULORA_VERSION,
    apiVersion: API_VERSION,
    convexUrl: env.CONVEX_CLOUD_URL ?? "",
    siteUrl: env.SITE_URL ?? env.CONVEX_SITE_URL ?? "",
    auth: getPublicAuthConfig(env, signupEnabled),
    // The VAPID public key is public by definition; the private half never
    // leaves the deployment environment.
    webPush:
      vapidPublicKey !== undefined && vapidPublicKey.length > 0
        ? { publicKey: vapidPublicKey }
        : null,
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

/**
 * Full workspace settings for the admin UI. Requires `ManageWorkspace`; the
 * public `get` query deliberately exposes only the safe subset.
 */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    const server = await ctx.db.query("server").first();
    if (server === null) {
      throw new ConvexError("Workspace is not initialized");
    }
    return {
      name: server.name,
      iconSeed: server.iconSeed,
      ownerId: server.ownerId,
      settings: server.settings,
    };
  },
});

/**
 * Updates workspace settings. Requires `ManageWorkspace` and writes an audit
 * row so access-policy changes are traceable.
 */
export const updateSettings = mutation({
  args: {
    signupEnabled: v.optional(v.boolean()),
    inviteOnly: v.optional(v.boolean()),
    allowedEmailDomains: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    const server = await ctx.db.query("server").first();
    if (server === null) {
      throw new ConvexError("Workspace is not initialized");
    }
    const changed = Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (changed.length === 0) {
      return null;
    }
    await ctx.db.patch(server._id, {
      settings: {
        ...server.settings,
        ...(args.signupEnabled !== undefined ? { signupEnabled: args.signupEnabled } : {}),
        ...(args.inviteOnly !== undefined ? { inviteOnly: args.inviteOnly } : {}),
        ...(args.allowedEmailDomains !== undefined
          ? { allowedEmailDomains: args.allowedEmailDomains }
          : {}),
      },
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "server.updateSettings",
      targetId: server._id,
      meta: JSON.stringify({ changed }),
    });
    return null;
  },
});
