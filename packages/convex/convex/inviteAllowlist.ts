import { hasPermission, Permission, parseAllowlistEntry } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { accountNames } from "./lib/accountNames";
import { writeAudit } from "./lib/audit";
import { requireWorkspaceContext, requireWorkspacePermission } from "./lib/permissions";

/** Most entries a workspace may hold, so the list stays reviewable. */
const ALLOWLIST_LIMIT = 1000;

const NOTE_MAX_LENGTH = 80;

/**
 * The allowlist: addresses (or whole domains) that may join an invite-only
 * workspace without a link once they have proved they own the address.
 * Requires `CreateInvites` or `DeleteInvites` to read.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { permissions } = await requireWorkspaceContext(ctx);
    if (
      !hasPermission(permissions, Permission.CreateInvites) &&
      !hasPermission(permissions, Permission.DeleteInvites)
    ) {
      throw new ConvexError("Missing permission");
    }
    const entries = await ctx.db.query("inviteAllowlist").order("desc").take(ALLOWLIST_LIMIT);
    const names = await accountNames(
      ctx,
      entries.map((entry) => entry.addedBy),
    );
    return entries.map((entry) => ({
      id: entry._id,
      pattern: entry.pattern,
      kind: entry.kind,
      note: entry.note ?? null,
      addedBy: entry.addedBy,
      addedByName: names.get(entry.addedBy) ?? null,
      addedAt: entry.addedAt,
    }));
  },
});

/** Adds an address (`sam@acme.com`) or a domain (`@acme.com`). Requires `CreateInvites`. */
export const add = mutation({
  args: { entry: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.CreateInvites);
    const parsed = parseAllowlistEntry(args.entry);
    if (parsed === null) {
      throw new ConvexError("Enter an email address like sam@acme.com, or a domain like @acme.com");
    }
    const note = args.note?.trim();
    if (note !== undefined && note.length > NOTE_MAX_LENGTH) {
      throw new ConvexError(`Notes can be at most ${NOTE_MAX_LENGTH} characters`);
    }
    const existing = await ctx.db
      .query("inviteAllowlist")
      .withIndex("by_pattern", (q) => q.eq("pattern", parsed.pattern))
      .unique();
    if (existing !== null) {
      return { entryId: existing._id, created: false };
    }
    const total = (await ctx.db.query("inviteAllowlist").take(ALLOWLIST_LIMIT)).length;
    if (total >= ALLOWLIST_LIMIT) {
      throw new ConvexError("The allowlist is full");
    }
    const entryId = await ctx.db.insert("inviteAllowlist", {
      pattern: parsed.pattern,
      kind: parsed.kind,
      addedBy: userId,
      addedAt: Date.now(),
      ...(note !== undefined && note.length > 0 ? { note } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "allowlist.add",
      targetId: entryId,
      meta: JSON.stringify({ pattern: parsed.pattern }),
    });
    return { entryId, created: true };
  },
});

/** Removes an entry. People who already joined stay. Requires `DeleteInvites`. */
export const remove = mutation({
  args: { entryId: v.id("inviteAllowlist") },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.DeleteInvites);
    const entry = await ctx.db.get(args.entryId);
    if (entry === null) {
      throw new ConvexError("Allowlist entry not found");
    }
    await ctx.db.delete(args.entryId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "allowlist.remove",
      targetId: args.entryId,
      meta: JSON.stringify({ pattern: entry.pattern }),
    });
    return { removed: true };
  },
});
