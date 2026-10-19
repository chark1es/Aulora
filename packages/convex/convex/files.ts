import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate, listActiveBans } from "./lib/bans";
import { requireChannelAccessForUser, requireChannelAccessFromContext } from "./lib/channels";
import { getEkmSettings } from "./lib/ekm";
import { DOWNLOAD_TOKEN_TTL_MS, signDownloadToken, verifyDownloadToken } from "./lib/fileTokens";
import { adjustInstanceCounters, effectiveMaxUploadBytes } from "./lib/instance";
import { requireBoardForUser, requireBoardForUserFromContext, writableBoard } from "./lib/kanban";
import {
  loadPermissionContext,
  requireMember,
  requireWorkspacePermission,
} from "./lib/permissions";
import { enforceRateLimit, ipRateLimitKey, requestIp, userRateLimitKey } from "./lib/rateLimit";
import { openContentOptional } from "./lib/sealed";
import { openBytes, sealBytes, sealString } from "./lib/sse";

function uploadLimit(): number {
  const configured = Number(process.env.UPLOAD_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function uploadWindowMs(): number {
  const configured = Number(process.env.UPLOAD_RATE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

/**
 * Cap for an optional thumbnail variant upload. Thumbnails are generated at a
 * small edge length client-side, so this is generous; it only bounds a
 * malicious multi-megabyte "thumbnail".
 */
const THUMBNAIL_MAX_BYTES = 1024 * 1024;

const BYTES_CONTEXT = { scope: "file.bytes" } as const;
const NAME_CONTEXT = { scope: "file.name" } as const;
const MIME_CONTEXT = { scope: "file.mime" } as const;
const DIMENSIONS_CONTEXT = { scope: "file.dimensions" } as const;
const BLURHASH_CONTEXT = { scope: "file.blurhash" } as const;

/**
 * Creates a short-lived Convex storage upload URL. `AttachFiles` is required,
 * and both the caller and the request IP are rate limited. The client PUTs
 * plaintext bytes; `finalize` seals them.
 */
export const generateUploadUrl = mutation({
  args: { skipRateLimit: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
    await assertMayParticipate(ctx, userId);
    // A companion thumbnail upload has its own equally bounded bucket, so it
    // shares the image allowance without letting a client skip rate limiting.
    if (args.skipRateLimit === true) {
      await enforceRateLimit(ctx, {
        key: userRateLimitKey("upload-thumb", userId),
        limit: uploadLimit(),
        windowMs: uploadWindowMs(),
      });
      await enforceRateLimit(ctx, {
        key: ipRateLimitKey("upload-thumb", await requestIp(ctx)),
        limit: uploadLimit() * 5,
        windowMs: uploadWindowMs(),
      });
    } else {
      await enforceRateLimit(ctx, {
        key: userRateLimitKey("upload", userId),
        limit: uploadLimit(),
        windowMs: uploadWindowMs(),
      });
      await enforceRateLimit(ctx, {
        key: ipRateLimitKey("upload", await requestIp(ctx)),
        limit: uploadLimit() * 5,
        windowMs: uploadWindowMs(),
      });
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Authorizes a finalize and enforces the size cap against the authoritative
 * `_storage` metadata (not the client's claim). Internal so the sealing action
 * can run it with the caller's identity.
 */
export const authorizeUpload = internalMutation({
  args: {
    storageId: v.id("_storage"),
    kanbanBoardId: v.optional(v.id("kanbanBoards")),
    skipRateLimit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
    await assertMayParticipate(ctx, userId);
    if (args.skipRateLimit !== true) {
      await enforceRateLimit(ctx, {
        key: userRateLimitKey("upload", userId),
        limit: uploadLimit(),
        windowMs: uploadWindowMs(),
      });
      await enforceRateLimit(ctx, {
        key: ipRateLimitKey("upload", await requestIp(ctx)),
        limit: uploadLimit() * 5,
        windowMs: uploadWindowMs(),
      });
    }
    if (args.kanbanBoardId !== undefined) await writableBoard(ctx, args.kanbanBoardId);
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (metadata === null) {
      throw new ConvexError("Upload not found");
    }
    const maxBytes = await effectiveMaxUploadBytes(ctx);
    if (metadata.size > maxBytes) {
      throw new ConvexError(`File exceeds the upload size cap (${maxBytes} bytes)`);
    }
    return { userId, sizeBytes: metadata.size };
  },
});

/** Inserts the finalized row; the action has already sealed every field. */
export const insertFinalized = internalMutation({
  args: {
    storageId: v.id("_storage"),
    sealedStorageId: v.id("_storage"),
    uploaderId: v.string(),
    sizeBytes: v.number(),
    keyVersion: v.string(),
    nameCiphertext: v.string(),
    mimeCiphertext: v.string(),
    dimensionsCiphertext: v.optional(v.string()),
    blurhashCiphertext: v.optional(v.string()),
    /** Sealed thumbnail variant bytes, when one was produced. */
    thumbnailStorageId: v.optional(v.id("_storage")),
    channelId: v.optional(v.id("channels")),
    kanbanBoardId: v.optional(v.id("kanbanBoards")),
  },
  handler: async (ctx, args) => {
    if (args.kanbanBoardId !== undefined) {
      const access = await requireBoardForUser(
        ctx,
        args.uploaderId,
        args.kanbanBoardId,
        Permission.EditKanban | Permission.AttachFiles,
      );
      if (access.board.archived) throw new ConvexError("Restore the board before uploading files");
      await assertMayParticipate(ctx, args.uploaderId);
    }
    const fileId = await ctx.db.insert("files", {
      storageId: args.storageId,
      sealedStorageId: args.sealedStorageId,
      uploaderId: args.uploaderId,
      sizeBytes: args.sizeBytes,
      keyVersion: args.keyVersion,
      nameCiphertext: args.nameCiphertext,
      mimeCiphertext: args.mimeCiphertext,
      ...(args.dimensionsCiphertext !== undefined
        ? { dimensionsCiphertext: args.dimensionsCiphertext }
        : {}),
      ...(args.blurhashCiphertext !== undefined
        ? { blurhashCiphertext: args.blurhashCiphertext }
        : {}),
      ...(args.thumbnailStorageId !== undefined
        ? { thumbnailStorageId: args.thumbnailStorageId }
        : {}),
      ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
      ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
    });
    await adjustInstanceCounters(ctx, { files: 1, fileBytes: args.sizeBytes });
    return fileId;
  },
});

/**
 * Atomically deletes an upload's plaintext source when no file row other than
 * `exceptFileId` references it. Runs as one mutation so a concurrent finalize
 * cannot insert a reference between the check and the delete; taking two rows
 * per index avoids the new row hiding a second reference.
 */
export const reclaimUploadSource = internalMutation({
  args: { storageId: v.id("_storage"), exceptFileId: v.id("files") },
  handler: async (ctx, args) => {
    const byStorage = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .take(2);
    if (byStorage.some((row) => row._id !== args.exceptFileId)) {
      return false;
    }
    const bySealed = await ctx.db
      .query("files")
      .withIndex("by_sealed_storage", (q) => q.eq("sealedStorageId", args.storageId))
      .take(2);
    if (bySealed.some((row) => row._id !== args.exceptFileId)) {
      return false;
    }
    const byThumbnail = await ctx.db
      .query("files")
      .withIndex("by_thumbnail_storage", (q) => q.eq("thumbnailStorageId", args.storageId))
      .take(2);
    if (byThumbnail.some((row) => row._id !== args.exceptFileId)) {
      return false;
    }
    await ctx.storage.delete(args.storageId);
    return true;
  },
});

/**
 * Seals an uploaded blob: reads the plaintext bytes from Convex storage, seals
 * them with `file.bytes` bound to the upload's storage id, stores the sealed
 * blob under a new storage id, records sealed metadata and deletes the original.
 * The client never handles a key.
 */
export const finalize = action({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    mime: v.string(),
    sizeBytes: v.optional(v.number()),
    dimensions: v.optional(v.string()),
    blurhash: v.optional(v.string()),
    /**
     * Optional small thumbnail/placeholder variant, uploaded through the same
     * generated URL flow as the original. It is sealed with the same
     * `file.bytes` scope, bound to a record id derived from the original upload,
     * so no extra key material is required.
     */
    thumbnailStorageId: v.optional(v.id("_storage")),
    channelId: v.optional(v.id("channels")),
    kanbanBoardId: v.optional(v.id("kanbanBoards")),
  },
  handler: async (ctx, args): Promise<Id<"files">> => {
    if (args.kanbanBoardId !== undefined && args.channelId !== undefined)
      throw new ConvexError("Choose a channel or a board for this file");
    const { userId, sizeBytes } = await ctx.runMutation(internal.files.authorizeUpload, {
      storageId: args.storageId,
      ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
    });
    if (args.thumbnailStorageId !== undefined) {
      // Authorize the variant through the same path as the original rather than
      // trusting a client-supplied storage id.
      await ctx.runMutation(internal.files.authorizeUpload, {
        storageId: args.thumbnailStorageId,
        ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
        skipRateLimit: true,
      });
    }
    const blob = await ctx.storage.get(args.storageId);
    if (blob === null) {
      throw new ConvexError("Upload not found");
    }
    // Validate the thumbnail before storing the sealed original so a missing or
    // oversized variant cannot orphan it.
    const thumbnailBlob =
      args.thumbnailStorageId === undefined ? null : await ctx.storage.get(args.thumbnailStorageId);
    if (args.thumbnailStorageId !== undefined && thumbnailBlob === null) {
      throw new ConvexError("Thumbnail upload not found");
    }
    if (thumbnailBlob !== null && thumbnailBlob.size > THUMBNAIL_MAX_BYTES) {
      throw new ConvexError("Thumbnail exceeds the size cap");
    }
    const keyVersion = getEkmSettings(process.env).keyVersion;
    const nameCiphertext = await sealString(NAME_CONTEXT, args.name);
    const mimeCiphertext = await sealString(MIME_CONTEXT, args.mime);
    const dimensionsCiphertext =
      args.dimensions !== undefined
        ? await sealString(DIMENSIONS_CONTEXT, args.dimensions)
        : undefined;
    const blurhashCiphertext =
      args.blurhash !== undefined ? await sealString(BLURHASH_CONTEXT, args.blurhash) : undefined;
    const plaintext = new Uint8Array(await blob.arrayBuffer());
    const sealed = await sealBytes({ ...BYTES_CONTEXT, recordId: args.storageId }, plaintext);
    const sealedStorageId = await ctx.storage.store(new Blob([sealed]));
    const stored: { thumbnailId?: Id<"_storage"> } = {};
    if (thumbnailBlob !== null) {
      try {
        const thumbnailPlaintext = new Uint8Array(await thumbnailBlob.arrayBuffer());
        const thumbnailSealed = await sealBytes(
          // Derive a distinct record id from the original upload so the thumbnail
          // can be re-opened without persisting a second sealed-record id.
          { ...BYTES_CONTEXT, recordId: `${args.storageId}:thumb` },
          thumbnailPlaintext,
        );
        stored.thumbnailId = await ctx.storage.store(new Blob([thumbnailSealed]));
      } catch (error) {
        await ctx.storage.delete(sealedStorageId);
        throw error;
      }
    }
    let fileId: Id<"files">;
    try {
      fileId = await ctx.runMutation(internal.files.insertFinalized, {
        storageId: sealedStorageId,
        sealedStorageId: args.storageId,
        uploaderId: userId,
        sizeBytes,
        keyVersion,
        nameCiphertext,
        mimeCiphertext,
        ...(dimensionsCiphertext !== undefined ? { dimensionsCiphertext } : {}),
        ...(blurhashCiphertext !== undefined ? { blurhashCiphertext } : {}),
        ...(stored.thumbnailId !== undefined ? { thumbnailStorageId: stored.thumbnailId } : {}),
        ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
        ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
      });
    } catch (error) {
      // No row references the sealed blobs yet, so both are safe to remove.
      await ctx.storage.delete(sealedStorageId).catch(() => undefined);
      if (stored.thumbnailId !== undefined) {
        await ctx.storage.delete(stored.thumbnailId).catch(() => undefined);
      }
      throw error;
    }
    await ctx.runMutation(internal.files.reclaimUploadSource, {
      storageId: args.storageId,
      exceptFileId: fileId,
    });
    if (args.thumbnailStorageId !== undefined) {
      await ctx.runMutation(internal.files.reclaimUploadSource, {
        storageId: args.thumbnailStorageId,
        exceptFileId: fileId,
      });
    }
    return fileId;
  },
});

/**
 * Re-validates the download token's user against current membership, ban state
 * and the file's channel, then returns the storage pointers. The signed token
 * proves identity at mint time, not standing, so a user kicked or banned after
 * the URL was issued must not keep downloading. Internal: callers reach it only
 * through the action, which passes the verified token subject.
 */
export const authorizeDownload = internalQuery({
  args: { fileId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileId as Id<"files">);
    if (row === null) {
      return null;
    }
    if ((await listActiveBans(ctx, args.userId)).length > 0) {
      throw new ConvexError("You are banned from this workspace");
    }
    await requireMember(ctx, args.userId);
    if (row.kanbanBoardId !== undefined) {
      await requireBoardForUser(ctx, args.userId, row.kanbanBoardId);
    } else if (row.channelId !== undefined) {
      await requireChannelAccessForUser(ctx, args.userId, row.channelId, Permission.ViewChannel);
    } else if (row.uploaderId !== args.userId) {
      throw new ConvexError("You do not have access to this file");
    }
    return {
      storageId: row.storageId,
      sealedStorageId: row.sealedStorageId,
      thumbnailStorageId: row.thumbnailStorageId ?? null,
    };
  },
});

/**
 * Opens one file's sealed bytes. The token is the sole authorization; it is
 * signed over `fileId|userId|exp` and short-lived. Convex carries bytes as
 * `ArrayBuffer` (`v.bytes()`), so that is what clients receive.
 */
export const download = action({
  args: {
    token: v.string(),
    /**
     * Which variant to return: the original bytes (default) or the small
     * thumbnail produced at upload time. The token still authorizes the file,
     * so both variants require the same access; an absent thumbnail falls back
     * to the original so old records and non-image uploads keep working.
     */
    variant: v.optional(v.union(v.literal("original"), v.literal("thumbnail"))),
  },
  handler: async (ctx, args): Promise<{ bytes: ArrayBuffer }> => {
    const payload = await verifyDownloadToken(args.token);
    const row = await ctx.runQuery(internal.files.authorizeDownload, {
      fileId: payload.fileId,
      userId: payload.userId,
    });
    if (row === null) {
      throw new ConvexError("File not found");
    }
    const thumbnailStorageId =
      args.variant === "thumbnail" && row.thumbnailStorageId !== null
        ? row.thumbnailStorageId
        : null;
    const storageId = thumbnailStorageId ?? row.storageId;
    const recordId =
      thumbnailStorageId !== null ? `${row.sealedStorageId}:thumb` : row.sealedStorageId;
    const blob = await ctx.storage.get(storageId);
    if (blob === null) {
      throw new ConvexError("Sealed file bytes not found");
    }
    const sealed = new Uint8Array(await blob.arrayBuffer());
    const bytes = await openBytes({ ...BYTES_CONTEXT, recordId }, sealed);
    return { bytes: bytes.buffer };
  },
});

async function downloadUrl(
  fileId: Id<"files">,
  userId: string,
  variant?: "thumbnail",
): Promise<string> {
  const token = await signDownloadToken({
    fileId,
    userId,
    exp: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
  });
  const variantParam = variant === undefined ? "" : `&variant=${variant}`;
  const path = `/files/download?token=${encodeURIComponent(token)}${variantParam}`;
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  return site !== undefined && site.length > 0 ? `${site}${path}` : path;
}

interface FileView {
  readonly id: Id<"files">;
  readonly uploaderId: string;
  readonly sizeBytes: number;
  readonly name: string | null;
  readonly mime: string | null;
  readonly dimensions: string | null;
  readonly blurhash: string | null;
  /** Signed, short-lived URL that yields decrypted bytes. */
  readonly url: string;
  /**
   * Signed, short-lived URL for the small thumbnail variant, or `null` when the
   * row has none (old records, non-image uploads). Clients fall back to `url`.
   */
  readonly thumbnailUrl: string | null;
}

async function toFileView(row: Doc<"files">, userId: string): Promise<FileView> {
  return {
    id: row._id,
    uploaderId: row.uploaderId,
    sizeBytes: row.sizeBytes,
    name: await openContentOptional(NAME_CONTEXT, row.nameCiphertext),
    mime: await openContentOptional(MIME_CONTEXT, row.mimeCiphertext),
    dimensions: await openContentOptional(DIMENSIONS_CONTEXT, row.dimensionsCiphertext),
    blurhash: await openContentOptional(BLURHASH_CONTEXT, row.blurhashCiphertext),
    url: await downloadUrl(row._id, userId),
    thumbnailUrl:
      row.thumbnailStorageId !== undefined ? await downloadUrl(row._id, userId, "thumbnail") : null,
  };
}

/** True when `userId` may read `row`'s metadata and bytes. */
async function canAccessFile(ctx: QueryCtx, userId: string, row: Doc<"files">): Promise<boolean> {
  if (row.kanbanBoardId !== undefined) {
    try {
      await requireBoardForUser(ctx, userId, row.kanbanBoardId);
      return true;
    } catch {
      return false;
    }
  }
  if (row.channelId !== undefined) {
    try {
      await requireChannelAccessForUser(ctx, userId, row.channelId, Permission.ViewChannel);
      return true;
    } catch {
      return false;
    }
  }
  return row.uploaderId === userId;
}

/** Returns one file's plaintext metadata plus a signed download URL. */
export const get = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const row = await ctx.db.get(args.fileId);
    if (row === null) {
      return null;
    }
    if (!(await canAccessFile(ctx, userId, row))) {
      throw new ConvexError("You do not have access to this file");
    }
    return await toFileView(row, userId);
  },
});

/** Returns plaintext metadata plus signed download URLs for a batch of files. */
export const getMany = query({
  args: { fileIds: v.array(v.id("files")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    // Load the permission context once and resolve access per distinct
    // channel/board, rather than re-loading roles and server state per file.
    const context = await loadPermissionContext(ctx, userId);

    const rows = await Promise.all(args.fileIds.map(async (fileId) => await ctx.db.get(fileId)));

    const channelIds = new Set<Id<"channels">>();
    const boardIds = new Set<Id<"kanbanBoards">>();
    for (const row of rows) {
      if (row === null) continue;
      // A board-scoped file takes precedence over the channel check, matching
      // canAccessFile.
      if (row.kanbanBoardId !== undefined) {
        boardIds.add(row.kanbanBoardId);
      } else if (row.channelId !== undefined) {
        channelIds.add(row.channelId);
      }
    }

    const allowedChannels = new Set<Id<"channels">>();
    for (const channelId of channelIds) {
      try {
        await requireChannelAccessFromContext(ctx, context, channelId, Permission.ViewChannel);
        allowedChannels.add(channelId);
      } catch {
        // A channel the viewer cannot see simply drops its files.
      }
    }
    const allowedBoards = new Set<Id<"kanbanBoards">>();
    for (const boardId of boardIds) {
      try {
        await requireBoardForUserFromContext(ctx, context, boardId);
        allowedBoards.add(boardId);
      } catch {
        // A board the viewer cannot see simply drops its files.
      }
    }

    const views: FileView[] = [];
    for (const row of rows) {
      if (row === null) continue;
      const allowed =
        row.kanbanBoardId !== undefined
          ? allowedBoards.has(row.kanbanBoardId)
          : row.channelId !== undefined
            ? allowedChannels.has(row.channelId)
            : row.uploaderId === userId;
      if (allowed) {
        views.push(await toFileView(row, userId));
      }
    }
    return views;
  },
});
