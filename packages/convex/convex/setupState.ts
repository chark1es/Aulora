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
  Permission.ChangeOwnNickname |
  Permission.Connect |
  Permission.Speak |
  Permission.Stream |
  Permission.UseVideo |
  Permission.ViewKanban |
  Permission.EditKanban |
  Permission.CommentKanban;

/** Voice bits added to the `@everyone` baseline after calling shipped. */
const VOICE_EVERYONE_BITS: bigint =
  Permission.Connect | Permission.Speak | Permission.Stream | Permission.UseVideo;

/**
 * Idempotent upgrade for workspaces created before calling existed: the stored
 * `@everyone` role predates the voice permission flags, so existing members
 * would not be able to join a call. Adds the missing bits once; a no-op when
 * they are already present. Returns whether anything changed.
 */
export const ensureVoicePermissions = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const roles = await ctx.db.query("roles").collect();
    const everyone = roles.find((role) => role.key === EVERYONE_ROLE_ID);
    if (everyone === undefined) {
      return false;
    }
    if ((VOICE_EVERYONE_BITS & ~everyone.permissions) === 0n) {
      return false;
    }
    await ctx.db.patch(everyone._id, {
      permissions: everyone.permissions | VOICE_EVERYONE_BITS,
    });
    return true;
  },
});

/** Whether the server singleton has been created. */
export const isInitialized = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return server !== null;
  },
});

/** The workspace access policy consulted by the Better Auth create hooks. */
export const authPolicy = internalQuery({
  args: {},
  handler: async (ctx) => {
    const server = await ctx.db.query("server").first();
    return {
      signupEnabled: server?.settings.signupEnabled ?? true,
      inviteOnly: server?.settings.inviteOnly ?? true,
      allowedEmailDomains: server?.settings.allowedEmailDomains ?? [],
    };
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
        voiceEnabled: true,
        videoEnabled: true,
        screenShareEnabled: true,
        maxCallParticipants: 10,
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
