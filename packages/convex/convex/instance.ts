import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import {
  API_VERSION,
  AULORA_VERSION,
  getOidcSettings,
  getPublicAuthConfig,
  SOCIAL_PROVIDER_DEFINITIONS,
} from "./lib/env";
import {
  loadInstanceSettings,
  normalizePushRelayUrl,
  requireInstanceAdmin,
  saveInstanceSettings,
  validateMaxUploadBytes,
  validateStorageQuotaBytes,
} from "./lib/instance";
import { licenseStatus, maskLicenseKey } from "./lib/license";

/**
 * Instance admin surface: read-only status plus the storage, push-relay and
 * backup knobs. Every function requires the operator (workspace owner) account.
 * Secrets (OIDC client secret, relay token, backup token) are reported only as
 * booleans and never returned.
 */

function nonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/** Storage quotas, relay target and backup policy, plus where secrets live. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const { server } = await requireInstanceAdmin(ctx);
    const settings = await loadInstanceSettings(ctx);
    const env = process.env;
    return {
      name: server.name,
      ownerId: server.ownerId,
      version: AULORA_VERSION,
      settings,
      // The relay token and backup token live only in the deployment env.
      pushRelayConfigured: nonEmpty(env.PUSH_RELAY_URL) && nonEmpty(env.PUSH_RELAY_TOKEN),
      backupRunnerConfigured: nonEmpty(env.BACKUP_TOKEN),
    };
  },
});

/** One-screen overview for the instance admin panel. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const { server } = await requireInstanceAdmin(ctx);
    const env = process.env;
    const settings = await loadInstanceSettings(ctx);

    const files = await ctx.db.query("files").collect();
    const usedBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
    const memberCount = (await ctx.db.query("members").collect()).length;
    const channelCount = (await ctx.db.query("channels").collect()).length;
    const deviceCount = (await ctx.db.query("devices").collect()).length;
    const lastBackup =
      (await ctx.db.query("backups").withIndex("by_started").order("desc").first()) ?? null;

    const auth = getPublicAuthConfig(env, server.settings.signupEnabled);
    const oidc = getOidcSettings(env);
    const availableProviders = SOCIAL_PROVIDER_DEFINITIONS.map((definition) => ({
      id: definition.id,
      displayName: definition.displayName,
      configured:
        nonEmpty(env[definition.clientIdEnv]) && nonEmpty(env[definition.clientSecretEnv]),
    }));

    return {
      name: server.name,
      version: AULORA_VERSION,
      apiVersion: API_VERSION,
      ownerId: server.ownerId,
      counts: {
        members: memberCount,
        channels: channelCount,
        devices: deviceCount,
        files: files.length,
      },
      storage: {
        usedBytes,
        quotaBytes: settings.storageQuotaBytes,
        maxUploadBytes: settings.maxUploadBytes,
      },
      auth: {
        local: auth.local,
        providers: auth.providers,
        availableProviders,
        oidc:
          oidc === null
            ? null
            : {
                displayName: oidc.displayName,
                issuer: oidc.issuer,
                discoveryUrl: oidc.discoveryUrl,
                scopes: [...oidc.scopes],
              },
      },
      pushRelay: {
        enabled: settings.pushRelayEnabled,
        url: settings.pushRelayUrl,
        serverId: settings.serverId,
        configured: nonEmpty(env.PUSH_RELAY_URL) && nonEmpty(env.PUSH_RELAY_TOKEN),
      },
      backups: {
        enabled: settings.backupsEnabled,
        runnerConfigured: nonEmpty(env.BACKUP_TOKEN),
        lastRun: lastBackup,
      },
      license: {
        ...licenseStatus(server.licenseKey),
        maskedKey: maskLicenseKey(server.licenseKey),
      },
    };
  },
});

/** Sets the total storage quota and the largest single upload. */
export const updateStorage = mutation({
  args: { storageQuotaBytes: v.number(), maxUploadBytes: v.number() },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    validateStorageQuotaBytes(args.storageQuotaBytes);
    validateMaxUploadBytes(args.maxUploadBytes, args.storageQuotaBytes);
    const settings = await saveInstanceSettings(ctx, {
      storageQuotaBytes: args.storageQuotaBytes,
      maxUploadBytes: args.maxUploadBytes,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.storage.update",
      meta: JSON.stringify({
        storageQuotaBytes: args.storageQuotaBytes,
        maxUploadBytes: args.maxUploadBytes,
      }),
    });
    return settings;
  },
});

/** Enables the relay and sets its URL/server id. Never accepts a token. */
export const updatePushRelay = mutation({
  args: {
    enabled: v.boolean(),
    url: v.optional(v.union(v.string(), v.null())),
    serverId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    const url = normalizePushRelayUrl(args.url);
    const serverId =
      args.serverId === undefined || args.serverId === null || args.serverId.trim().length === 0
        ? null
        : args.serverId.trim();
    const settings = await saveInstanceSettings(ctx, {
      pushRelayEnabled: args.enabled,
      pushRelayUrl: url,
      serverId,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.pushRelay.update",
      meta: JSON.stringify({ enabled: args.enabled, url, serverId }),
    });
    return settings;
  },
});

/** Turns the nightly backup intent on or off. */
export const updateBackups = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    const settings = await saveInstanceSettings(ctx, { backupsEnabled: args.enabled });
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.backups.update",
      meta: JSON.stringify({ enabled: args.enabled }),
    });
    return settings;
  },
});
