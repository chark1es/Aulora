import { assessOwnerPassword, isValidEmail } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, query } from "./_generated/server";
import { getMinPasswordLength } from "./lib/env";
import { requestIp } from "./lib/rateLimit";
import { type SetupClaimFailure, setupClaimError } from "./lib/setupToken";

interface SetupResult {
  readonly serverId: Id<"server">;
  /**
   * `null` only when a committed claim is recovered after the `@everyone` role
   * was deleted; ownership is decided by the server row, not this role.
   */
  readonly roleId: Id<"roles"> | null;
  readonly ownerId: string;
}

const MAX_WORKSPACE_NAME = 80;
const MAX_DISPLAY_NAME = 80;

/** Better Auth's configured minimum, clamped the same way as `auth.ts`. */
function configuredMinPasswordLength(): number {
  return getMinPasswordLength(process.env);
}

/**
 * Public setup status for the setup CLI / server-connect screen.
 *
 * Kept for the setup container and older deployment tooling. The client uses
 * {@link state}, which reveals only whether setup is still required.
 */
export const status = query({
  args: {},
  returns: v.object({ initialized: v.boolean(), name: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return { initialized: server !== null, name: server?.name ?? null };
  },
});

/**
 * Safe unauthenticated first-run status. It deliberately reveals nothing but
 * whether an owner still needs to be created.
 */
export const state = query({
  args: {},
  returns: v.object({ setupRequired: v.boolean() }),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return { setupRequired: server === null };
  },
});

function validateClaimInput(args: {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}): void {
  const name = args.name.trim();
  if (name.length === 0 || name.length > MAX_WORKSPACE_NAME) {
    throw new ConvexError(`Workspace name must be 1–${MAX_WORKSPACE_NAME} characters`);
  }
  if (!isValidEmail(args.email.trim())) {
    throw new ConvexError("Enter a valid email address");
  }
  const displayName = args.displayName?.trim();
  if (displayName !== undefined && displayName.length > MAX_DISPLAY_NAME) {
    throw new ConvexError(`Your name must be ${MAX_DISPLAY_NAME} characters or fewer`);
  }
  const password = assessOwnerPassword(args.password, configuredMinPasswordLength());
  if (!password.valid) {
    throw new ConvexError(password.problem ?? "Choose a stronger password");
  }
}

/**
 * One-time first-run setup. The claim is gated by the setup token printed once
 * by the setup container (or the optional `SETUP_TOKEN` deployment override),
 * rate-limited per attempted token, and finalized atomically: only the first
 * successful registration becomes an owner. It creates the owner's local
 * email/password credential through Better Auth, then writes the server
 * singleton, the `@everyone` role and the owner member.
 *
 * The password and token are never logged by this function or the HTTP route.
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
    roleId: v.union(v.id("roles"), v.null()),
    ownerId: v.string(),
  }),
  handler: async (ctx, args): Promise<SetupResult> => {
    validateClaimInput(args);
    const ip = await requestIp(ctx);

    // Reject a wrong/expired token and count the attempt before creating any
    // account, so a hostile caller cannot use this action as a signup oracle.
    // The gate returns a failure instead of throwing so its rate-limit counter
    // and rejection audit commit.
    const gate = await ctx.runMutation(internal.setupState.assertClaimAllowed, {
      token: args.token,
      ip,
    });
    if (!gate.allowed) {
      if (gate.reason === "initialized") {
        throw new ConvexError("Server is already initialized");
      }
      if (gate.reason === "rate_limited") {
        throw new ConvexError("Too many setup attempts. Try again in a few minutes.");
      }
      if (gate.reason === null) {
        throw new ConvexError("Setup is not available right now");
      }
      throw setupClaimError(gate.reason as SetupClaimFailure);
    }

    let credential: { ownerId: string };
    let createdByThisClaim = true;
    try {
      credential = await ctx.runAction(internal.authActions.createOwnerCredential, {
        email: args.email.trim(),
        password: args.password,
        name: args.displayName?.trim() || args.name.trim(),
      });
    } catch (cause) {
      // An interrupted earlier setup can strand a credential after it was
      // created but before `finalize`: the retry then reports "email already
      // exists" while no server exists. Reuse that account only if the supplied
      // password actually signs in to it; a legitimate account with a different
      // password is never deleted or taken over.
      const recovered = await ctx
        .runAction(internal.authActions.recoverOwnerCredential, {
          email: args.email.trim(),
          password: args.password,
        })
        .catch(() => null);
      if (recovered === null) {
        throw cause;
      }
      credential = recovered;
      createdByThisClaim = false;
    }

    // This mutation re-checks the token and the "no server" condition in one
    // transaction. A concurrent claim that lost the race is rejected here.
    let result: SetupResult;
    try {
      result = await ctx.runMutation(internal.setupState.finalize, {
        name: args.name.trim(),
        ownerId: credential.ownerId,
        token: args.token,
      });
    } catch (cause) {
      // The credential was created by this claim but did not obviously become
      // the owner (another claim won, the token rotated, or `finalize` reported
      // an error after committing). Re-check the committed state before
      // deleting: if this credential is now the owner, leave it untouched and
      // report success rather than deleting the owner's account.
      try {
        const committed = await ctx.runAction(
          internal.authActions.discardUnclaimedOwnerCredential,
          { ownerId: credential.ownerId, deleteIfUnclaimed: createdByThisClaim },
        );
        if (committed !== null) {
          result = committed;
        } else {
          throw cause;
        }
      } catch (cleanupError) {
        if (cleanupError !== cause) {
          // Bind intentionally: log only, then rethrow the original cause.
          // Surface the original failure; an orphaned credential is recoverable
          // by deleting the account, while a misleading success would not be.
          console.error("setup: could not remove an unclaimed owner credential", cleanupError);
        }
        throw cause;
      }
    }

    // Post-finalize work is best effort: the workspace exists and the owner is
    // signed up, so a key-manager hiccup must not turn a successful claim into
    // a failure. The setup entrypoint retries this idempotent step on every run.
    try {
      await ctx.runAction(internal.encryptionKeys.ensureRegistered, {});
    } catch (error) {
      console.error("setup: encryption key registration will be retried later", error);
    }

    return result;
  },
});
