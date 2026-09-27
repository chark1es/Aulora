/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auditLog from "../auditLog.js";
import type * as auth from "../auth.js";
import type * as authActions from "../authActions.js";
import type * as backups from "../backups.js";
import type * as categories from "../categories.js";
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as encryptionKeys from "../encryptionKeys.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as instance from "../instance.js";
import type * as invites from "../invites.js";
import type * as lib_accountNames from "../lib/accountNames.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_channels from "../lib/channels.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_ekm from "../lib/ekm.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_fileTokens from "../lib/fileTokens.js";
import type * as lib_instance from "../lib/instance.js";
import type * as lib_license from "../lib/license.js";
import type * as lib_oidc from "../lib/oidc.js";
import type * as lib_overrides from "../lib/overrides.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_pushRelay from "../lib/pushRelay.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_sealed from "../lib/sealed.js";
import type * as lib_sse from "../lib/sse.js";
import type * as lib_webPush from "../lib/webPush.js";
import type * as license from "../license.js";
import type * as members from "../members.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as reactions from "../reactions.js";
import type * as readStates from "../readStates.js";
import type * as roles from "../roles.js";
import type * as server from "../server.js";
import type * as setup from "../setup.js";
import type * as setupState from "../setupState.js";
import type * as typing from "../typing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auditLog: typeof auditLog;
  auth: typeof auth;
  authActions: typeof authActions;
  backups: typeof backups;
  categories: typeof categories;
  channels: typeof channels;
  crons: typeof crons;
  devices: typeof devices;
  encryptionKeys: typeof encryptionKeys;
  files: typeof files;
  http: typeof http;
  instance: typeof instance;
  invites: typeof invites;
  "lib/accountNames": typeof lib_accountNames;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/channels": typeof lib_channels;
  "lib/crypto": typeof lib_crypto;
  "lib/ekm": typeof lib_ekm;
  "lib/env": typeof lib_env;
  "lib/fileTokens": typeof lib_fileTokens;
  "lib/instance": typeof lib_instance;
  "lib/license": typeof lib_license;
  "lib/oidc": typeof lib_oidc;
  "lib/overrides": typeof lib_overrides;
  "lib/permissions": typeof lib_permissions;
  "lib/pushRelay": typeof lib_pushRelay;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/sealed": typeof lib_sealed;
  "lib/sse": typeof lib_sse;
  "lib/webPush": typeof lib_webPush;
  license: typeof license;
  members: typeof members;
  messages: typeof messages;
  notifications: typeof notifications;
  presence: typeof presence;
  reactions: typeof reactions;
  readStates: typeof readStates;
  roles: typeof roles;
  server: typeof server;
  setup: typeof setup;
  setupState: typeof setupState;
  typing: typeof typing;
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
