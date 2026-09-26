import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireWorkspacePermission } from "./lib/permissions";
import { enforceRateLimit, ipRateLimitKey, requestIp, userRateLimitKey } from "./lib/rateLimit";

/** Maximum plaintext/ciphertext upload size, overridable per deployment. */
export function maxUploadBytes(): number {
  const configured = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 25 * 1024 * 1024;
}

function uploadLimit(): number {
  const configured = Number(process.env.UPLOAD_RATE_LIMIT);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function uploadWindowMs(): number {
  const configured = Number(process.env.UPLOAD_RATE_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

/**
 * Creates a short-lived Convex storage upload URL. `AttachFiles` is required,
 * and both the caller and the request IP are rate limited.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
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
 * Records metadata for a file already placed in Convex storage. The size cap is
 * enforced against the authoritative stored size, not the client's claim.
 * All `*Ciphertext` values are opaque.
 */
export const record = mutation({
  args: {
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
    nameCiphertext: v.optional(v.string()),
    mimeCiphertext: v.optional(v.string()),
    dimensionsCiphertext: v.optional(v.string()),
    blurhashCiphertext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.AttachFiles);
    await enforceRateLimit(ctx, {
      key: userRateLimitKey("upload", userId),
      limit: uploadLimit(),
      windowMs: uploadWindowMs(),
    });
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (metadata === null) {
      throw new ConvexError("Upload not found");
    }
    if (metadata.size > maxUploadBytes()) {
      throw new ConvexError("File exceeds the upload size cap");
    }
    const fileId = await ctx.db.insert("files", {
      storageId: args.storageId,
      uploaderId: userId,
      sizeBytes: metadata.size,
      ...(args.nameCiphertext !== undefined ? { nameCiphertext: args.nameCiphertext } : {}),
      ...(args.mimeCiphertext !== undefined ? { mimeCiphertext: args.mimeCiphertext } : {}),
      ...(args.dimensionsCiphertext !== undefined
        ? { dimensionsCiphertext: args.dimensionsCiphertext }
        : {}),
      ...(args.blurhashCiphertext !== undefined
        ? { blurhashCiphertext: args.blurhashCiphertext }
        : {}),
    });
    return fileId;
  },
});

interface FileView {
  readonly id: Id<"files">;
  readonly uploaderId: string;
  readonly sizeBytes: number;
  readonly nameCiphertext: string | null;
  readonly mimeCiphertext: string | null;
  readonly dimensionsCiphertext: string | null;
  readonly blurhashCiphertext: string | null;
  readonly url: string | null;
}

async function toFileView(ctx: QueryCtx, row: Doc<"files">): Promise<FileView> {
  return {
    id: row._id,
    uploaderId: row.uploaderId,
    sizeBytes: row.sizeBytes,
    nameCiphertext: row.nameCiphertext ?? null,
    mimeCiphertext: row.mimeCiphertext ?? null,
    dimensionsCiphertext: row.dimensionsCiphertext ?? null,
    blurhashCiphertext: row.blurhashCiphertext ?? null,
    url: await ctx.storage.getUrl(row.storageId),
  };
}

/** Returns one file's metadata plus a fresh download URL. */
export const get = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const row = await ctx.db.get(args.fileId);
    if (row === null) {
      return null;
    }
    return await toFileView(ctx, row);
  },
});

/** Returns metadata plus download URLs for a batch of files. */
export const getMany = query({
  args: { fileIds: v.array(v.id("files")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const views: FileView[] = [];
    for (const fileId of args.fileIds) {
      const row = await ctx.db.get(fileId);
      if (row !== null) {
        views.push(await toFileView(ctx, row));
      }
    }
    return views;
  },
});
