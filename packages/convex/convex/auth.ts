import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import {
  getBetterAuthSecret,
  getOidcSettings,
  getSocialProviderCredentials,
  getTrustedOrigins,
} from "./lib/env";
import { extractGroups, roleNamesForGroups } from "./lib/oidc";

/** Component client mounted in `convex.config.ts`. */
export const authComponent = createClient<DataModel>(components.betterAuth);

function publicSiteUrl(): string {
  return process.env.SITE_URL ?? process.env.CONVEX_SITE_URL ?? "http://localhost:3211";
}

/** Better Auth's minimum password length; clamped to a sane range, default 8. */
function minPasswordLength(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 8;
  }
  return Math.min(128, Math.max(1, Math.floor(parsed)));
}

/**
 * Builds the Better Auth options. Kept separate from `betterAuth(...)` so the
 * same options can be reused for schema generation / tests.
 *
 * `pendingGroups` carries the IdP group claim from `mapProfileToUser` to the
 * `user.create.after` hook in the same request, where the user id is known.
 */
export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
  pendingGroups: Map<string, string[]>,
) => {
  const env = process.env;
  const secret = getBetterAuthSecret(env);
  const oidc = getOidcSettings(env);

  const plugins: NonNullable<BetterAuthOptions["plugins"]> = [convex({ authConfig }), twoFactor()];

  if (oidc !== null) {
    const groupClaim = oidc.groupClaim;
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: oidc.providerId,
            discoveryUrl: oidc.discoveryUrl,
            issuer: oidc.issuer,
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: [...oidc.scopes],
            pkce: true,
            mapProfileToUser: (profile) => {
              if (groupClaim !== undefined && typeof profile.email === "string") {
                pendingGroups.set(profile.email, extractGroups(profile, groupClaim));
              }
              // Let Better Auth's default profile mapping handle the rest.
              return {};
            },
          },
        ],
      }),
    );
  }

  return {
    baseURL: publicSiteUrl(),
    trustedOrigins: getTrustedOrigins(env),
    database: authComponent.adapter(ctx),
    socialProviders: getSocialProviderCredentials(env),
    // Better Auth's built-in limiter protects sign-in/sign-up/OAuth endpoints.
    // The `rateLimits` table in `lib/rateLimit.ts` covers our own send/upload
    // mutations, which the auth HTTP surface does not pass through.
    rateLimit: {
      enabled: true,
      window: 60,
      max: Number(env.AUTH_RATE_LIMIT_MAX ?? 120),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: env.AUTH_LOCAL_SIGNUP === "false",
      // Safe default of 8; an operator running a throwaway test deployment can
      // lower it via AUTH_MIN_PASSWORD_LENGTH (e.g. short demo accounts).
      minPasswordLength: minPasswordLength(env.AUTH_MIN_PASSWORD_LENGTH),
    },
    plugins,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const groups = pendingGroups.get(user.email);
            pendingGroups.delete(user.email);
            const roleNames =
              groups !== undefined && oidc !== null && oidc.groupClaim !== undefined
                ? roleNamesForGroups(groups, oidc.groupRoleMap)
                : [];
            await requireActionCtx(ctx).runMutation(internal.members.attachRolesFromAuth, {
              userId: user.id,
              roleNames,
            });
          },
        },
      },
    },
    ...(secret !== undefined ? { secret } : {}),
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const pendingGroups = new Map<string, string[]>();
  return betterAuth(createAuthOptions(ctx, pendingGroups));
};

/** Returns the signed-in Better Auth user, or `null`. */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
});
