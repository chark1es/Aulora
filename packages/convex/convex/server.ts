import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { API_VERSION, AULORA_VERSION, getEncryptionSettings, getPublicAuthConfig } from "./lib/env";
import { effectiveMaxUploadBytes } from "./lib/instance";
import { requireWorkspacePermission } from "./lib/permissions";

interface IceServerConfig {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

/** Workspace logo cap; mirrors the client-side limit. */
const MAX_LOGO_BYTES = 4 * 1024 * 1024;

/**
 * True when a stored object looks like a workspace image asset: non-empty,
 * within the logo size cap, and either untagged or tagged `image/*`. Read from
 * `_storage` metadata so an empty or absurdly large object cannot be
 * republished as the workspace logo. Actual bytes are not readable from a
 * mutation (only actions can download a blob), so the content type is the
 * strongest in-mutation signal.
 */
function isImageAsset(metadata: {
  readonly size: number;
  readonly contentType?: string | null;
}): boolean {
  if (metadata.size <= 0 || metadata.size > MAX_LOGO_BYTES) {
    return false;
  }
  const contentType = (metadata.contentType ?? "").toLowerCase();
  return contentType.length === 0 || contentType.startsWith("image/");
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
  const instance = await ctx.db.query("instanceSettings").first();
  const signupEnabled = server?.settings.signupEnabled ?? true;
  const logoUrl =
    server?.logoStorageId !== undefined ? await ctx.storage.getUrl(server.logoStorageId) : null;
  const vapidPublicKey = env.VAPID_PUBLIC_KEY?.trim();
  const encryption = getEncryptionSettings(env);
  // The effective single-upload cap, so clients can pre-check sizes and show a
  // specific error instead of failing at finalize.
  const maxUploadBytes = await effectiveMaxUploadBytes(ctx);
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
    description: server?.description ?? "",
    logoUrl,
    inviteOnly: server?.settings.inviteOnly ?? true,
    signupEnabled,
    version: AULORA_VERSION,
    apiVersion: API_VERSION,
    convexUrl: env.CONVEX_CLOUD_URL ?? "",
    siteUrl: env.SITE_URL ?? env.CONVEX_SITE_URL ?? "",
    auth: getPublicAuthConfig(env, signupEnabled, instance?.authProviders ?? undefined),
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
    // Effective per-upload cap (operator setting, else env/default). Clients
    // use this to reject oversized picks before uploading.
    uploads: { maxBytes: maxUploadBytes },
    addons: { kanban: server?.settings.kanbanEnabled ?? false },
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
      description: server.description ?? "",
      logoStorageId: server.logoStorageId ?? null,
      logoUrl:
        server.logoStorageId !== undefined ? await ctx.storage.getUrl(server.logoStorageId) : null,
      ownerId: server.ownerId,
      settings: server.settings,
    };
  },
});

/**
 * Updates workspace branding (name, icon seed and description). Requires
 * `ManageWorkspace` and writes an audit row.
 */
export const updateBranding = mutation({
  args: {
    name: v.optional(v.string()),
    iconSeed: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    const server = await ctx.db.query("server").first();
    if (server === null) {
      throw new ConvexError("Workspace is not initialized");
    }
    const name = args.name?.trim();
    if (args.name !== undefined && (name === undefined || name.length === 0)) {
      throw new ConvexError("Workspace name cannot be empty");
    }
    const changed: string[] = [];
    if (name !== undefined) {
      changed.push("name");
    }
    if (args.iconSeed !== undefined) {
      changed.push("iconSeed");
    }
    if (args.description !== undefined) {
      changed.push("description");
    }
    if (changed.length === 0) {
      return null;
    }
    await ctx.db.patch(server._id, {
      ...(name !== undefined ? { name } : {}),
      ...(args.iconSeed !== undefined ? { iconSeed: args.iconSeed } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "server.updateBranding",
      targetId: server._id,
      meta: JSON.stringify({ changed }),
    });
    return null;
  },
});

/** Sets or clears the workspace logo. Requires `ManageWorkspace`. */
export const setLogo = mutation({
  args: { storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    const server = await ctx.db.query("server").first();
    if (server === null) {
      throw new ConvexError("Workspace is not initialized");
    }
    if (args.storageId !== undefined) {
      const url = await ctx.storage.getUrl(args.storageId);
      if (url === null) {
        throw new ConvexError("Logo file not found");
      }
      const metadata = await ctx.db.system.get("_storage", args.storageId);
      if (metadata === null || !isImageAsset(metadata)) {
        throw new ConvexError("Logo must be an image under 4 MB");
      }
      await ctx.db.patch(server._id, { logoStorageId: args.storageId });
    } else {
      await ctx.db.patch(server._id, { logoStorageId: undefined });
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: "server.setLogo",
      targetId: server._id,
      meta: JSON.stringify({ set: args.storageId !== undefined }),
    });
    return null;
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
