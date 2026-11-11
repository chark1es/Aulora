import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Bounded, indexed checks shared by avatar adoption and upload reclamation. */
export async function storageIsReferenced(
  ctx: QueryCtx,
  storageId: Id<"_storage">,
  except: {
    memberId?: Id<"members">;
    fileId?: Id<"files"> | undefined;
    serverId?: Id<"server">;
  } = {},
): Promise<boolean> {
  const avatars = await ctx.db
    .query("members")
    .withIndex("by_avatar_storage", (q) => q.eq("avatarStorageId", storageId))
    .take(2);
  if (avatars.some((row) => row._id !== except.memberId)) return true;
  const logos = await ctx.db
    .query("server")
    .withIndex("by_logo_storage", (q) => q.eq("logoStorageId", storageId))
    .take(2);
  if (logos.some((row) => row._id !== except.serverId)) return true;
  const files = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .take(2);
  if (files.some((row) => row._id !== except.fileId)) return true;
  const sealed = await ctx.db
    .query("files")
    .withIndex("by_sealed_storage", (q) => q.eq("sealedStorageId", storageId))
    .take(2);
  if (sealed.some((row) => row._id !== except.fileId)) return true;
  const thumbnails = await ctx.db
    .query("files")
    .withIndex("by_thumbnail_storage", (q) => q.eq("thumbnailStorageId", storageId))
    .take(2);
  return thumbnails.some((row) => row._id !== except.fileId);
}
