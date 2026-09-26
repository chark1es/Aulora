/**
 * Recovery-passphrase backup on mobile.
 *
 * A new phone can restore the user's identity and channel history keys from
 * the encrypted blob in `keyBackups`, protected by a passphrase only the user
 * knows (Argon2id + AES-256-GCM, via `@aulora/crypto`). This module is the
 * thin, testable seam: build the payload, then save or restore through Convex.
 *
 * The passphrase never leaves the device; only the opaque ciphertext is stored.
 */

import {
  type Argon2idCost,
  createKeyBackup,
  type HistoryKeyRecord,
  type KeyBackupPayload,
  openKeyBackup,
} from "@aulora/crypto";

/** Minimum passphrase length; Argon2id slows guessing but not a weak phrase. */
export const MIN_PASSPHRASE_LENGTH = 12;

export interface PassphraseCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Basic local guard so the UI can refuse an obviously weak passphrase. */
export function validateRecoveryPassphrase(passphrase: string): PassphraseCheck {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSPHRASE_LENGTH} characters` };
  }
  if (passphrase.trim().length === 0) {
    return { ok: false, reason: "Passphrase cannot be only spaces" };
  }
  return { ok: true };
}

export interface BuildRecoveryOptions {
  readonly passphrase: string;
  /** Serialized device identity record from the key store. */
  readonly identity: Uint8Array;
  /** Per-channel history keys collected from the key store. */
  readonly historyKeys?: readonly HistoryKeyRecord[];
  /** KDF cost override; tests use a weaker cost than the production default. */
  readonly cost?: Partial<Argon2idCost>;
}

export interface RecoveryBundle {
  /** Opaque ciphertext for `keyBackups.backupCiphertext`. */
  readonly backupCiphertext: string;
  /** JSON for `keyBackups.kdfParams`. */
  readonly kdfParams: string;
}

/**
 * Encrypts identity and history keys under the passphrase. Callers persist the
 * result with `api.keyBackups.put`.
 */
export async function buildRecoveryBundle(options: BuildRecoveryOptions): Promise<RecoveryBundle> {
  const check = validateRecoveryPassphrase(options.passphrase);
  if (!check.ok) {
    throw new Error(check.reason ?? "Passphrase is too weak");
  }
  return await createKeyBackup({
    passphrase: options.passphrase,
    payload: { identity: options.identity, historyKeys: options.historyKeys ?? [] },
    ...(options.cost !== undefined ? { cost: options.cost } : {}),
  });
}

export interface RestoreRecoveryOptions {
  readonly passphrase: string;
  readonly backupCiphertext: string;
  readonly kdfParams: string;
}

/**
 * Decrypts a bundle fetched from `keyBackups`. Throws when the passphrase is
 * wrong or the blob was tampered with.
 */
export async function restoreRecoveryBundle(
  options: RestoreRecoveryOptions,
): Promise<KeyBackupPayload> {
  return await openKeyBackup({
    passphrase: options.passphrase,
    backupCiphertext: options.backupCiphertext,
    kdfParams: options.kdfParams,
  });
}
