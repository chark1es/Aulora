import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertClientId, findParticipant, heldByOtherDevice, loadVoicePolicy } from "./lib/calls";
import { requireChannelAccess } from "./lib/channels";
import { readSfuConfig, signSfuToken } from "./lib/sfu";

/**
 * Room access for the optional streaming server. Everything about who may join
 * is decided here from the call roster; the media server only checks the
 * signature. See `lib/sfu.ts` for what the token allows.
 */

/** What the caller may do in this call's room, or an error when they are not in it. */
export const grant = internalQuery({
  args: { callId: v.id("calls"), clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status === "ended") {
      throw new ConvexError("This call has ended");
    }
    const { permissions } = await requireChannelAccess(ctx, call.channelId, Permission.Connect);
    const participant = await findParticipant(ctx, call._id, userId);
    if (participant === null || heldByOtherDevice(participant, assertClientId(args.clientId))) {
      throw new ConvexError("You are not in this call");
    }
    const policy = await loadVoicePolicy(ctx);
    return {
      userId,
      canPublish: policy.screenShareEnabled && hasPermission(permissions, Permission.Stream),
    };
  },
});

/**
 * Returns the URL and a short-lived token for this call's streaming room, or
 * `null` when the workspace has no streaming server configured, in which case
 * the client keeps sending shares over the peer mesh.
 */
export const access = action({
  args: { callId: v.id("calls"), clientId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; token: string; canPublish: boolean } | null> => {
    const config = readSfuConfig(process.env);
    if (config === null) {
      return null;
    }
    const granted = await ctx.runQuery(internal.callStreaming.grant, args);
    const token = await signSfuToken({
      config,
      callId: args.callId,
      identity: granted.userId,
      canPublish: granted.canPublish,
    });
    return { url: config.url, token, canPublish: granted.canPublish };
  },
});
