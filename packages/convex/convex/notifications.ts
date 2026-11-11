import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { broadcastJoinedAt, mentionsViewer } from "./lib/broadcastMentions";
import { requireChannelAccess } from "./lib/channels";
import { settleInChunks } from "./lib/concurrency";
import {
  resolveBroadcastRecipients,
  resolveMessageRecipients,
  resolvePref,
} from "./lib/messageRecipients";
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
      suppressMassMentions: row.suppressMassMentions ?? null,
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
      const serverPref = await ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_scope", (q) => q.eq("userId", userId).eq("scope", "server"))
        .first();
      await ctx.db.insert("notificationPrefs", {
        userId,
        scope: "channel",
        channelId: args.channelId,
        level: serverPref?.level ?? "all",
        ...(serverPref?.muteUntil !== undefined ? { muteUntil: serverPref.muteUntil } : {}),
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
    level: v.optional(levelValidator),
    muteUntil: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
    suppressMassMentions: v.optional(v.boolean()),
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
      ...(args.level !== undefined ? { level: args.level } : {}),
      ...(args.muteUntil !== undefined ? { muteUntil: args.muteUntil } : {}),
      ...(args.hidden !== undefined ? { hidden: args.hidden } : {}),
      ...(args.suppressMassMentions !== undefined
        ? { suppressMassMentions: args.suppressMassMentions }
        : {}),
    };
    if (existing === undefined) {
      await ctx.db.insert("notificationPrefs", {
        userId,
        scope: args.scope,
        level: args.level ?? rows.find((row) => row.scope === "server")?.level ?? "all",
        ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
        ...(args.muteUntil !== undefined ? { muteUntil: args.muteUntil } : {}),
        ...(args.hidden !== undefined ? { hidden: args.hidden } : {}),
        ...(args.suppressMassMentions !== undefined
          ? { suppressMassMentions: args.suppressMassMentions }
          : {}),
      });
    } else {
      await ctx.db.patch(existing._id, patch);
    }
    return null;
  },
});

/**
 * Unread messages read per channel before the count saturates. The badge shows
 * "99+" anyway, so a bounded tail keeps the query cost proportional to the
 * limit rather than to the full channel history.
 */
const UNREAD_SCAN_LIMIT = 100;
/** Tail pages examined before a channel is treated as having no unread mail. */
const UNREAD_SCAN_PAGES = 2;
/** Extra tail pages shared by the whole call, so a pathological run of the
 * viewer's own messages cannot push the query past Convex's read limit. */
const UNREAD_EXTRA_PAGE_BUDGET = 20;
/** Channels examined per call; keeps the aggregate read/byte budget bounded. */
const UNREAD_CHANNEL_LIMIT = 200;

/**
 * Live unread + mention totals for the caller across their joined channels.
 * Drives the desktop Dock/taskbar badge and `navigator.setAppBadge`.
 *
 * Compatibility: installed clients still call this, so it keeps its shape and
 * semantics. Clients that already hold `readStates.summary` (the sidebar) sum
 * its `unreadCount` instead, so one message insert no longer re-scans every
 * channel tail twice per client.
 *
 * Each channel's tail is read as an index range starting *after* the viewer's
 * read cursor (`by_channel_created` with `.gt("_creationTime", cursorTime)`)
 * and truncated at {@link UNREAD_SCAN_LIMIT}, saturating the count instead of
 * collecting the entire channel history.
 */
export const unreadSummary = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const memberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(UNREAD_CHANNEL_LIMIT);

    let total = 0;
    let mentions = 0;
    let extraPages = UNREAD_EXTRA_PAGE_BUDGET;
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
      // Resolve the cursor message's timestamp so the tail is an index range
      // rather than a whole-channel collect. A cursor that no longer resolves
      // in this channel (stale id) reads as fully read, matching the previous
      // positional `findIndex === -1` behaviour.
      let after: number | null = null;
      if (state?.lastReadMessageId !== undefined) {
        const cursor = await ctx.db.get(state.lastReadMessageId);
        if (cursor === null || cursor.channelId !== membership.channelId) {
          continue;
        }
        after = cursor._creationTime;
      }
      // Scan the tail in bounded pages until a message from someone else is
      // found. A run of the viewer's own messages at the cursor must not hide
      // older unread messages from other people.
      const joinedAt = await broadcastJoinedAt(ctx, userId, membership.channelId);
      let lower = after;
      let channelUnread = 0;
      let channelMentions = 0;
      for (let pageIndex = 0; pageIndex < UNREAD_SCAN_PAGES; pageIndex += 1) {
        if (pageIndex > 0) {
          if (extraPages <= 0) {
            break;
          }
          extraPages -= 1;
        }
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_channel_created", (q) => {
            const base = q.eq("channelId", membership.channelId);
            return lower === null ? base : base.gt("_creationTime", lower);
          })
          .take(UNREAD_SCAN_LIMIT);
        for (const message of messages) {
          if (
            message.deletedAt !== undefined ||
            message.threadRootId !== undefined ||
            message.authorId === userId ||
            message.systemKind !== undefined
          ) {
            continue;
          }
          channelUnread = Math.min(channelUnread + 1, UNREAD_SCAN_LIMIT);
          if (mentionsViewer(message, userId, joinedAt)) {
            channelMentions = Math.min(channelMentions + 1, UNREAD_SCAN_LIMIT);
          }
        }
        const last = messages.at(-1);
        if (
          last === undefined ||
          messages.length < UNREAD_SCAN_LIMIT ||
          (channelUnread >= UNREAD_SCAN_LIMIT && channelMentions >= UNREAD_SCAN_LIMIT)
        ) {
          break;
        }
        lower = last._creationTime;
      }
      total += channelUnread;
      mentions += channelMentions;
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
    return await resolveMessageRecipients(ctx, message);
  },
});

/** Cursor-only continuation: scheduler payload size is independent of audience size. */
export const recipientPage = internalQuery({
  args: { messageId: v.id("messages"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      message === null ||
      message.deletedAt !== undefined ||
      Date.now() - message._creationTime >= DELIVERY_REPLAY_WINDOW_MS
    )
      return { recipients: [], cursor: null };
    if (message.mentionEveryone || message.mentionHere) {
      return {
        ...(await resolveBroadcastRecipients(ctx, message, args.cursor ?? null)),
        broadcast: true,
      };
    }
    return { recipients: await resolveMessageRecipients(ctx, message), cursor: null };
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
    if (call === null || call.ringingUserIds.length === 0 || call.channelId === undefined) {
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
  readonly failed?: boolean;
  readonly skipped?: "unconfigured" | "no-message" | "noop";
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
          kind: "call",
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
 * Sends content-free Web Push wakes for one message and hands the resolved
 * recipients to the mobile relay, so recipient resolution runs once per
 * message. Scheduled by `messages.send`; no-ops when neither transport is
 * configured, so a deployment without push never fails on send.
 */
export const DELIVERY_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DELIVERY_MAX_ATTEMPTS = 12;

export const DELIVERY_LEASE_MS = 5 * 60_000;

export const claimDelivery = internalMutation({
  args: {
    messageId: v.id("messages"),
    cursor: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    recoveryCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      message === null ||
      message.deletedAt !== undefined ||
      Date.now() - message._creationTime >= DELIVERY_REPLAY_WINDOW_MS
    )
      return false;
    const cursor = args.cursor ?? "";
    const existing = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_message_cursor", (q) => q.eq("messageId", args.messageId).eq("cursor", cursor))
      .unique();
    if (
      existing?.completed ||
      (existing?.attempts ?? 0) >= DELIVERY_MAX_ATTEMPTS ||
      (existing?.leaseUntil !== undefined && existing.leaseUntil > Date.now())
    )
      return false;
    const lease = {
      attempts: Math.min(DELIVERY_MAX_ATTEMPTS, (existing?.attempts ?? 0) + 1),
      leaseUntil: Date.now() + DELIVERY_LEASE_MS,
      retryAt: Date.now() + DELIVERY_LEASE_MS,
      ...(args.leaseToken !== undefined ? { leaseToken: args.leaseToken } : {}),
      ...(args.recoveryCursor !== undefined ? { recoveryCursor: args.recoveryCursor } : {}),
    };
    if (existing === null)
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId: args.messageId,
        cursor,
        ...lease,
      });
    else await ctx.db.patch(existing._id, lease);
    return true;
  },
});

export const deliveryCompleted = internalQuery({
  args: { messageId: v.id("messages"), cursor: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_message_cursor", (q) =>
        q.eq("messageId", args.messageId).eq("cursor", args.cursor),
      )
      .unique();
    return row?.completed === true;
  },
});

export const completeDelivery = internalMutation({
  args: { messageId: v.id("messages"), cursor: v.optional(v.string()), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_message_cursor", (q) =>
        q.eq("messageId", args.messageId).eq("cursor", args.cursor ?? ""),
      )
      .unique();
    if (row?.leaseToken !== args.leaseToken) return;
    await ctx.db.patch(row._id, { completed: true, leaseUntil: undefined });
  },
});

/** Legacy claims without a lease are recoverable too; each tick does bounded work. */
export const recoverDeliveryLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_lease", (q) =>
        q.eq("completed", undefined).gt("retryAt", 0).lte("retryAt", Date.now()),
      )
      .take(100);
    const legacy = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_lease", (q) => q.eq("completed", undefined).eq("retryAt", undefined))
      .take(100);
    for (const row of [...rows, ...legacy]) {
      if (row.completed) continue;
      const message = await ctx.db.get(row.messageId);
      if (
        (row.attempts ?? 0) >= DELIVERY_MAX_ATTEMPTS ||
        message === null ||
        message.deletedAt !== undefined ||
        Date.now() - message._creationTime >= DELIVERY_REPLAY_WINDOW_MS
      ) {
        await ctx.db.patch(row._id, { completed: true, leaseUntil: undefined });
        continue;
      }
      const cursor = row.recoveryCursor ?? row.cursor;
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, {
        messageId: row.messageId,
        ...(cursor ? { cursor } : {}),
      });
      // Move legacy rows out of the undefined window without blocking recovery.
      await ctx.db.patch(row._id, { retryAt: Date.now() + DELIVERY_LEASE_MS });
    }
  },
});

/** Bounded sweep; age rejection in claimDelivery prevents expired replay. */
export const pruneDeliveryClaims = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("notificationDeliveryClaims")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - DELIVERY_REPLAY_WINDOW_MS),
      )
      .take(500);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === 500)
      await ctx.scheduler.runAfter(0, internal.notifications.pruneDeliveryClaims, {});
    return expired.length;
  },
});

export const dispatchForMessage = internalAction({
  args: { messageId: v.id("messages"), cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DispatchResult> => {
    const vapid: VapidConfig | null = vapidConfigFromEnv();
    const relay: PushRelayConfig | null = pushRelayConfigFromEnv();
    // Neither transport configured: skip the recipient read entirely.
    if (vapid === null && relay === null) {
      return { sent: 0, skipped: "unconfigured" };
    }
    const page = await ctx.runQuery(internal.notifications.recipientPage, args);
    const broadcast = "broadcast" in page && page.broadcast === true;
    if (!broadcast) {
      const web = async () => {
        if (vapid === null) return 0;
        const subscriptions = await ctx.runQuery(internal.notifications.deviceSubscriptions, {
          userIds: page.recipients,
        });
        const results = await settleInChunks(subscriptions, 10, async ({ subscription }) =>
          sendWebPush(subscription, vapid),
        );
        return results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
      };
      const mobile = async () =>
        relay === null
          ? 0
          : (
              await ctx.runAction(internal.notifications.dispatchMobileForMessage, {
                messageId: args.messageId,
                recipients: page.recipients,
              })
            ).sent;
      const results = await Promise.allSettled([web(), mobile()]);
      return { sent: results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0) };
    }
    const leaseToken = crypto.randomUUID();
    if (!(await ctx.runMutation(internal.notifications.claimDelivery, { ...args, leaseToken })))
      return { sent: 0 };
    // Schedule the continuation before delivery. A crash is recovered by the lease sweep.
    if (page.cursor !== null)
      await ctx.scheduler.runAfter(0, internal.notifications.dispatchForMessage, {
        messageId: args.messageId,
        cursor: page.cursor,
      });
    const results = await settleInChunks(page.recipients, 10, async (userId: string) => {
      const receipt = { messageId: args.messageId, cursor: `recipient:${userId}`, leaseToken };
      if (
        !(await ctx.runMutation(internal.notifications.claimDelivery, {
          ...receipt,
          recoveryCursor: args.cursor ?? "",
        }))
      ) {
        // A completed receipt is safe to skip; an in-flight lease must leave the page retryable.
        return {
          sent: 0,
          complete: await ctx.runQuery(internal.notifications.deliveryCompleted, {
            messageId: receipt.messageId,
            cursor: receipt.cursor,
          }),
        };
      }
      let sent = 0;
      let complete = true;
      if (vapid !== null) {
        const subscriptions = await ctx.runQuery(internal.notifications.deviceSubscriptions, {
          userIds: [userId],
        });
        for (const { subscription } of subscriptions) {
          try {
            const result = await sendWebPush(subscription, vapid);
            if (result.ok) sent++;
            else if (!result.gone) complete = false;
          } catch {
            complete = false;
          }
        }
      }
      if (relay !== null) {
        const result = await ctx.runAction(internal.notifications.dispatchMobileForMessage, {
          messageId: args.messageId,
          recipients: [userId],
        });
        sent += result.sent;
        if (result.failed) complete = false;
      }
      if (complete) await ctx.runMutation(internal.notifications.completeDelivery, receipt);
      return { sent, complete };
    });
    if (results.every((r) => r.status === "fulfilled" && r.value.complete))
      await ctx.runMutation(internal.notifications.completeDelivery, { ...args, leaseToken });
    return {
      sent: results.reduce((total, r) => total + (r.status === "fulfilled" ? r.value.sent : 0), 0),
    };
  },
});

/**
 * Legacy no-op retained for old clients. Sends already schedule internal delivery.
 */
export const dispatchNow = action({
  args: { messageId: v.id("messages") },
  handler: (): Promise<DispatchResult> => Promise.resolve({ sent: 0, skipped: "noop" }),
});

// "mobile" is accepted as a defensive alias for a client that mis-tags its
// platform; the concrete `ios`/`android` tags remain the intended values.
// greenlight:ignore platform-reference
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
 * dispatch by `messages.send`; when invoked from {@link dispatchForMessage} the
 * already-resolved `recipients` are passed in so resolution runs only once.
 */
export const dispatchMobileForMessage = internalAction({
  args: { messageId: v.id("messages"), recipients: v.optional(v.array(v.string())) },
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
    const recipients =
      args.recipients ??
      (await ctx.runQuery(internal.notifications.resolveRecipients, {
        messageId: args.messageId,
      }));
    if (recipients.length === 0) {
      return { sent: 0, skipped: "no-message" };
    }
    const targets = await ctx.runQuery(internal.notifications.mobilePushTargets, {
      userIds: recipients,
    });
    const results = await settleInChunks(
      targets,
      10,
      async (target) =>
        await sendWake(
          {
            kind: "message",
            serverId: config.serverId,
            channelId,
            messageId: args.messageId,
            platform: target.platform,
            token: target.token,
          },
          config,
        ),
    );
    const sent = results.filter(
      (result) => result.status === "fulfilled" && result.value.ok,
    ).length;
    return {
      sent,
      ...(results.some(
        (r) =>
          r.status === "rejected" ||
          (!r.value.ok && r.value.status !== 404 && r.value.status !== 410),
      )
        ? { failed: true }
        : {}),
    };
  },
});
