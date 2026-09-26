import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Baseline permissions granted to `@everyone`. */
const EVERYONE_PERMISSIONS: bigint =
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.SendInThreads |
  Permission.CreateThreads |
  Permission.AttachFiles |
  Permission.EmbedLinks |
  Permission.AddReactions |
  Permission.ReadHistory |
  Permission.ChangeOwnNickname;

/** Whether the server singleton has been created. */
export const isInitialized = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return server !== null;
  },
});

/**
 * Writes the one-time workspace state: the server singleton, the `@everyone`
 * role and the owner member. Refuses to run twice.
 */
export const finalize = internalMutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
  },
  returns: v.object({
    serverId: v.id("server"),
    roleId: v.id("roles"),
    ownerId: v.string(),
  }),
  handler: async (ctx, args) => {
    const existingServer = await ctx.db.query("server").first();
    if (existingServer !== null) {
      throw new ConvexError("Server is already initialized");
    }

    const roleId = await ctx.db.insert("roles", {
      key: EVERYONE_ROLE_ID,
      name: EVERYONE_ROLE_ID,
      position: 0,
      permissions: EVERYONE_PERMISSIONS,
      hoisted: false,
      mentionable: true,
    });

    const serverId = await ctx.db.insert("server", {
      name: args.name,
      iconSeed: `aulora:server:${args.ownerId}`,
      ownerId: args.ownerId,
      settings: {
        signupEnabled: true,
        inviteOnly: true,
        allowedEmailDomains: [],
      },
    });

    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", args.ownerId))
      .unique();
    if (existingMember === null) {
      await ctx.db.insert("members", {
        userId: args.ownerId,
        roleIds: [EVERYONE_ROLE_ID],
        joinedAt: Date.now(),
      });
    } else if (!existingMember.roleIds.includes(EVERYONE_ROLE_ID)) {
      await ctx.db.patch(existingMember._id, {
        roleIds: [...existingMember.roleIds, EVERYONE_ROLE_ID],
      });
    }

    return { serverId, roleId, ownerId: args.ownerId };
  },
});
