/**
 * Relay configuration, read from the environment. No credential ever has a
 * default: if a provider's settings are incomplete it is simply not enabled.
 */

import { readFileSync } from "node:fs";

export const DEFAULT_PORT = 8790;

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readKey(env, readFile) {
  const inline = nonEmpty(env.APNS_KEY_P8);
  if (inline !== undefined) {
    return inline.replace(/\\n/g, "\n");
  }
  const path = nonEmpty(env.APNS_KEY_PATH);
  if (path !== undefined) {
    return readFile(path);
  }
  return undefined;
}

/**
 * Builds the relay configuration object. Returns `{ token, port, providers }`
 * where `providers` is the provider config consumed by
 * `createProviderRegistry`. Throws only when the relay cannot authenticate
 * callers at all.
 */
export function loadRelayConfig(env = process.env, { readFile = readFileSync } = {}) {
  const token = nonEmpty(env.PUSH_RELAY_TOKEN);
  if (token === undefined) {
    throw new Error("PUSH_RELAY_TOKEN is required");
  }
  const port = Number.parseInt(nonEmpty(env.PUSH_RELAY_PORT) ?? String(DEFAULT_PORT), 10);

  const providers = {};
  const apnsKey = readKey(env, readFile);
  const apnsKeyId = nonEmpty(env.APNS_KEY_ID);
  const apnsTeamId = nonEmpty(env.APNS_TEAM_ID);
  const apnsTopic = nonEmpty(env.APNS_TOPIC);
  if (apnsKey && apnsKeyId && apnsTeamId && apnsTopic) {
    providers.apns = {
      keyId: apnsKeyId,
      teamId: apnsTeamId,
      key: apnsKey,
      topic: apnsTopic,
      environment: nonEmpty(env.APNS_ENVIRONMENT) === "sandbox" ? "sandbox" : "production",
    };
  }

  const fcmProjectId = nonEmpty(env.FCM_PROJECT_ID);
  const fcmAccessToken = nonEmpty(env.FCM_ACCESS_TOKEN);
  const serviceAccountJson = nonEmpty(env.FCM_SERVICE_ACCOUNT_JSON);
  const serviceAccountPath = nonEmpty(env.FCM_SERVICE_ACCOUNT_PATH);
  const serviceAccount = serviceAccountJson ?? (serviceAccountPath ? readFile(serviceAccountPath) : undefined);
  if (fcmProjectId && (fcmAccessToken || serviceAccount)) {
    providers.fcm = {
      projectId: fcmProjectId,
      ...(fcmAccessToken ? { accessToken: fcmAccessToken } : {}),
      ...(serviceAccount ? { serviceAccount: JSON.parse(serviceAccount) } : {}),
    };
  }

  if (nonEmpty(env.UNIFIEDPUSH_ENABLED) === "1") {
    providers.unifiedpush = {};
  }

  return { token, port, providers };
}
