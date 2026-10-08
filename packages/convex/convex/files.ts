import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate, listActiveBans } from "./lib/bans";
import { requireChannelAccessForUser } from "./lib/channels";
import { getEkmSettings } from "./lib/ekm";
import { DOWNLOAD_TOKEN_TTL_MS, signDownloadToken, verifyDownloadToken } from "./lib/fileTokens";
import { effectiveMaxUploadBytes } from "./lib/instance";
import { requireBoardForUser, writableBoard } from "./lib/kanban";
import { requireMember, requireWorkspacePermission } from "./lib/permissions";
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
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
    await assertMayParticipate(ctx, userId);
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
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Authorizes a finalize and enforces the size cap against the authoritative
 * `_storage` metadata (not the client's claim). Internal so the sealing action
 * can run it with the caller's identity.
 */
export const authorizeUpload = internalMutation({
  args: { storageId: v.id("_storage"), kanbanBoardId: v.optional(v.id("kanbanBoards")) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
    await assertMayParticipate(ctx, userId);
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
    return await ctx.db.insert("files", {
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
      ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
      ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
    });
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
    const blob = await ctx.storage.get(args.storageId);
    if (blob === null) {
      throw new ConvexError("Upload not found");
    }
    const plaintext = new Uint8Array(await blob.arrayBuffer());
    const sealed = await sealBytes({ ...BYTES_CONTEXT, recordId: args.storageId }, plaintext);
    const sealedStorageId = await ctx.storage.store(new Blob([sealed]));
    const keyVersion = getEkmSettings(process.env).keyVersion;
    const nameCiphertext = await sealString(NAME_CONTEXT, args.name);
    const mimeCiphertext = await sealString(MIME_CONTEXT, args.mime);
    const dimensionsCiphertext =
      args.dimensions !== undefined
        ? await sealString(DIMENSIONS_CONTEXT, args.dimensions)
        : undefined;
    const blurhashCiphertext =
      args.blurhash !== undefined ? await sealString(BLURHASH_CONTEXT, args.blurhash) : undefined;
    const fileId = await ctx.runMutation(internal.files.insertFinalized, {
      storageId: sealedStorageId,
      sealedStorageId: args.storageId,
      uploaderId: userId,
      sizeBytes,
      keyVersion,
      nameCiphertext,
      mimeCiphertext,
      ...(dimensionsCiphertext !== undefined ? { dimensionsCiphertext } : {}),
      ...(blurhashCiphertext !== undefined ? { blurhashCiphertext } : {}),
      ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
      ...(args.kanbanBoardId !== undefined ? { kanbanBoardId: args.kanbanBoardId } : {}),
    });
    await ctx.storage.delete(args.storageId);
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
    return { storageId: row.storageId, sealedStorageId: row.sealedStorageId };
  },
});

/**
 * Opens one file's sealed bytes. The token is the sole authorization; it is
 * signed over `fileId|userId|exp` and short-lived. Convex carries bytes as
 * `ArrayBuffer` (`v.bytes()`), so that is what clients receive.
 */
export const download = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ bytes: ArrayBuffer }> => {
    const payload = await verifyDownloadToken(args.token);
    const row = await ctx.runQuery(internal.files.authorizeDownload, {
      fileId: payload.fileId,
      userId: payload.userId,
    });
    if (row === null) {
      throw new ConvexError("File not found");
    }
    const blob = await ctx.storage.get(row.storageId);
    if (blob === null) {
      throw new ConvexError("Sealed file bytes not found");
    }
    const sealed = new Uint8Array(await blob.arrayBuffer());
    const bytes = await openBytes({ ...BYTES_CONTEXT, recordId: row.sealedStorageId }, sealed);
    return { bytes: bytes.buffer };
  },
});

async function downloadUrl(fileId: Id<"files">, userId: string): Promise<string> {
  const token = await signDownloadToken({
    fileId,
    userId,
    exp: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
  });
  const path = `/files/download?token=${encodeURIComponent(token)}`;
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
    const views: FileView[] = [];
    for (const fileId of args.fileIds) {
      const row = await ctx.db.get(fileId);
      if (row !== null && (await canAccessFile(ctx, userId, row))) {
        views.push(await toFileView(row, userId));
      }
    }
    return views;
  },
});
