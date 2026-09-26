import { type BlobatarOptions, blobatar, normalizeSeed } from "blobatar";
import { blobatarUri } from "blobatar/uri";

/**
 * Stable seed for a user. Always seed with the immutable id, never the display
 * name, so an avatar does not change when someone renames themselves.
 */
export function userAvatarSeed(userId: string): string {
  return `aulora:user:${userId}`;
}

/** Stable seed for a server/workspace, matching the well-known `iconSeed`. */
export function serverAvatarSeed(serverId: string): string {
  return `aulora:server:${serverId}`;
}

/** Deterministic raw `<svg>` string for a seed. Used by the Phase 4 native path. */
export function avatarSvg(seed: string, options?: BlobatarOptions): string {
  return blobatar(seed, options);
}

/** Deterministic `data:image/svg+xml` URI for a seed. */
export function avatarDataUri(seed: string, options?: BlobatarOptions): string {
  return blobatarUri(seed, options);
}

/** Exposed so callers can normalize a seed exactly as Blobatar does. */
export function normalizeAvatarSeed(seed: string): string {
  return normalizeSeed(seed);
}
