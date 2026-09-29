import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { overwriteValidator, validateOverrides } from "./lib/overrides";
import { requireMember, requireWorkspacePermission } from "./lib/permissions";

interface CategoryView {
  readonly id: Doc<"categories">["_id"];
  readonly name: string;
  readonly position: number;
  readonly overrides: Doc<"categories">["overrides"];
}

function toCategoryView(category: Doc<"categories">): CategoryView {
  return {
    id: category._id,
    name: category.name,
    position: category.position,
    overrides: category.overrides,
  };
}

/** Categories in display order. Readable by any signed-in member. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const categories = await ctx.db.query("categories").collect();
    return categories.sort((a, b) => a.position - b.position).map(toCategoryView);
  },
});

/** Creates a category at the bottom of the list. Requires `ManageChannels`. */
export const create = mutation({
  args: { name: v.string(), position: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageChannels);
    const categories = await ctx.db.query("categories").collect();
    const maxPosition = categories.reduce((max, item) => Math.max(max, item.position), -1);
    const position = args.position ?? maxPosition + 1;
    const categoryId = await ctx.db.insert("categories", {
      name: args.name,
      position,
      overrides: [],
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "category.create",
      targetId: categoryId,
      meta: JSON.stringify({ name: args.name }),
    });
    return categoryId;
  },
});

/** Renames or repositions a category. Requires `ManageChannels`. */
export const update = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    await ctx.db.patch(args.categoryId, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "category.update",
      targetId: args.categoryId,
    });
    return null;
  },
});

/**
 * Replaces a category's overrides. Requires `ManageChannels`.
 */
export const setOverrides = mutation({
  args: { categoryId: v.id("categories"), overrides: v.array(overwriteValidator) },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    validateOverrides(args.overrides);
    const category = await ctx.db.get(args.categoryId);
    if (category === null) {
      throw new ConvexError("Category not found");
    }
    await ctx.db.patch(args.categoryId, { overrides: args.overrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "category.setOverrides",
      targetId: args.categoryId,
      meta: JSON.stringify({ count: args.overrides.length }),
    });
    return null;
  },
});

/** Clears one override target from a category. */
export const clearOverride = mutation({
  args: {
    categoryId: v.id("categories"),
    targetId: v.string(),
    targetType: v.union(v.literal("role"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    const category = await ctx.db.get(args.categoryId);
    if (category === null) {
      throw new ConvexError("Category not found");
    }
    const nextOverrides = category.overrides.filter(
      (override) =>
        !(override.targetId === args.targetId && override.targetType === args.targetType),
    );
    await ctx.db.patch(args.categoryId, { overrides: nextOverrides });
    await writeAudit(ctx, {
      actorId: userId,
      action: "category.clearOverride",
      targetId: args.categoryId,
      meta: JSON.stringify({ targetId: args.targetId, targetType: args.targetType }),
    });
    return null;
  },
});

/** Deletes a category, leaving its channels uncategorised. */
export const remove = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(
      ctx,
      Permission.ManageChannels,
      args.categoryId,
    );
    const category = await ctx.db.get(args.categoryId);
    if (category === null) {
      throw new ConvexError("Category not found");
    }
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    for (const channel of channels) {
      await ctx.db.patch(channel._id, { categoryId: undefined });
    }
    await ctx.db.delete(args.categoryId);
    await writeAudit(ctx, {
      actorId: userId,
      action: "category.delete",
      targetId: args.categoryId,
      meta: JSON.stringify({ name: category.name }),
    });
    return null;
  },
});
