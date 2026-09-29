import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalQuery, mutation, query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { requireChannelAccess } from "./lib/channels";
import { requireMember } from "./lib/permissions";
import {
  type MobilePlatform,
  type MobilePushTarget,
  type PushRelayConfig,
  pushRelayConfigFromEnv,
  sendWake,
} from "./lib/pushRelay";
import {
  parseSubscription,
  sendWebPush,
  type VapidConfig,
  vapidConfigFromEnv,
  type WebPushSubscription,
} from "./lib/webPush";

/**
 * Notification delivery.
 *
 * Notifications are resolved on the server from plaintext metadata only
 * (channel membership, `mentionUserIds`, read cursors and preferences). Message
 * text never reaches this module. Recipients get a content-free Web Push wake
 * that a service worker turns into a device-computed notification.
 */

const scopeValidator = v.union(v.literal("server"), v.literal("channel"));
const levelValidator = v.union(v.literal("all"), v.literal("mentions"), v.literal("nothing"));

type NotificationLevel = "all" | "mentions" | "nothing";

/** A recipient whose presence heartbeat is younger than this is treated as
 * actively using Aulora, so it is skipped (the plan's "skips anyone active"). */
const ACTIVE_PRESENCE_MS = 60_000;

interface ResolvedPref {
  readonly level: NotificationLevel;
  readonly muteUntil: number | undefined;
}

/**
 * Channel prefs win over server prefs; absent both, the default is "all". A
 * `muteUntil` in the future suppresses delivery regardless of level.
 */
async function resolvePref(
  ctx: Parameters<typeof requireChannelAccess>[0],
  userId: string,
  channelId: Id<"channels">,
): Promise<ResolvedPref> {
  const rows = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect();
  const channelPref = rows.find((row) => row.scope === "channel" && row.channelId === channelId);
  const serverPref = rows.find((row) => row.scope === "server");
  const chosen = channelPref ?? serverPref;
  return {
    level: chosen?.level ?? "all",
    muteUntil: chosen?.muteUntil,
  };
}

/** All of the caller's notification preferences. */
export const getPrefs = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const now = Date.now();
    const rows = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user_scope", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => ({
      scope: row.scope,
      channelId: row.channelId ?? null,
      level: row.level,
      hidden: row.hidden === true,
      muted: row.level === "nothing" || (row.muteUntil !== undefined && row.muteUntil > now),
      muteUntil: row.muteUntil ?? null,
    }));
  },
});

/** Looks up one channel-scoped preference row for a viewer. */
async function findChannelPref(
  ctx: Parameters<typeof requireChannelAccess>[0],
  userId: string,
  channelId: Id<"channels">,
) {
  return await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
    .unique();
}

/** Hides or shows a channel for the caller only. Requires `ViewChannel`. */
export const setChannelHidden = mutation({
  args: { channelId: v.id("channels"), hidden: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const existing = await findChannelPref(ctx, userId, args.channelId);
    if (existing === null) {
      await ctx.db.insert("notificationPrefs", {
        userId,
        scope: "channel",
        channelId: args.channelId,
        level: "all",
        hidden: args.hidden,
      });
    } else {
      await ctx.db.patch(existing._id, { hidden: args.hidden });
    }
    return null;
  },
});

/** Roughly one century; the sentinel that makes `muted` outlive the session. */
const MUTE_FAR_FUTURE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Mutes or unmutes a channel for the caller. Muting stores `level:"nothing"`
 * with a far-future `muteUntil`; unmuting restores `level:"all"`.
 */
export const setChannelMuted = mutation({
  args: { channelId: v.id("channels"), muted: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    const existing = await findChannelPref(ctx, userId, args.channelId);
    const level = args.muted ? ("nothing" as const) : ("all" as const);
    const muteUntil = args.muted ? Date.now() + MUTE_FAR_FUTURE_MS : undefined;
    if (existing === null) {
      await ctx.db.insert("notificationPrefs", {
        userId,
        scope: "channel",
        channelId: args.channelId,
        level,
        ...(muteUntil !== undefined ? { muteUntil } : {}),
      });
    } else {
      await ctx.db.patch(existing._id, { level, muteUntil });
    }
    return null;
  },
});

/**
 * Upserts one preference row. A channel-scoped preference requires
 * `ViewChannel` on that channel.
 */
export const setPref = mutation({
  args: {
    scope: scopeValidator,
    channelId: v.optional(v.id("channels")),
    level: levelValidator,
    muteUntil: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    if (args.scope === "channel") {
      if (args.channelId === undefined) {
        throw new ConvexError("Channel scope requires a channelId");
      }
      await requireChannelAccess(ctx, args.channelId, Permission.ViewChannel);
    } else if (args.channelId !== undefined) {
      throw new ConvexError("Server scope must not set a channelId");
    }

    const rows = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user_scope", (q) => q.eq("userId", userId))
      .collect();
    const existing = rows.find((row) =>
      args.scope === "server"
        ? row.scope === "server"
        : row.scope === "channel" && row.channelId === args.channelId,
    );
    const patch = {
      level: args.level,
      ...(args.muteUntil !== undefined ? { muteUntil: args.muteUntil } : {}),
      ...(args.hidden !== undefined ? { hidden: args.hidden } : {}),
    };
    if (existing === undefined) {
      await ctx.db.insert("notificationPrefs", {
        userId,
        scope: args.scope,
        level: args.level,
        ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
        ...(args.muteUntil !== undefined ? { muteUntil: args.muteUntil } : {}),
        ...(args.hidden !== undefined ? { hidden: args.hidden } : {}),
      });
    } else {
      await ctx.db.patch(existing._id, patch);
    }
    return null;
  },
});

/**
 * Live unread + mention totals for the caller across their joined channels.
 * Drives the desktop Dock/taskbar badge and `navigator.setAppBadge`.
 */
export const unreadSummary = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const memberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    let total = 0;
    let mentions = 0;
    for (const membership of memberships) {
      const channel = await ctx.db.get(membership.channelId);
      if (channel === null || channel.archived) {
        continue;
      }
      const state = await ctx.db
        .query("readStates")
        .withIndex("by_user_channel", (q) =>
          q.eq("userId", userId).eq("channelId", membership.channelId),
        )
        .unique();
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_channel_created", (q) => q.eq("channelId", membership.channelId))
        .collect();
      let start = 0;
      if (state?.lastReadMessageId !== undefined) {
        const index = messages.findIndex((message) => message._id === state.lastReadMessageId);
        start = index === -1 ? messages.length : index + 1;
      }
      for (const message of messages.slice(start)) {
        if (message.deletedAt !== undefined || message.authorId === userId) {
          continue;
        }
        total += 1;
        if (message.mentionUserIds.includes(userId)) {
          mentions += 1;
        }
      }
    }
    return { total, mentions };
  },
});

/**
 * Resolves the users who should be woken for a message: members of the
 * message's channel, plus members of any `#channel` mentioned and of every
 * channel in a mentioned category. Excludes the author, applies per-user
 * preferences (mention-gated when set) and skips anyone currently active.
 */
export const resolveRecipients = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message === null) {
      return [];
    }
    const channelId = message.channelId;
    const now = Date.now();

    // Candidate recipients keyed by user id. The value records which channel's
    // preference governs the wake (the message's channel for direct members,
    // the mentioned channel/category's channel otherwise) and whether the user
    // was explicitly mentioned.
    const candidates = new Map<string, { channelId: Id<"channels">; mentioned: boolean }>();
    const addCandidate = (
      userId: string,
      prefChannelId: Id<"channels">,
      mentioned: boolean,
    ): void => {
      const existing = candidates.get(userId);
      if (existing === undefined) {
        candidates.set(userId, { channelId: prefChannelId, mentioned });
        return;
      }
      // A later mention upgrades a plain member to mentioned.
      existing.mentioned = existing.mentioned || mentioned;
    };

    const members = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    for (const member of members) {
      addCandidate(member.userId, channelId, message.mentionUserIds.includes(member.userId));
    }

    // `#channel` mentions notify that channel's members too, even when they are
    // not members of the message's own channel.
    for (const mentioned of new Set(message.mentionChannelIds ?? [])) {
      let mentionedChannelId: Id<"channels">;
      try {
        mentionedChannelId = mentioned as Id<"channels">;
        if ((await ctx.db.get(mentionedChannelId)) === null) {
          continue;
        }
      } catch {
        continue;
      }
      const rows = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", mentionedChannelId))
        .collect();
      for (const row of rows) {
        addCandidate(row.userId, mentionedChannelId, true);
      }
    }

    // Category mentions notify members of every channel in those categories.
    const categoryIds = new Set(message.mentionCategoryIds ?? []);
    if (categoryIds.size > 0) {
      const allChannels = await ctx.db.query("channels").collect();
      for (const channel of allChannels) {
        if (channel.categoryId === undefined || !categoryIds.has(channel.categoryId)) {
          continue;
        }
        const rows = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect();
        for (const row of rows) {
          addCandidate(row.userId, channel._id, true);
        }
      }
    }

    const presenceRows = await ctx.db.query("presence").collect();
    const presenceByUser = new Map<string, Doc<"presence">>();
    for (const row of presenceRows) {
      presenceByUser.set(row.userId, row);
    }

    const recipients: string[] = [];
    for (const [userId, info] of candidates) {
      if (userId === message.authorId) {
        continue;
      }
      const pref = await resolvePref(ctx, userId, info.channelId);
      if (pref.level === "nothing") {
        continue;
      }
      if (pref.muteUntil !== undefined && pref.muteUntil > now) {
        continue;
      }
      if (pref.level === "mentions" && !info.mentioned) {
        continue;
      }
      const presence = presenceByUser.get(userId);
      if (
        presence !== undefined &&
        presence.status !== "offline" &&
        now - presence.lastHeartbeat < ACTIVE_PRESENCE_MS
      ) {
        continue;
      }
      recipients.push(userId);
    }
    return recipients;
  },
});

interface DeviceSubscription {
  readonly userId: string;
  readonly subscription: WebPushSubscription;
}

/**
 * Web Push subscriptions for the given users. Only parseable subscriptions are
 * returned; APNs/FCM tokens are opaque to this Convex runtime and belong to the
 * Phase 5 push relay.
 */
export const deviceSubscriptions = internalQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const result: DeviceSubscription[] = [];
    for (const userId of args.userIds) {
      const devices = await ctx.db
        .query("devices")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const device of devices) {
        if (device.pushToken === undefined) {
          continue;
        }
        const subscription = parseSubscription(device.pushToken);
        if (subscription !== null) {
          result.push({ userId, subscription });
        }
      }
    }
    return result;
  },
});

/**
 * Ring targets for a call: the users still being rung, minus anyone whose
 * channel/server preference is `nothing` or currently muted. A call counts as
 * mention-level or above, so `mentions` preferences still ring.
 */
export const resolveCallRecipients = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call === null || call.ringingUserIds.length === 0) {
      return [];
    }
    const now = Date.now();
    const recipients: string[] = [];
    for (const userId of call.ringingUserIds) {
      const pref = await resolvePref(ctx, userId, call.channelId);
      if (pref.level === "nothing") {
        continue;
      }
      if (pref.muteUntil !== undefined && pref.muteUntil > now) {
        continue;
      }
      recipients.push(userId);
    }
    return recipients;
  },
});

export interface DispatchResult {
  readonly sent: number;
  readonly skipped?: "unconfigured" | "no-message";
}

/**
 * Sends content-free Web Push wakes to the users a call is ringing. Scheduled
 * by `calls.start`; no-ops when VAPID is not configured.
 */
export const dispatchCallRinging = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const config: VapidConfig | null = vapidConfigFromEnv();
    if (config === null) {
      return { sent: 0, skipped: "unconfigured" };
    }
    const recipients = await ctx.runQuery(internal.notifications.resolveCallRecipients, {
      callId: args.callId,
    });
    if (recipients.length === 0) {
      return { sent: 0, skipped: "no-message" };
    }
    const subscriptions = await ctx.runQuery(internal.notifications.deviceSubscriptions, {
      userIds: recipients,
    });
    let sent = 0;
    for (const { subscription } of subscriptions) {
      const result = await sendWebPush(subscription, config);
      if (result.ok) {
        sent += 1;
      }
    }
    return { sent };
  },
});

/** The channel a call belongs to, used to label a content-free call wake. */
export const callChannelId = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    return call?.channelId ?? null;
  },
});

/**
 * Routes content-free mobile wakes for an incoming call to the project push
 * relay, mirroring {@link dispatchMobileForMessage}. No-ops when
 * `PUSH_RELAY_URL`/`PUSH_RELAY_TOKEN` are unset. The wake's `messageId` field
 * carries the call id (there is no message), which the app resolves through
 * `calls.incoming`; scheduled alongside Web Push by `calls.start`.
 */
export const dispatchMobileCallRinging = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const config: PushRelayConfig | null = pushRelayConfigFromEnv();
    if (config === null) {
      return { sent: 0, skipped: "unconfigured" };
    }
    const channelId = await ctx.runQuery(internal.notifications.callChannelId, {
      callId: args.callId,
    });
    if (channelId === null) {
      return { sent: 0, skipped: "no-message" };
    }
    const recipients = await ctx.runQuery(internal.notifications.resolveCallRecipients, {
      callId: args.callId,
    });
    if (recipients.length === 0) {
      return { sent: 0, skipped: "no-message" };
    }
    const targets = await ctx.runQuery(internal.notifications.mobilePushTargets, {
      userIds: recipients,
    });
    let sent = 0;
    for (const target of targets) {
      const result = await sendWake(
        {
          serverId: config.serverId,
          channelId,
          messageId: args.callId,
          platform: target.platform,
          token: target.token,
        },
        config,
      );
      if (result.ok) {
        sent += 1;
      }
    }
    return { sent };
  },
});

/**
 * Sends content-free Web Push wakes for one message. Scheduled by
 * `messages.send`; no-ops when VAPID is not configured, so a deployment without
 * web push never fails on send.
 */
export const dispatchForMessage = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const config: VapidConfig | null = vapidConfigFromEnv();
    if (config === null) {
      return { sent: 0, skipped: "unconfigured" };
    }
    const recipients = await ctx.runQuery(internal.notifications.resolveRecipients, {
      messageId: args.messageId,
    });
    if (recipients.length === 0) {
      return { sent: 0, skipped: "no-message" };
    }
    const subscriptions = await ctx.runQuery(internal.notifications.deviceSubscriptions, {
      userIds: recipients,
    });
    let sent = 0;
    for (const { subscription } of subscriptions) {
      const result = await sendWebPush(subscription, config);
      if (result.ok) {
        sent += 1;
      }
    }
    return { sent };
  },
});

/**
 * Manual trigger used by tests and operators: dispatches notifications for an
 * already-stored message without sending it again.
 */
export const dispatchNow = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<DispatchResult> => {
    return await ctx.runAction(internal.notifications.dispatchForMessage, {
      messageId: args.messageId,
    });
  },
});

// "mobile" is accepted as a defensive alias for a client that mis-tags its
// platform; the concrete `ios`/`android` tags remain the intended values.
const MOBILE_PLATFORMS: readonly MobilePlatform[] = ["ios", "android", "unifiedpush", "mobile"];

function isMobilePlatform(value: string): value is MobilePlatform {
  return (MOBILE_PLATFORMS as readonly string[]).includes(value);
}

export interface MobileTargetRow extends MobilePushTarget {
  readonly userId: string;
}

/**
 * Native push targets for the given users: devices whose `pushToken` is a
 * native APNs/FCM token or a UnifiedPush endpoint (not a web Push subscription)
 * on a mobile platform.
 */
export const mobilePushTargets = internalQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const targets: MobileTargetRow[] = [];
    for (const userId of args.userIds) {
      const devices = await ctx.db
        .query("devices")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const device of devices) {
        const token = device.pushToken;
        if (token === undefined || token.length === 0 || !isMobilePlatform(device.platform)) {
          continue;
        }
        // A parseable web Push subscription is handled by `deviceSubscriptions`.
        if (parseSubscription(token) !== null) {
          continue;
        }
        targets.push({ userId, platform: device.platform, token });
      }
    }
    return targets;
  },
});

/** The channel id for a message, used to label a content-free wake. */
export const messageChannelId = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    return message?.channelId ?? null;
  },
});

/**
 * Routes content-free mobile wakes for one message to the project push relay.
 * No-ops when `PUSH_RELAY_URL`/`PUSH_RELAY_TOKEN` are unset, so a deployment
 * without mobile push never fails on send. Scheduled alongside the web push
 * dispatch by `messages.send`.
 */
export const dispatchMobileForMessage = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const config: PushRelayConfig | null = pushRelayConfigFromEnv();
    if (config === null) {
      return { sent: 0, skipped: "unconfigured" };
    }
    const channelId = await ctx.runQuery(internal.notifications.messageChannelId, {
      messageId: args.messageId,
    });
    if (channelId === null) {
      return { sent: 0, skipped: "no-message" };
    }
    const recipients = await ctx.runQuery(internal.notifications.resolveRecipients, {
      messageId: args.messageId,
    });
    if (recipients.length === 0) {
      return { sent: 0, skipped: "no-message" };
    }
    const targets = await ctx.runQuery(internal.notifications.mobilePushTargets, {
      userIds: recipients,
    });
    let sent = 0;
    for (const target of targets) {
      const result = await sendWake(
        {
          serverId: config.serverId,
          channelId,
          messageId: args.messageId,
          platform: target.platform,
          token: target.token,
        },
        config,
      );
      if (result.ok) {
        sent += 1;
      }
    }
    return { sent };
  },
});
