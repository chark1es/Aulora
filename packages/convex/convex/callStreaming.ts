import { hasPermission, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { assertClientId, findParticipant, heldByOtherDevice, loadVoicePolicy } from "./lib/calls";
import { requireChannelAccess } from "./lib/channels";
import {
  readSfuConfig,
  SFU_CALL_TOKEN_TTL_SECONDS,
  SFU_TOKEN_TTL_SECONDS,
  signSfuToken,
} from "./lib/sfu";

/**
 * Room access for the optional streaming server. Everything about who may join
 * is decided here from the call roster; the media server only checks the
 * signature. See `lib/sfu.ts` for what each grant allows.
 */

/** Media the call transport may publish in this call, or an error when the caller is not in it. */
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
    // The mesh does not gate audio on `Speak` (anyone in the call may send it),
    // so the SFU grant matches that: `Connect` got them into the call. The
    // camera stays gated on `UseVideo`, which `calls.updateParticipant` also
    // enforces for the roster flag.
    const callPublishSources: string[] = [];
    if (policy.enabled) {
      callPublishSources.push("microphone");
      if (policy.videoEnabled && hasPermission(permissions, Permission.UseVideo)) {
        callPublishSources.push("camera");
      }
    }
    return {
      userId,
      canPublish: policy.screenShareEnabled && hasPermission(permissions, Permission.Stream),
      callPublishSources,
    };
  },
});

/**
 * Returns the URL and a short-lived token for this call's streaming room, or
 * `null` when the workspace has no streaming server configured, in which case
 * the client keeps sending shares (and, for a large call, audio and camera)
 * over the peer mesh.
 *
 * `scope: "screen"` (the default) grants screen-share publishing only.
 * `scope: "call"` grants the microphone and camera in a separate room, with a
 * longer token that the client re-mints before it expires.
 */
export const access = action({
  args: {
    callId: v.id("calls"),
    clientId: v.string(),
    scope: v.optional(v.union(v.literal("screen"), v.literal("call"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    token: string;
    canPublish: boolean;
    canPublishSources?: string[];
    expiresAt: number;
  } | null> => {
    const config = readSfuConfig(process.env);
    if (config === null) {
      return null;
    }
    const scope = args.scope ?? "screen";
    const granted = await ctx.runQuery(internal.callStreaming.grant, {
      callId: args.callId,
      clientId: args.clientId,
    });
    const canPublish =
      scope === "call" ? granted.callPublishSources.length > 0 : granted.canPublish;
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = scope === "call" ? SFU_CALL_TOKEN_TTL_SECONDS : SFU_TOKEN_TTL_SECONDS;
    const token = await signSfuToken({
      config,
      callId: args.callId,
      identity: granted.userId,
      canPublish,
      scope,
      now,
      ...(scope === "call" ? { canPublishSources: granted.callPublishSources, ttlSeconds } : {}),
    });
    return {
      url: config.url,
      token,
      canPublish,
      // Older clients ignore the extra fields; the screen grant keeps its shape.
      ...(scope === "call" ? { canPublishSources: granted.callPublishSources } : {}),
      expiresAt: now + ttlSeconds,
    };
  },
});
