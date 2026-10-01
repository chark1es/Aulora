import {
  autoUpdateEnabled,
  loadPublishedRelease,
  planWorkspaceUpdate,
  resolveGitHubRepo,
  resolveManifestUrl,
  updateChannel,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { AULORA_VERSION } from "./lib/env";
import { requireInstanceAdmin } from "./lib/instance";

/**
 * Workspace update check. The running deployment reports whether a newer
 * release is published. Applying it stays on the host (`infra/docker/update.sh`),
 * because this process cannot rebuild its own containers.
 */

const planResult = v.object({
  currentVersion: v.string(),
  sourceVersion: v.string(),
  deployedVersion: v.union(v.string(), v.null()),
  latestVersion: v.union(v.string(), v.null()),
  updateAvailable: v.boolean(),
  apply: v.union(v.literal("none"), v.literal("fast-forward"), v.literal("redeploy")),
  notes: v.union(v.string(), v.null()),
  pubDate: v.union(v.string(), v.null()),
  gitTag: v.union(v.string(), v.null()),
  channel: v.union(v.literal("stable"), v.literal("beta")),
  error: v.union(v.string(), v.null()),
  autoUpdate: v.boolean(),
});

export const assertInstanceAdmin = internalQuery({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const { userId } = await requireInstanceAdmin(ctx);
    return userId;
  },
});

export const check = action({
  args: {},
  returns: planResult,
  handler: async (ctx) => {
    await ctx.runQuery(internal.updates.assertInstanceAdmin, {});
    const channel = updateChannel(process.env.AULORA_UPDATE_CHANNEL);
    const autoUpdate = autoUpdateEnabled(process.env.AULORA_AUTO_UPDATE);
    const manifest = resolveManifestUrl(process.env.AULORA_UPDATE_MANIFEST_URL);
    const repo = resolveGitHubRepo(process.env.AULORA_UPDATE_GITHUB_REPO);
    if ("error" in manifest) {
      return { ...emptyPlan(channel), error: manifest.error, autoUpdate };
    }
    if ("error" in repo) {
      return { ...emptyPlan(channel), error: repo.error, autoUpdate };
    }
    const loaded = await loadPublishedRelease({
      manifestUrl: manifest.url,
      githubRepo: repo.repo,
      channel,
    });
    if (loaded.manifest === undefined && loaded.githubRelease === undefined) {
      const failure = loaded.error ?? "No published release found.";
      return {
        ...emptyPlan(channel),
        error: failure === "No published release found." ? null : failure,
        autoUpdate,
      };
    }
    const plan = planWorkspaceUpdate({
      sourceVersion: AULORA_VERSION,
      channel,
      ...(loaded.manifest !== undefined ? { manifest: loaded.manifest } : {}),
      ...(loaded.githubRelease !== undefined ? { githubRelease: loaded.githubRelease } : {}),
    });
    if (plan.error === "No published release found.") {
      return { ...plan, error: null, autoUpdate };
    }
    return { ...plan, autoUpdate };
  },
});

function emptyPlan(channel: "stable" | "beta") {
  return {
    currentVersion: AULORA_VERSION,
    sourceVersion: AULORA_VERSION,
    deployedVersion: null,
    latestVersion: null,
    updateAvailable: false,
    apply: "none" as const,
    notes: null,
    pubDate: null,
    gitTag: null,
    channel,
    error: null,
  };
}

const phase = v.union(
  v.literal("idle"),
  v.literal("checking"),
  v.literal("downloading"),
  v.literal("ready"),
  v.literal("restarting"),
);
const command = v.union(v.literal("check"), v.literal("download"), v.literal("restart"));
const hostStatus = v.object({
  currentVersion: v.string(),
  latestVersion: v.union(v.string(), v.null()),
  updateAvailable: v.boolean(),
  notes: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  autoUpdate: v.boolean(),
  phase,
  checkedAt: v.number(),
});
const HOST_TIMEOUT = 30_000;

export const version = query({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    return AULORA_VERSION;
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const row = await ctx.db.query("workspaceUpdate").first();
    if (!row) return null;
    const { _id, _creationTime, request: pending, ...result } = row;
    return {
      ...result,
      hostConnected: Date.now() - row.hostSeenAt < HOST_TIMEOUT,
      pending: pending !== undefined,
    };
  },
});

/** Only the owner can queue a fixed operation; callers cannot supply commands or release URLs. */
export const request = mutation({
  args: { command },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstanceAdmin(ctx);
    const row = await ctx.db.query("workspaceUpdate").first();
    if (!row || Date.now() - row.hostSeenAt >= HOST_TIMEOUT)
      throw new ConvexError(
        "The update watcher is offline. Start infra/docker/update.sh --watch on the server and try again.",
      );
    if (row.request || ["checking", "downloading", "restarting"].includes(row.phase))
      throw new ConvexError("An update operation is already in progress.");
    if (args.command === "restart" && row.phase !== "ready")
      throw new ConvexError("Download the update before restarting.");
    if (args.command === "download" && (!row.updateAvailable || row.phase === "ready"))
      throw new ConvexError("No update needs downloading.");
    if (args.command === "check" && row.phase === "ready")
      throw new ConvexError("The downloaded update is ready to install.");
    await ctx.db.patch(row._id, {
      request: args.command,
      error: null,
      phase:
        args.command === "check"
          ? "checking"
          : args.command === "download"
            ? "downloading"
            : "restarting",
    });
    return null;
  },
});

// These functions are reachable only with Convex deployment admin credentials.
// The watcher mints its key locally with the backend binary. No key enters the browser.
export const hostPoll = internalMutation({
  args: {},
  returns: v.union(command, v.null()),
  handler: async (ctx) => {
    const row = await ctx.db.query("workspaceUpdate").first();
    if (!row) return null;
    await ctx.db.patch(row._id, { hostSeenAt: Date.now(), request: undefined });
    return row.request ?? null;
  },
});
export const hostHeartbeat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db.query("workspaceUpdate").first();
    if (row) await ctx.db.patch(row._id, { hostSeenAt: Date.now() });
    return null;
  },
});
export const hostReport = internalMutation({
  args: { status: hostStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("workspaceUpdate").first();
    const values = { ...args.status, hostSeenAt: Date.now() };
    if (row) await ctx.db.patch(row._id, values);
    else await ctx.db.insert("workspaceUpdate", values);
    return null;
  },
});
