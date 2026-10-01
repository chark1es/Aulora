import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";
import type { AuthProviderToggles } from "./env";

/**
 * Instance-admin authority. The operator account created by first-run setup is
 * the workspace owner; only that account manages instance-level settings (auth
 * providers, storage quotas, backups, push relay). The workspace `@everyone`
 * roles never grant this.
 */

type ReadCtx = QueryCtx | MutationCtx;

export interface InstanceSettingsValues {
  readonly storageQuotaBytes: number;
  readonly maxUploadBytes: number;
  readonly pushRelayEnabled: boolean;
  readonly pushRelayUrl: string | null;
  readonly serverId: string | null;
  readonly backupsEnabled: boolean;
  readonly authProviders: AuthProviderToggles | null;
}

/** Total storage quota in bytes; 0 means unlimited. */
export const DEFAULT_STORAGE_QUOTA_BYTES = 0;
/** Largest single upload; 25 MiB mirrors the client default. */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MIN_MAX_UPLOAD_BYTES = 1024;
/** Larger values stop fitting safely in a JS number after arithmetic. */
export const MAX_QUOTA_BYTES = Number.MAX_SAFE_INTEGER;

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettingsValues = {
  storageQuotaBytes: DEFAULT_STORAGE_QUOTA_BYTES,
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  pushRelayEnabled: false,
  pushRelayUrl: null,
  serverId: null,
  backupsEnabled: true,
  authProviders: null,
};

export interface InstanceAdmin {
  readonly userId: string;
  readonly server: Doc<"server">;
}

/** Throws unless the caller is the operator (workspace owner) account. */
export async function requireInstanceAdmin(ctx: ReadCtx): Promise<InstanceAdmin> {
  const { userId } = await requireAuth(ctx);
  const server = await ctx.db.query("server").first();
  if (server === null) {
    throw new ConvexError("Workspace is not initialized");
  }
  if (server.ownerId !== userId) {
    throw new ConvexError("Instance admin only");
  }
  return { userId, server };
}

/** Reads the singleton settings row, filling in defaults when absent. */
export async function loadInstanceSettings(ctx: ReadCtx): Promise<InstanceSettingsValues> {
  const row = await ctx.db.query("instanceSettings").first();
  if (row === null) {
    return DEFAULT_INSTANCE_SETTINGS;
  }
  return {
    storageQuotaBytes: row.storageQuotaBytes,
    maxUploadBytes: row.maxUploadBytes,
    pushRelayEnabled: row.pushRelayEnabled,
    pushRelayUrl: row.pushRelayUrl ?? null,
    serverId: row.serverId ?? null,
    backupsEnabled: row.backupsEnabled,
    authProviders: row.authProviders ?? null,
  };
}

/** Writes the singleton settings row, inserting it on first save. */
export async function saveInstanceSettings(
  ctx: MutationCtx,
  patch: Partial<InstanceSettingsValues>,
): Promise<InstanceSettingsValues> {
  const current = await loadInstanceSettings(ctx);
  const next: InstanceSettingsValues = { ...current, ...patch };
  const row = await ctx.db.query("instanceSettings").first();
  if (row === null) {
    await ctx.db.insert("instanceSettings", {
      storageQuotaBytes: next.storageQuotaBytes,
      maxUploadBytes: next.maxUploadBytes,
      pushRelayEnabled: next.pushRelayEnabled,
      ...(next.pushRelayUrl !== null ? { pushRelayUrl: next.pushRelayUrl } : {}),
      ...(next.serverId !== null ? { serverId: next.serverId } : {}),
      backupsEnabled: next.backupsEnabled,
      ...(next.authProviders !== null ? { authProviders: next.authProviders } : {}),
    });
  } else {
    await ctx.db.patch(row._id, {
      storageQuotaBytes: next.storageQuotaBytes,
      maxUploadBytes: next.maxUploadBytes,
      pushRelayEnabled: next.pushRelayEnabled,
      pushRelayUrl: next.pushRelayUrl ?? undefined,
      serverId: next.serverId ?? undefined,
      backupsEnabled: next.backupsEnabled,
      authProviders: next.authProviders ?? undefined,
    });
  }
  return next;
}

/** Validates a storage quota: a non-negative integer of safe size. */
export function validateStorageQuotaBytes(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_QUOTA_BYTES) {
    throw new ConvexError("Storage quota must be a non-negative integer in bytes");
  }
}

/** Validates a per-upload cap against the total quota. */
export function validateMaxUploadBytes(value: number, quotaBytes: number): void {
  if (!Number.isInteger(value) || value < MIN_MAX_UPLOAD_BYTES || value > MAX_QUOTA_BYTES) {
    throw new ConvexError("Max upload must be an integer of at least 1 KiB");
  }
  if (quotaBytes > 0 && value > quotaBytes) {
    throw new ConvexError("Max upload cannot exceed the storage quota");
  }
}

/** Validates and normalizes a push relay URL, or `null` to clear it. */
export function normalizePushRelayUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConvexError("Push relay URL must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConvexError("Push relay URL must be an absolute http(s) URL");
  }
  return parsed.toString().replace(/\/$/, "");
}
