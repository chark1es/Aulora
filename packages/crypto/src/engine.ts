/**
 * The swap point for Aulora's end-to-end encryption.
 *
 * Web and Tauri desktop use `createWebMlsEngine()` (ts-mls). Mobile will use
 * an OpenMLS-backed implementation behind this exact interface (see
 * `MOBILE.md`). Callers must only depend on this interface, never on ts-mls.
 *
 * Boundary rules:
 * - All methods are async so the same interface works in a Worker or over a
 *   native bridge.
 * - Wire values are opaque `Uint8Array`s (already TLS/MLS-encoded messages).
 * - Plaintext only ever leaves the engine through `decrypt`'s return value.
 * - The engine never logs plaintext, keys or tokens.
 */

/** A member as seen from the local device. */
export interface MlsMember {
  /** The member's leaf index in the ratchet tree; used for `removeMembers`. */
  readonly leafIndex: number;
  /** The decoded Basic credential identity (a stable `aulora:device:<id>`). */
  readonly identity: string;
}

/** Result of adding members: a commit for existing members plus a Welcome. */
export interface AddMembersResult {
  /** Encoded MLS commit to broadcast to the current members. */
  readonly commit: Uint8Array;
  /** Encoded MLS Welcome for the newly added members. */
  readonly welcome: Uint8Array;
}

export interface MlsEngine {
  /**
   * Create a fresh KeyPackage for this device and return it TLS-encoded. The
   * private half is stored in the engine's key store and consumed once by
   * `createGroup` or `joinFromWelcome`.
   */
  generateKeyPackage(): Promise<Uint8Array>;

  /**
   * Start a new group. `keyPackage` is a value previously returned by
   * {@link generateKeyPackage} for this device.
   */
  createGroup(groupId: Uint8Array, keyPackage: Uint8Array): Promise<void>;

  /**
   * Join a group from a Welcome. `keyPackage` must be the same device
   * KeyPackage whose public half the adder used.
   */
  joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void>;

  /** Add members from their encoded KeyPackages. Advances the epoch. */
  addMembers(keyPackages: readonly Uint8Array[]): Promise<AddMembersResult>;

  /** Remove members by leaf index. Advances the epoch. Returns the commit. */
  removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array>;

  /**
   * Apply an incoming handshake commit (public or private wire format) and
   * advance the local epoch.
   */
  processCommit(commit: Uint8Array): Promise<void>;

  /** Encrypt an application payload for the current epoch. */
  encrypt(plaintext: Uint8Array): Promise<Uint8Array>;

  /**
   * Decrypt an application payload. Rejects with {@link MlsEngineError} if the
   * message is not an application message (route handshakes through
   * `processCommit`) or cannot be opened.
   */
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;

  /** Current MLS epoch of the active group. */
  epoch(): Promise<bigint>;

  /** Current members of the active group. */
  members(): Promise<readonly MlsMember[]>;

  /** Serialize the full active group state (ratchet, secrets, tree). */
  exportState(): Promise<Uint8Array>;

  /** Replace the active group state from a previous {@link exportState}. */
  importState(state: Uint8Array): Promise<void>;
}
