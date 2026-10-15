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
  resolveLocalAuthEnabled,
} from "./lib/env";
import { effectiveEnvFromSealed } from "./lib/envOverrides";
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
  localEnabled: boolean = resolveLocalAuthEnabled(env, undefined).enabled,
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
      // Drives whether Better Auth's email/password sign-in AND sign-up
      // endpoints accept requests, so hiding the form in the UI is not the only
      // guard. `false` when local sign-in is off; the resolver refuses a
      // disable that would lock the instance out.
      enabled: localEnabled,
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
 * requires a synchronous factory, so the deployment environment and instance
 * settings are used for the instance handed to the component, and the request
 * handler rebuilds it when owner-saved overrides or a local-auth toggle exist.
 * Without them the synchronously built instance is reused.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const pendingGroups = new Map<string, string[]>();
  const baseLocalEnabled = resolveLocalAuthEnabled(process.env, undefined).enabled;
  const base = betterAuth(createAuthOptions(ctx, pendingGroups, process.env, baseLocalEnabled));
  return {
    ...base,
    handler: async (request: Request) => {
      const { env, localEnabled } = await loadAuthOverrides(ctx);
      if (env === null && localEnabled === baseLocalEnabled) {
        return base.handler(request);
      }
      return betterAuth(
        createAuthOptions(ctx, pendingGroups, env ?? process.env, localEnabled),
      ).handler(request);
    },
  };
};

/**
 * Better Auth instance for first-run owner creation. Local sign-in is forced on
 * (and sign-up is never disabled) so a deployment that turns off email/password
 * sign-in, or runs invite-only, can still create the operator credential.
 */
export const createSetupAuth = (ctx: GenericCtx<DataModel>) => {
  const options = createAuthOptions(ctx, new Map(), process.env, true);
  return betterAuth({
    ...options,
    emailAndPassword: { ...options.emailAndPassword, enabled: true, disableSignUp: false },
  });
};

interface AuthOverrides {
  /** The effective env, or `null` when the deployment env is already it. */
  readonly env: Env | null;
  /** Whether email/password sign-in is on for this request. */
  readonly localEnabled: boolean;
}

/**
 * Reads the owner-saved env overrides and the instance auth-provider toggles for
 * one auth request, then resolves the effective local sign-in state. Any read
 * failure falls back to the deployment environment so sign-in never breaks.
 */
async function loadAuthOverrides(ctx: GenericCtx<DataModel>): Promise<AuthOverrides> {
  const fallback: AuthOverrides = {
    env: null,
    localEnabled: resolveLocalAuthEnabled(process.env, undefined).enabled,
  };
  try {
    const actionCtx = requireActionCtx(ctx);
    const [rows, toggles] = await Promise.all([
      actionCtx.runQuery(internal.envOverrides.sealedValues, {}),
      actionCtx.runQuery(internal.instance.authProviderToggles, {}),
    ]);
    const env: Env | null =
      rows.length === 0 ? null : await effectiveEnvFromSealed(process.env, rows);
    return {
      env,
      localEnabled: resolveLocalAuthEnabled(env ?? process.env, toggles ?? undefined).enabled,
    };
  } catch {
    // Overrides are best-effort: an unreadable row must never break sign-in.
    return fallback;
  }
}

/** Returns the signed-in Better Auth user, or `null`. */
export const getCurrentUser = query({
  args: {},
  handler: (ctx) => authComponent.safeGetAuthUser(ctx),
});
