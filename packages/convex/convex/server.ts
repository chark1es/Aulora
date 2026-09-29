import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { API_VERSION, AULORA_VERSION, getEncryptionSettings, getPublicAuthConfig } from "./lib/env";
import { requireWorkspacePermission } from "./lib/permissions";

interface IceServerConfig {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

/**
 * Parses `AULORA_ICE_SERVERS` (JSON array of `RTCIceServer`-shaped objects) so
 * a self-hosted deployment can point clients at its own STUN/TURN. Invalid
 * input is ignored rather than failing the whole config query.
 */
function parseIceServers(raw: string | undefined): readonly IceServerConfig[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const servers: IceServerConfig[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const urls = Array.isArray(record.urls)
        ? record.urls.filter((url): url is string => typeof url === "string")
        : typeof record.urls === "string"
          ? [record.urls]
          : [];
      if (urls.length === 0) {
        continue;
      }
      servers.push({
        urls,
        ...(typeof record.username === "string" ? { username: record.username } : {}),
        ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
      });
    }
    return servers;
  } catch {
    return [];
  }
}

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
  const encryption = getEncryptionSettings(env);
  // Voice policy is a capability, not a secret: every client needs it to
  // decide whether to render call affordances, so it rides the public config.
  const voice = {
    enabled: server?.settings.voiceEnabled ?? true,
    videoEnabled: server?.settings.videoEnabled ?? true,
    screenShareEnabled: server?.settings.screenShareEnabled ?? true,
    maxParticipants: server?.settings.maxCallParticipants ?? 10,
    iceServers: parseIceServers(env.AULORA_ICE_SERVERS),
  };
  return {
    name: server?.name ?? "Aulora",
    iconSeed: server?.iconSeed ?? "aulora:server:default",
    version: AULORA_VERSION,
    apiVersion: API_VERSION,
    convexUrl: env.CONVEX_CLOUD_URL ?? "",
    siteUrl: env.SITE_URL ?? env.CONVEX_SITE_URL ?? "",
    auth: getPublicAuthConfig(env, signupEnabled),
    // Non-secret encryption descriptor: mode, algorithm, key version and the
    // key-manager provider only. Key material never leaves the environment.
    encryption: {
      mode: "server" as const,
      algorithm: "AES-256-GCM",
      keyVersion: encryption.keyVersion,
      provider: encryption.provider,
    },
    // The VAPID public key is public by definition; the private half never
    // leaves the deployment environment.
    webPush:
      vapidPublicKey !== undefined && vapidPublicKey.length > 0
        ? { publicKey: vapidPublicKey }
        : null,
    voice,
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
    voiceEnabled: v.optional(v.boolean()),
    videoEnabled: v.optional(v.boolean()),
    screenShareEnabled: v.optional(v.boolean()),
    maxCallParticipants: v.optional(v.number()),
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
        ...(args.voiceEnabled !== undefined ? { voiceEnabled: args.voiceEnabled } : {}),
        ...(args.videoEnabled !== undefined ? { videoEnabled: args.videoEnabled } : {}),
        ...(args.screenShareEnabled !== undefined
          ? { screenShareEnabled: args.screenShareEnabled }
          : {}),
        ...(args.maxCallParticipants !== undefined
          ? { maxCallParticipants: Math.max(2, Math.min(50, Math.round(args.maxCallParticipants))) }
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
