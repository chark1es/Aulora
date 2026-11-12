import { Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAuth } from "./lib/auth";
import { assertMayParticipate } from "./lib/bans";
import { requireWorkspacePermission } from "./lib/permissions";
import {
  loadTranscriptionConfig,
  scheduleStopAllActive,
  transcriberRuntimeReady,
} from "./lib/transcription";

/**
 * Addon flags shared by the Workspace settings → Addons card.
 *
 * Enabling or disabling any addon requires `ManageWorkspace`; every addon is
 * off by default. Each feature module re-checks its own flag on every call.
 */

/** Current addon flags plus the transcription install state. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const server = await ctx.db.query("server").first();
    const config = await loadTranscriptionConfig(ctx);
    return {
      transcription: server?.settings.transcriptionEnabled === true,
      guestCalls: server?.settings.guestCallsEnabled === true,
      scheduledCalls: server?.settings.scheduledCallsEnabled === true,
      transcriptionModel: {
        id: config?.modelId ?? null,
        status: config?.modelStatus ?? "not_installed",
        progress: config?.modelProgress ?? null,
        // True only while the running container actually has an engine.
        runtimeReady: await transcriberRuntimeReady(ctx),
      },
    };
  },
});

/** Turns one addon on or off. Requires `ManageWorkspace`; audited. */
export const setEnabled = mutation({
  args: {
    addon: v.union(
      v.literal("transcription"),
      v.literal("guestCalls"),
      v.literal("scheduledCalls"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    await assertMayParticipate(ctx, userId);
    const server = await ctx.db.query("server").first();
    if (server === null) {
      throw new ConvexError("Workspace is not initialized");
    }
    const settings = { ...server.settings };
    if (args.addon === "transcription") {
      settings.transcriptionEnabled = args.enabled;
    } else if (args.addon === "guestCalls") {
      settings.guestCallsEnabled = args.enabled;
    } else {
      settings.scheduledCallsEnabled = args.enabled;
    }
    await ctx.db.patch(server._id, { settings });
    if (args.addon === "transcription" && !args.enabled) {
      // Disabling the addon must stop audio immediately, not only hide the UI.
      await scheduleStopAllActive(ctx);
    }
    await writeAudit(ctx, {
      actorId: userId,
      action: `addons.${args.addon}.setEnabled`,
      targetId: server._id,
      meta: JSON.stringify({ enabled: args.enabled }),
    });
    return null;
  },
});
