import {
  autoUpdateEnabled,
  loadPublishedRelease,
  planWorkspaceUpdate,
  resolveGitHubRepo,
  resolveManifestUrl,
  updateChannel,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { coolifyConfiguration, createCoolifyUpdater } from "./lib/coolifyUpdates";
import { AULORA_VERSION } from "./lib/env";
import { requireInstanceAdmin } from "./lib/instance";

/**
 * Workspace update controls. Docker installs run through the host watcher;
 * managed installs ask Coolify to build and deploy the published release.
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
    return {
      currentVersion: row.currentVersion,
      latestVersion: row.latestVersion,
      updateAvailable: row.updateAvailable,
      notes: row.notes,
      error: row.error,
      autoUpdate: row.autoUpdate,
      phase: row.phase,
      checkedAt: row.checkedAt,
      hostSeenAt: row.hostSeenAt,
      hostConnected: Date.now() - row.hostSeenAt < HOST_TIMEOUT,
      pending: row.request !== undefined,
    };
  },
});

/** Only the owner can queue a fixed operation; callers cannot supply commands or release URLs. */
export const request = mutation({
  args: { command },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstanceAdmin(ctx);
    if (coolifyConfiguration().provider === "coolify")
      throw new ConvexError("Use Install update for this Coolify deployment.");
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

/** Configuration and progress only. Deployment credentials never enter the client. */
export const capabilities = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const configuration = coolifyConfiguration();
    const row =
      configuration.provider === "coolify"
        ? await ctx.db.query("coolifyUpdate").order("desc").first()
        : null;
    return {
      provider: configuration.provider,
      configured: configuration.config !== null,
      error: configuration.error,
      status: row ? { phase: row.phase, targetVersion: row.targetVersion, error: row.error } : null,
    };
  },
});

export const installCoolify = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runQuery(internal.updates.assertInstanceAdmin, {});
    const configuration = coolifyConfiguration();
    if (!configuration.config)
      throw new ConvexError(configuration.error ?? "Coolify updates are not configured.");
    const plan = await ctx.runAction(api.updates.check, {});
    if (plan.error) throw new ConvexError(plan.error);
    if (!plan.updateAvailable || !plan.latestVersion || !plan.gitTag)
      throw new ConvexError("No update needs installing.");
    const repo = resolveGitHubRepo(process.env.AULORA_UPDATE_GITHUB_REPO);
    if ("error" in repo) throw new ConvexError(repo.error);
    await ctx.runMutation(internal.updates.beginCoolifyInstall, {
      targetVersion: plan.latestVersion,
      gitTag: plan.gitTag,
      githubRepo: repo.repo,
    });
    return null;
  },
});

export const beginCoolifyInstall = internalMutation({
  args: { targetVersion: v.string(), gitTag: v.string(), githubRepo: v.string() },
  returns: v.id("coolifyUpdate"),
  handler: async (ctx, args) => {
    const previous = await ctx.db.query("coolifyUpdate").order("desc").first();
    if (previous?.phase === "installing")
      throw new ConvexError("An update installation is already in progress.");
    const id = await ctx.db.insert("coolifyUpdate", {
      ...args,
      phase: "installing",
      startedAt: Date.now(),
      error: null,
    });
    await ctx.scheduler.runAfter(0, internal.updates.deployCoolify, { id });
    return id;
  },
});

export const coolifyOperation = internalQuery({
  args: { id: v.id("coolifyUpdate") },
  handler: (ctx, args) => ctx.db.get(args.id),
});

export const reportCoolify = internalMutation({
  args: {
    id: v.id("coolifyUpdate"),
    phase: v.union(v.literal("installing"), v.literal("installed"), v.literal("failed")),
    error: v.union(v.string(), v.null()),
    deploymentUuid: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...status }) => {
    const row = await ctx.db.get(id);
    if (row?.phase !== "installing") return null;
    await ctx.db.patch(id, status);
    if (status.phase === "installing")
      await ctx.scheduler.runAfter(10_000, internal.updates.pollCoolify, { id });
    return null;
  },
});

export const deployCoolify = internalAction({
  args: { id: v.id("coolifyUpdate") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.updates.coolifyOperation, { id });
    if (row?.phase !== "installing") return null;
    try {
      const configuration = coolifyConfiguration();
      if (!configuration.config)
        throw new Error(configuration.error ?? "Coolify updates are not configured.");
      const deploymentUuid = await createCoolifyUpdater(configuration.config).deploy(
        row.githubRepo,
        row.gitTag,
      );
      await ctx.runMutation(internal.updates.reportCoolify, {
        id,
        phase: "installing",
        error: null,
        deploymentUuid,
      });
    } catch (cause) {
      await ctx.runMutation(internal.updates.reportCoolify, {
        id,
        phase: "failed",
        error: cause instanceof Error ? cause.message : "Could not start the Coolify deployment.",
      });
    }
    return null;
  },
});

export const pollCoolify = internalAction({
  args: { id: v.id("coolifyUpdate") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.updates.coolifyOperation, { id });
    if (row?.phase !== "installing" || !row.deploymentUuid) return null;
    let phase: "installing" | "installed" | "failed" = "installing";
    let error: string | null = null;
    try {
      const configuration = coolifyConfiguration();
      if (!configuration.config)
        throw new Error(configuration.error ?? "Coolify updates are not configured.");
      phase = await createCoolifyUpdater(configuration.config).status(row.deploymentUuid);
      if (phase === "failed")
        error = "Coolify did not complete the update. Check the deployment logs before retrying.";
      if (phase === "installed" && AULORA_VERSION !== row.targetVersion) {
        phase = "failed";
        error =
          "Coolify finished, but this instance is still running a different version. Check the setup service logs.";
      }
    } catch (cause) {
      // Keep the operation locked during transient outages rather than allowing duplicate deployments.
      error =
        cause instanceof Error ? cause.message : "Could not read the Coolify deployment status.";
    }
    if (phase === "installing" && Date.now() - row.startedAt >= 60 * 60 * 1000) {
      phase = "failed";
      error =
        "The update has not completed after an hour. Check Coolify before attempting another installation.";
    }
    await ctx.runMutation(internal.updates.reportCoolify, {
      id,
      phase,
      error,
      deploymentUuid: row.deploymentUuid,
    });
    return null;
  },
});
