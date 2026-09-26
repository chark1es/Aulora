import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins";
import authConfig from "./auth.config";

// Self-hosted: exposed to functions via `convex env set CONVEX_SITE_URL ...`
const siteUrl = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: ["http://localhost:5173", siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      // Required for Convex compatibility
      convex({ authConfig }),
      // Generic OAuth / generic OIDC client (e.g. Keycloak).
      // Bundling inside Convex HTTP routes is the thing under test.
      genericOAuth({
        config: [
          {
            providerId: "keycloak",
            discoveryUrl:
              "http://keycloak:8080/realms/aulora/.well-known/openid-configuration",
            clientId: "aulora-convex",
            clientSecret: "spike-secret",
            scopes: ["openid", "profile", "email"],
          },
        ],
      }),
    ],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
