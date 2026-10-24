/**
 * Incoming-webhook management for the web admin UI (Workspace settings ->
 * Webhooks). A webhook is a secret URL that posts plain-text messages into one
 * channel as its own author. The posting endpoint is in `webhookHttp.ts`.
 *
 * Every mutation needs `ManageWebhooks` in the webhook's channel, so channel
 * overrides and private-channel membership apply. Only a hash of the secret is
 * stored; the secret itself is returned once, by `create` and `rotateToken`.
 */
import { Permission, WEBHOOK_LIMITS, WEBHOOK_USER_ID_PREFIX } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { requireChannelAccess, requireChannelAccessFromContext } from "./lib/channels";
import { requireMember, requireWorkspaceContext } from "./lib/permissions";
import { generateWebhookToken, hashWebhookToken, webhookTokenLast4 } from "./lib/webhookAuth";

type WebhookDoc = Doc<"webhooks">;

export interface WebhookSummary {
  readonly id: Id<"webhooks">;
  /** `webhook_<id>`: the `authorId` on the messages it posts. */
  readonly userId: string;
  readonly channelId: Id<"channels">;
  readonly name: string;
  readonly tokenLast4: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
}

function toSummary(webhook: WebhookDoc): WebhookSummary {
  return {
    id: webhook._id,
    userId: webhook.userId,
    channelId: webhook.channelId,
    name: webhook.name,
    tokenLast4: webhook.tokenLast4 ?? null,
    createdBy: webhook.createdBy,
    createdAt: webhook.createdAt,
    lastUsedAt: webhook.lastUsedAt ?? null,
  };
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > WEBHOOK_LIMITS.maxNameLength) {
    throw new ConvexError(`Webhook names must be 1 to ${WEBHOOK_LIMITS.maxNameLength} characters`);
  }
  return name;
}

/** Webhooks post into text and announcement channels, never DMs or voice. */
async function assertPostable(ctx: MutationCtx, channelId: Id<"channels">) {
  const channel = await ctx.db.get(channelId);
  if (channel === null) {
    throw new ConvexError("Channel not found");
  }
  if (channel.kind !== "text" && channel.kind !== "announcement") {
    throw new ConvexError("Webhooks can only post to text and announcement channels");
  }
  if (channel.archived) {
    throw new ConvexError("This channel is archived");
  }
}

async function activeInChannel(ctx: MutationCtx, channelId: Id<"channels">): Promise<WebhookDoc[]> {
  const rows = await ctx.db
    .query("webhooks")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();
  return rows.filter((row) => row.deletedAt === undefined);
}

async function assertRoomInChannel(ctx: MutationCtx, channelId: Id<"channels">) {
  if ((await activeInChannel(ctx, channelId)).length >= WEBHOOK_LIMITS.maxPerChannel) {
    throw new ConvexError(`A channel may have at most ${WEBHOOK_LIMITS.maxPerChannel} webhooks`);
  }
}

/** The webhook, once the caller is known to manage it. Deleted ones count as missing. */
async function requireManageable(
  ctx: MutationCtx,
  webhookId: Id<"webhooks">,
): Promise<{ webhook: WebhookDoc; userId: string }> {
  const webhook = await ctx.db.get(webhookId);
  if (webhook === null || webhook.deletedAt !== undefined) {
    throw new ConvexError("Webhook not found");
  }
  const access = await requireChannelAccess(ctx, webhook.channelId, Permission.ManageWebhooks);
  return { webhook, userId: access.userId };
}

/**
 * Webhooks the viewer can manage, newest first. Needs `ManageWebhooks`
 * workspace-wide to open the page; webhooks in channels the viewer cannot
 * manage (channel overrides, private channels) are left out.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<WebhookSummary[]> => {
    const { context } = await requireWorkspaceContext(ctx, Permission.ManageWebhooks);
    const rows = await ctx.db.query("webhooks").collect();
    const visible: WebhookDoc[] = [];
    for (const row of rows) {
      if (row.deletedAt !== undefined) {
        continue;
      }
      try {
        await requireChannelAccessFromContext(
          ctx,
          context,
          row.channelId,
          Permission.ManageWebhooks,
        );
        visible.push(row);
      } catch {
        // Not manageable from here; the page simply does not list it.
      }
    }
    visible.sort((left, right) => right.createdAt - left.createdAt);
    return visible.map(toSummary);
  },
});

/**
 * Names for every webhook that ever posted, deleted ones included, so the
 * timeline can label their messages. Names are not secret; any member may read.
 */
export const identities = query({
  args: {},
  handler: async (ctx): Promise<{ userId: string; name: string }[]> => {
    const { userId } = await requireAuth(ctx);
    await requireMember(ctx, userId);
    const rows = await ctx.db.query("webhooks").collect();
    return rows.map((row) => ({ userId: row.userId, name: row.name }));
  },
});

export const create = mutation({
  args: { channelId: v.id("channels"), name: v.string() },
  handler: async (ctx, args): Promise<{ webhookId: Id<"webhooks">; token: string }> => {
    const { userId } = await requireChannelAccess(ctx, args.channelId, Permission.ManageWebhooks);
    const name = validateName(args.name);
    await assertPostable(ctx, args.channelId);
    await assertRoomInChannel(ctx, args.channelId);
    const token = generateWebhookToken();
    const webhookId = await ctx.db.insert("webhooks", {
      // Patched to `webhook_<id>` right after insert; the id is not known before.
      userId: `${WEBHOOK_USER_ID_PREFIX}pending`,
      channelId: args.channelId,
      name,
      tokenHash: await hashWebhookToken(token),
      tokenLast4: webhookTokenLast4(token),
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(webhookId, { userId: `${WEBHOOK_USER_ID_PREFIX}${webhookId}` });
    await writeAudit(ctx, {
      actorId: userId,
      action: "webhook.create",
      targetId: webhookId,
      meta: JSON.stringify({ name, channelId: args.channelId }),
    });
    return { webhookId, token };
  },
});

/** Renames a webhook and/or moves it to another channel (needs the permission in both). */
export const update = mutation({
  args: {
    webhookId: v.id("webhooks"),
    name: v.optional(v.string()),
    channelId: v.optional(v.id("channels")),
  },
  handler: async (ctx, args): Promise<null> => {
    const { webhook, userId } = await requireManageable(ctx, args.webhookId);
    const patch: Partial<Pick<WebhookDoc, "name" | "channelId">> = {};
    const changed: string[] = [];
    if (args.name !== undefined) {
      const name = validateName(args.name);
      if (name !== webhook.name) {
        patch.name = name;
        changed.push("name");
      }
    }
    if (args.channelId !== undefined && args.channelId !== webhook.channelId) {
      await requireChannelAccess(ctx, args.channelId, Permission.ManageWebhooks);
      await assertPostable(ctx, args.channelId);
      await assertRoomInChannel(ctx, args.channelId);
      patch.channelId = args.channelId;
      changed.push("channel");
    }
    if (changed.length === 0) {
      return null;
    }
    await ctx.db.patch(webhook._id, patch);
    await writeAudit(ctx, {
      actorId: userId,
      action: "webhook.update",
      targetId: webhook._id,
      meta: JSON.stringify({ changed }),
    });
    return null;
  },
});

/** Replaces the secret, which cuts off whatever used the old URL. Returned once. */
export const rotateToken = mutation({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const { webhook, userId } = await requireManageable(ctx, args.webhookId);
    const token = generateWebhookToken();
    await ctx.db.patch(webhook._id, {
      tokenHash: await hashWebhookToken(token),
      tokenLast4: webhookTokenLast4(token),
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "webhook.token.rotate",
      targetId: webhook._id,
    });
    return { token };
  },
});

/** Deletes a webhook. The secret is destroyed; its past messages keep their author name. */
export const remove = mutation({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, args): Promise<null> => {
    const { webhook, userId } = await requireManageable(ctx, args.webhookId);
    await ctx.db.patch(webhook._id, {
      deletedAt: Date.now(),
      tokenHash: undefined,
      tokenLast4: undefined,
    });
    await writeAudit(ctx, {
      actorId: userId,
      action: "webhook.delete",
      targetId: webhook._id,
      meta: JSON.stringify({ name: webhook.name }),
    });
    return null;
  },
});
