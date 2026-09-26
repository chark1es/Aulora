import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";

/**
 * Creates a local email/password credential through Better Auth. Kept in its
 * own module so the setup flow does not statically pull Better Auth into every
 * function bundle.
 */
export const createOwnerCredential = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  returns: v.object({ ownerId: v.string() }),
  handler: async (ctx, args) => {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    const result = await auth.api.signUpEmail({
      body: args,
      headers,
    });
    return { ownerId: result.user.id };
  },
});
