import type { StorageLike } from "../profiles";

/** Stable id for this install, so two of the user's devices can be told apart. */
export const VOICE_CLIENT_KEY = "aulora.voiceClient.v1";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export function isVoiceClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}

let fallbackCounter = 0;

/**
 * The id only tells one install from another; it is not a secret. React Native's
 * Hermes runtime has no `globalThis.crypto`, so fall back to a clock plus counter.
 */
export function createVoiceClientId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  fallbackCounter += 1;
  const entropy =
    cryptoObj !== undefined && typeof cryptoObj.getRandomValues === "function"
      ? Array.from(cryptoObj.getRandomValues(new Uint8Array(8)))
      : [Math.trunc(globalThis.performance?.now() ?? 0), fallbackCounter];
  const suffix = entropy
    .map((value) => value.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
  return `c_${Date.now().toString(36)}_${suffix}`;
}

/** Reads or creates the client id in a synchronous store (web `localStorage`). */
export function ensureVoiceClientId(store: StorageLike): string {
  const existing = store.getItem(VOICE_CLIENT_KEY);
  if (existing !== null && isVoiceClientId(existing)) {
    return existing;
  }
  const created = createVoiceClientId();
  store.setItem(VOICE_CLIENT_KEY, created);
  return created;
}

export interface AsyncKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Reads or creates the client id in an async store (mobile AsyncStorage). */
export async function ensureVoiceClientIdAsync(store: AsyncKeyValueStore): Promise<string> {
  const existing = await store.getItem(VOICE_CLIENT_KEY);
  if (existing !== null && isVoiceClientId(existing)) {
    return existing;
  }
  const created = createVoiceClientId();
  await store.setItem(VOICE_CLIENT_KEY, created);
  return created;
}
