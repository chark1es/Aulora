import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { bearer, genericOAuth, twoFactor } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";
import { type SignupPolicy, shouldAutoAttachRoles, signupBlocked } from "./lib/authPolicy";
import {
  type Env,
  getBetterAuthSecret,
  getOidcSettings,
  getSocialProviderCredentials,
  getTrustedOrigins,
} from "./lib/env";
import { effectiveEnvFromSealed, type SealedEnvOverride } from "./lib/envOverrides";
import { extractGroups, roleNamesForGroups } from "./lib/oidc";

/** Component client mounted in `convex.config.ts`. */
export const authComponent = createClient<DataModel>(components.betterAuth);

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

function publicSiteUrl(env: Env): string {
  return env.SITE_URL ?? env.CONVEX_SITE_URL ?? "http://localhost:3211";
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
 * `env` is the effective environment: the deployment environment overlaid by
 * owner-saved overrides. Callers in the HTTP path pass it via `createAuth` so a
 * UI-defined OIDC provider or social credentials take effect on the next
 * request, with no redeploy or restart.
 *
 * `pendingGroups` carries the IdP group claim from `mapProfileToUser` to the
 * `user.create.after` hook in the same request, where the user id is known.
 */
export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
  pendingGroups: Map<string, string[]>,
  env: Env = process.env,
) => {
  const secret = getBetterAuthSecret(env);
  const oidc = getOidcSettings(env);

  // `bearer()` lets clients on another origin (the desktop app) keep a stored
  // session token instead of a cross-site cookie that dies on restart.
  const plugins: NonNullable<BetterAuthOptions["plugins"]> = [
    convex({ authConfig }),
    twoFactor(),
    bearer(),
  ];

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
    baseURL: publicSiteUrl(env),
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
    // People stay signed in across restarts: a 30-day session that slides
    // forward (at most once a day) while the app is in use.
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
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
      session: {
        create: {
          after: async (session) => {
            await requireActionCtx(ctx).runMutation(internal.licenseUsage.recordLogin, {
              userId: session.userId,
            });
          },
        },
        update: {
          after: async (session) => {
            await requireActionCtx(ctx).runMutation(internal.licenseUsage.recordLogin, {
              userId: session.userId,
            });
          },
        },
      },
      user: {
        create: {
          before: async (user): Promise<boolean> => {
            const policy: SignupPolicy = await requireActionCtx(ctx).runQuery(
              internal.setupState.authPolicy,
              {},
            );
            return !signupBlocked(policy, user.email);
          },
          after: async (user) => {
            const policy: SignupPolicy = await requireActionCtx(ctx).runQuery(
              internal.setupState.authPolicy,
              {},
            );
            // Invite-only workspaces attach roles only on invitation redemption.
            if (!shouldAutoAttachRoles(policy)) {
              pendingGroups.delete(user.email);
              return;
            }
            const groups = pendingGroups.get(user.email);
            pendingGroups.delete(user.email);
            const roleNames =
              groups !== undefined && oidc?.groupClaim !== undefined
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

/**
 * Builds the Better Auth instance for one request. The Better Auth component
 * requires a synchronous factory, so the deployment environment is used for the
 * instance handed to the component, and the request handler rebuilds it with
 * the effective environment when owner-saved overrides exist (loaded through an
 * internal query and decrypted here, in the action context). Without overrides
 * the synchronously built instance is reused.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const pendingGroups = new Map<string, string[]>();
  const base = betterAuth(createAuthOptions(ctx, pendingGroups));
  return {
    ...base,
    handler: async (request: Request) => {
      const env = await loadOverriddenEnv(ctx);
      const auth = env === null ? base : betterAuth(createAuthOptions(ctx, pendingGroups, env));
      return auth.handler(request);
    },
  };
};

/** The effective env for auth, or `null` when the deployment env is already it. */
async function loadOverriddenEnv(ctx: GenericCtx<DataModel>): Promise<Env | null> {
  try {
    const rows: SealedEnvOverride[] = await requireActionCtx(ctx).runQuery(
      internal.envOverrides.sealedValues,
      {},
    );
    if (rows.length === 0) {
      return null;
    }
    return await effectiveEnvFromSealed(process.env, rows);
  } catch {
    // Overrides are best-effort: an unreadable row must never break sign-in.
    return null;
  }
}

/** Returns the signed-in Better Auth user, or `null`. */
export const getCurrentUser = query({
  args: {},
  handler: (ctx) => authComponent.safeGetAuthUser(ctx),
});
