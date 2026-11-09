import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { authComponent, createAuth, createSetupAuth } from "./auth";

/**
 * Creates a local email/password credential through Better Auth for first-run
 * setup. Uses a dedicated auth instance that always allows local sign-in, so
 * disabling email/password sign-in (or running invite-only) can never block
 * owner creation. Kept in its own module so the setup flow does not statically
 * pull Better Auth into every function bundle.
 */
export const createOwnerCredential = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  returns: v.object({ ownerId: v.string() }),
  handler: async (ctx, args) => {
    const { headers } = await authComponent.getAuth(createAuth, ctx);
    const auth = createSetupAuth(ctx);
    const result = await auth.api.signUpEmail({
      body: args,
      headers,
    });
    return { ownerId: result.user.id };
  },
});

/**
 * Compensation for a first-run claim that created a credential but then lost
 * the atomic finalize (another claim won, or its token was rotated). Removes
 * the Better Auth user, sessions and accounts so the email is not left
 * registered and the operator can retry setup.
 */
export const deleteOwnerCredential = internalAction({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = createSetupAuth(ctx);
    const context = await auth.$context;
    await context.internalAdapter.deleteUser(args.ownerId);
    await context.internalAdapter.deleteUserSessions(args.ownerId);
    await context.internalAdapter.deleteAccounts(args.ownerId);
    return null;
  },
});

/**
 * Compensation for a first-run claim that created a credential but did not
 * commit. It re-reads the committed claim first: if `finalize` actually
 * succeeded before the action saw an error, this returns that result and leaves
 * the credential in place. Only an unclaimed credential is deleted, so the
 * compensation can never remove the new owner.
 */
export const discardUnclaimedOwnerCredential = internalAction({
  args: {
    ownerId: v.string(),
    /**
     * False when setup recovered a pre-existing account instead of creating
     * one. That account must survive a failed finalize: deleting it would
     * destroy an operator's existing credential.
     */
    deleteIfUnclaimed: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      serverId: v.id("server"),
      roleId: v.union(v.id("roles"), v.null()),
      ownerId: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ serverId: Id<"server">; roleId: Id<"roles"> | null; ownerId: string } | null> => {
    const committed = await ctx.runQuery(internal.setupState.claimOutcome, {});
    if (committed !== null && committed.ownerId === args.ownerId) {
      return committed;
    }
    if (args.deleteIfUnclaimed === false) {
      return null;
    }
    await ctx.runAction(internal.authActions.deleteOwnerCredential, { ownerId: args.ownerId });
    return null;
  },
});

/**
 * Recovers an orphaned first-run credential when the setup action died between
 * `createOwnerCredential` and `finalize` and its retry hits "email already
 * exists".
 *
 * The safest recovery is reuse, never delete: the caller must prove it knows the
 * existing account's password by signing in with it. Only then is that auth
 * user adopted as the owner. A legitimate pre-existing account whose password
 * does not match is left untouched and the original setup error is rethrown, so
 * an uninitialized instance cannot be taken over with a different password.
 */
export const recoverOwnerCredential = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
  },
  returns: v.union(v.null(), v.object({ ownerId: v.string() })),
  handler: async (ctx, args): Promise<{ ownerId: string } | null> => {
    // Only an uninitialized instance may adopt an existing credential. Once a
    // server exists, recovery would be an account takeover primitive.
    if (await ctx.runQuery(internal.setupState.isInitialized, {})) {
      return null;
    }
    try {
      const auth = createSetupAuth(ctx);
      const { headers } = await authComponent.getAuth(createAuth, ctx);
      const result = await auth.api.signInEmail({
        body: { email: args.email, password: args.password },
        headers,
      });
      return { ownerId: result.user.id };
    } catch {
      return null;
    }
  },
});
