import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
import { verifySetupToken } from "./lib/crypto";
import { getEkmSettings } from "./lib/ekm";
import { primeMasterKey } from "./lib/sse";

interface SetupResult {
  readonly serverId: Id<"server">;
  readonly roleId: Id<"roles">;
  readonly ownerId: string;
}

/** Public setup status for the setup CLI / server-connect screen. */
export const status = query({
  args: {},
  returns: v.object({ initialized: v.boolean(), name: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return { initialized: server !== null, name: server?.name ?? null };
  },
});

/**
 * One-time first-run setup. Gated by the `SETUP_TOKEN` Convex env var with a
 * constant-time comparison, refuses once a server exists, creates the owner's
 * local email/password credential through Better Auth, then writes the server
 * singleton, the `@everyone` role and the owner member.
 */
export const initialize = action({
  args: {
    token: v.string(),
    name: v.string(),
    email: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
  },
  returns: v.object({
    serverId: v.id("server"),
    roleId: v.id("roles"),
    ownerId: v.string(),
  }),
  handler: async (ctx, args): Promise<SetupResult> => {
    if (!verifySetupToken(args.token, process.env.SETUP_TOKEN)) {
      throw new ConvexError("Invalid setup token");
    }
    if (await ctx.runQuery(internal.setupState.isInitialized, {})) {
      throw new ConvexError("Server is already initialized");
    }

    const credential = await ctx.runAction(internal.authActions.createOwnerCredential, {
      email: args.email,
      password: args.password,
      name: args.displayName ?? args.name,
    });

    const result = await ctx.runMutation(internal.setupState.finalize, {
      name: args.name,
      ownerId: credential.ownerId,
    });

    // Prime the master key (the only network step for remote key managers) and
    // record the active key version so the encryption status surface is exact.
    const settings = getEkmSettings(process.env);
    await primeMasterKey({ env: process.env });
    await ctx.runMutation(internal.encryptionKeys.register, {
      keyVersion: settings.keyVersion,
      provider: settings.provider,
      kekId: settings.kekId,
      status: "active",
    });

    return result;
  },
});
