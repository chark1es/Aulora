/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authActions from "../authActions.js";
import type * as channels from "../channels.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_oidc from "../lib/oidc.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as members from "../members.js";
import type * as server from "../server.js";
import type * as setup from "../setup.js";
import type * as setupState from "../setupState.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authActions: typeof authActions;
  channels: typeof channels;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/crypto": typeof lib_crypto;
  "lib/env": typeof lib_env;
  "lib/oidc": typeof lib_oidc;
  "lib/permissions": typeof lib_permissions;
  members: typeof members;
  server: typeof server;
  setup: typeof setup;
  setupState: typeof setupState;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
