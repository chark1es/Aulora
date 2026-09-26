import {
  type ChannelSummary,
  type ChatPort,
  ChatSession,
  type ChatSubscriptions,
  type MessagePayload,
} from "@aulora/core";
import {
  bytesToHex,
  ensureDeviceIdentity,
  isReactNativeCryptoSufficient,
  type KeyStore,
  MlsEngineError,
  probeReactNativeCrypto,
  REACT_NATIVE_MLS_UNAVAILABLE,
  type ReactNativeCryptoReport,
} from "@aulora/crypto";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";
import { convexPort, convexSubscriptions } from "./convex-chat";
import { ensureReactNativeCrypto, mobileMlsEngine } from "./mls-engine";

/**
 * Wires the MLS engine and chat session for one signed-in mobile device.
 *
 * Mobile runs the same ts-mls engine as web, over the `react-native-quick-crypto`
 * WebCrypto polyfill (X25519, Ed25519, HKDF, AES-GCM), installed once at
 * startup. The device identity is created and persisted on-device, and its
 * public half is registered with the server. When the native crypto is missing
 * (e.g. Expo Go), `mlsError` explains why rather than pretending a channel is
 * encrypted.
 */
export interface MobileChatRuntime {
  readonly session: ChatSession;
  readonly port: ChatPort;
  readonly subscriptions: ChatSubscriptions;
  readonly client: ConvexReactClient;
  /** Public device identity, hex-encoded; used to key `devices.upsert`. */
  readonly identityKey: string;
}

export interface CreateMobileChatRuntimeOptions {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly keyStore: KeyStore;
  /** Platform tag for the device record. Defaults to `"mobile"`. */
  readonly platform?: string;
}

export type MobileChatRuntimeResult =
  | { readonly runtime: MobileChatRuntime; readonly mlsError: null }
  | { readonly runtime: null; readonly mlsError: string };

export async function createMobileChatRuntime(
  options: CreateMobileChatRuntimeOptions,
): Promise<MobileChatRuntimeResult> {
  const { keyStore } = options;
  try {
    ensureReactNativeCrypto();
  } catch (error) {
    return { runtime: null, mlsError: describeError(error) };
  }

  const report = await probeReactNativeCrypto();
  if (!isReactNativeCryptoSufficient(report)) {
    return { runtime: null, mlsError: describeMissing(report) };
  }

  let identityKey: string;
  try {
    const identity = await ensureDeviceIdentity(keyStore);
    identityKey = bytesToHex(identity.signaturePublicKey);
  } catch (error) {
    return { runtime: null, mlsError: describeError(error) };
  }

  const port = convexPort(options.client);
  const subscriptions = convexSubscriptions(options.client);
  const session = ChatSession.create({
    port,
    subscriptions,
    createEngine: () => mobileMlsEngine(keyStore),
    user: { id: options.userId, displayName: options.displayName },
    identityKey,
    platform: options.platform ?? "mobile",
  });
  await session.start();
  return {
    runtime: { session, port, subscriptions, client: options.client, identityKey },
    mlsError: null,
  };
}

function describeError(error: unknown): string {
  if (error instanceof MlsEngineError) {
    return `${error.message} (${error.code})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return REACT_NATIVE_MLS_UNAVAILABLE;
}

function describeMissing(report: ReactNativeCryptoReport): string {
  const missing = (
    ["subtle", "randomValues", "x25519", "ed25519", "hkdf", "hmac", "aesGcm", "digest"] as const
  ).filter((primitive) => !report[primitive]);
  return `${REACT_NATIVE_MLS_UNAVAILABLE} Missing: ${missing.join(", ")}.`;
}

export type { ChannelSummary, MessagePayload };

/** Live replies for a thread root, oldest first. */
export function watchThread(
  runtime: MobileChatRuntime,
  threadRootId: string,
  onChange: (messages: readonly MessagePayload[]) => void,
): () => void {
  const watch = runtime.client.watchQuery(api.messages.listThread, {
    threadRootId: threadRootId as never,
    paginationOpts: { numItems: 100, cursor: null },
  });
  const unsubscribe = watch.onUpdate(() => {
    const value = watch.localQueryResult();
    if (value !== undefined) {
      onChange(value.page);
    }
  });
  return () => {
    unsubscribe();
  };
}
