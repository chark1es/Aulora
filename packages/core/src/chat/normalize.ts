import type { ChannelSummary, StoredFileView } from "./port";

/**
 * Normalization for rows that cross the Convex adapter boundary.
 *
 * Older servers omit optional fields (message markers, file thumbnails) and
 * hand back loosely typed documents. These helpers turn one into the stable
 * `@aulora/core` shape, shared by the web and mobile adapters.
 */

/** A `channels` document as Convex returns it, before narrowing. */
export interface ChannelSummaryRow {
  readonly id: string;
  readonly kind: ChannelSummary["kind"];
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly topic: string | null;
  readonly archived: boolean;
  readonly isPrivate?: boolean;
  readonly overrides?: readonly {
    targetId: string;
    targetType: "role" | "member";
    allow: bigint;
    deny: bigint;
  }[];
  readonly position?: number;
  readonly memberIds?: readonly string[];
  readonly hidden?: boolean;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  readonly pinnedAt?: number | null;
}

/** Narrows a channel document, keeping absent optional fields absent. */
export function normalizeChannelSummary(channel: ChannelSummaryRow): ChannelSummary {
  return {
    id: channel.id,
    kind: channel.kind,
    categoryId: channel.categoryId,
    name: channel.name,
    topic: channel.topic,
    archived: channel.archived,
    ...(channel.isPrivate !== undefined ? { isPrivate: channel.isPrivate } : {}),
    ...(channel.overrides !== undefined ? { overrides: channel.overrides } : {}),
    ...(channel.position !== undefined ? { position: channel.position } : {}),
    ...(channel.memberIds !== undefined ? { memberIds: channel.memberIds } : {}),
    ...(channel.hidden !== undefined ? { hidden: channel.hidden } : {}),
    ...(channel.muted !== undefined ? { muted: channel.muted } : {}),
    ...(channel.pinned !== undefined ? { pinned: channel.pinned } : {}),
    ...(channel.pinnedAt !== undefined ? { pinnedAt: channel.pinnedAt } : {}),
  };
}

/** A `files` document as Convex returns it, before narrowing. */
export interface StoredFileRow {
  readonly id: string;
  readonly uploaderId: string;
  readonly sizeBytes: number;
  readonly name: string | null;
  readonly mime: string | null;
  readonly dimensions: string | null;
  readonly blurhash: string | null;
  readonly url: string | null;
  readonly thumbnailUrl?: string | null;
}

/** Maps a Convex `files` view onto the framework-agnostic stored-file shape. */
export function normalizeStoredFile(file: StoredFileRow): StoredFileView {
  return {
    id: file.id,
    uploaderId: file.uploaderId,
    sizeBytes: file.sizeBytes,
    name: file.name,
    mime: file.mime,
    dimensions: file.dimensions,
    blurhash: file.blurhash,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl ?? null,
  };
}

/**
 * Older servers omit message markers. Normalize pages and single message views,
 * filling the two marker flags a client reads.
 */
export function normalizeMessagePayloads<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeMessagePayloads) as T;
  if (typeof value !== "object" || value === null) return value;
  if ("page" in value && Array.isArray(value.page))
    return { ...value, page: value.page.map(normalizeMessagePayloads) };
  if ("mentionUserIds" in value)
    return {
      ...value,
      mentionEveryone: "mentionEveryone" in value && value.mentionEveryone === true,
      mentionHere: "mentionHere" in value && value.mentionHere === true,
    };
  return value;
}
