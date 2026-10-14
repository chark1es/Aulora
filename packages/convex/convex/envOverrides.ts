import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { ENV_VAR_CATALOG, ENV_VAR_GROUPS, findEnvVarDefinition } from "./lib/envCatalog";
import {
  assertUiEnvOverridesEnabled,
  type EnvSource,
  envLookup,
  envOverrideContext,
  envVarSource,
  uiEnvOverridesEnabled,
  validateEnvOverrideValue,
} from "./lib/envOverrides";
import { requireInstanceAdmin } from "./lib/instance";
import { enforceRateLimit, userRateLimitKey } from "./lib/rateLimit";
import { encryptionConfigured, openString, sealString } from "./lib/sse";

/**
 * Environment overrides for the instance admin panel.
 *
 * Disclosure rules (the core safety property): `list` reports only keys,
 * metadata and where each value comes from. A value that comes from the
 * deployment environment is never returned, secret or not, so the owner can
 * never read what the deployment's env was and an override can never be used
 * to recover the previous value. UI-saved non-secrets are echoed back for
 * editing; UI-saved secrets are write-only and reported as "set".
 *
 * Every mutation is owner-only, honours the `AULORA_ALLOW_UI_ENV_OVERRIDES`
 * kill switch, validates against the catalog allowlist and writes an audit row
 * that carries key names only.
 */

/** 30 override writes per minute per owner is far above real usage. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_BATCH_ENTRIES = 16;

interface OverrideEntry {
  readonly key: string;
  readonly value: string;
}

/** Seals and upserts each entry; refuses to store anything unencrypted. */
async function sealAndSave(
  ctx: MutationCtx,
  entries: readonly OverrideEntry[],
  userId: string,
): Promise<void> {
  if (!encryptionConfigured()) {
    throw new ConvexError(
      "Server-side encryption is not configured, so overrides cannot be stored. Set the deployment's encryption key first.",
    );
  }
  const now = Date.now();
  for (const entry of entries) {
    let ciphertext: string;
    try {
      ciphertext = await sealString(envOverrideContext(entry.key), entry.value);
    } catch {
      throw new ConvexError(
        "Could not seal the value: the server encryption key is unavailable. Check the deployment's key manager.",
      );
    }
    const existing = await ctx.db
      .query("envOverrides")
      .withIndex("by_key", (q) => q.eq("key", entry.key))
      .unique();
    if (existing === null) {
      await ctx.db.insert("envOverrides", {
        key: entry.key,
        valueCiphertext: ciphertext,
        updatedAt: now,
        updatedBy: userId,
      });
    } else {
      await ctx.db.patch(existing._id, {
        valueCiphertext: ciphertext,
        updatedAt: now,
        updatedBy: userId,
      });
    }
  }
}

async function rateLimitOverrides(ctx: MutationCtx, userId: string): Promise<void> {
  await enforceRateLimit(ctx, {
    key: userRateLimitKey("instance.env", userId),
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
}

/**
 * Lists the catalog with per-variable provenance. Never returns a value for an
 * environment-sourced variable; UI non-secrets are decrypted for editing.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const rows = await ctx.db.query("envOverrides").collect();
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const overrideKeys = new Set(rowByKey.keys());
    const lookup = envLookup();
    const variables = [];
    for (const definition of ENV_VAR_CATALOG) {
      const row = rowByKey.get(definition.key);
      const source: EnvSource = envVarSource(definition.key, overrideKeys, lookup);
      let value: string | undefined;
      if (row !== undefined && !definition.secret) {
        try {
          value = await openString(envOverrideContext(definition.key), row.valueCiphertext);
        } catch {
          value = undefined;
        }
      }
      variables.push({
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        enumValues: definition.enumValues !== undefined ? [...definition.enumValues] : null,
        secret: definition.secret,
        overridable: definition.overridable,
        managedInSection: definition.managedInSection ?? null,
        source,
        isSet: source !== "unset",
        ...(value !== undefined ? { value } : {}),
      });
    }
    return {
      locked: !uiEnvOverridesEnabled(),
      encryptionConfigured: encryptionConfigured(),
      groups: ENV_VAR_GROUPS.map((group) => ({ id: group.id, label: group.label })),
      variables,
    };
  },
});

/** Saves one override. The value is validated and sealed; the audit row carries the key only. */
export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    assertUiEnvOverridesEnabled();
    const value = validateEnvOverrideValue(args.key, args.value);
    await rateLimitOverrides(ctx, userId);
    await sealAndSave(ctx, [{ key: args.key, value }], userId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.env.override",
      meta: JSON.stringify({ key: args.key }),
    });
    return { key: args.key, source: "ui" as const };
  },
});

/** Saves several overrides atomically (used by the OIDC provider form). */
export const setMany = mutation({
  args: { entries: v.array(v.object({ key: v.string(), value: v.string() })) },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    assertUiEnvOverridesEnabled();
    if (args.entries.length === 0) {
      throw new ConvexError("No values to save");
    }
    if (args.entries.length > MAX_BATCH_ENTRIES) {
      throw new ConvexError(`Save at most ${MAX_BATCH_ENTRIES} values at once`);
    }
    const seen = new Set<string>();
    const entries: OverrideEntry[] = args.entries.map((entry) => {
      if (seen.has(entry.key)) {
        throw new ConvexError(`Duplicate environment variable: ${entry.key}`);
      }
      seen.add(entry.key);
      return { key: entry.key, value: validateEnvOverrideValue(entry.key, entry.value) };
    });
    await rateLimitOverrides(ctx, userId);
    await sealAndSave(ctx, entries, userId);
    const keys = entries.map((entry) => entry.key);
    await writeAudit(ctx, {
      actorId: userId,
      action: "instance.env.override",
      meta: JSON.stringify({ keys }),
    });
    return { keys };
  },
});

/** Deletes an override row; the deployment value becomes effective again. */
export const clear = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    assertUiEnvOverridesEnabled();
    const definition = findEnvVarDefinition(args.key);
    if (definition === undefined) {
      throw new ConvexError(`Unknown environment variable: ${args.key}`);
    }
    if (!definition.overridable) {
      throw new ConvexError(`${args.key} is managed by the deployment and has no UI override`);
    }
    await rateLimitOverrides(ctx, userId);
    const row = await ctx.db
      .query("envOverrides")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (row !== null) {
      await ctx.db.delete(row._id);
      await writeAudit(ctx, {
        actorId: userId,
        action: "instance.env.reset",
        meta: JSON.stringify({ key: args.key }),
      });
    }
    return { key: args.key, source: "environment" as const };
  },
});

/**
 * Sealed override rows for server-side consumers. Internal-only: the auth
 * action and the public config query decrypt these in-process. It never
 * returns plaintext, so this path cannot disclose a value even if reachable.
 */
export const sealedValues = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("envOverrides").collect()).map((row) => ({
      key: row.key,
      valueCiphertext: row.valueCiphertext,
    })),
});
