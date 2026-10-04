import { isGithubRepositoryName, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { assertMayParticipate } from "./lib/bans";
import { requireKanban } from "./lib/kanban";
import { openContent } from "./lib/sealed";
import { sealString } from "./lib/sse";

/** A connection belongs to the caller, never to the board or workspace. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireKanban(ctx);
    const row = await ctx.db
      .query("kanbanGithub")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return { connected: row !== null };
  },
});
export const connect = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireKanban(ctx, Permission.ViewKanban);
    await assertMayParticipate(ctx, userId);
    const token = args.token.trim();
    if (token.length < 20 || token.length > 1000 || /\s/.test(token))
      throw new ConvexError("Enter a valid GitHub personal access token");
    const tokenCiphertext = await sealString({ scope: "kanban.github", recordId: userId }, token);
    const row = await ctx.db
      .query("kanbanGithub")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { tokenCiphertext });
    else await ctx.db.insert("kanbanGithub", { userId, tokenCiphertext });
  },
});
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    // Allow revoking a connection even after the addon or access is disabled.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const row = await ctx.db
      .query("kanbanGithub")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});
export const credentials = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireKanban(ctx);
    const row = await ctx.db
      .query("kanbanGithub")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) throw new ConvexError("Connect your GitHub account first");
    return {
      token: await openContent({ scope: "kanban.github", recordId: userId }, row.tokenCiphertext),
    };
  },
});
interface GitHubRepository {
  full_name: string;
  private: boolean;
  description: string | null;
}
interface GitHubItem {
  number: number;
  title: string;
  state: string;
  updated_at: string;
  pull_request?: unknown;
  draft?: boolean;
}
export interface GitHubBrowseResult {
  repositories: { name: string; url: string; private: boolean; description: string | null }[];
  items: {
    number: number;
    title: string;
    state: string;
    url: string;
    kind: "issue" | "pull";
    updatedAt: string;
    draft: boolean;
  }[];
  hasMore: boolean;
}
/** Compares two secrets without stopping at the first difference. */
function sameSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index % Math.max(right.length, 1));
  return difference === 0;
}

/** Calls the GitHub API and turns its failures into messages a member can act on. */
async function githubRequest(path: string, token: string): Promise<Response> {
  // Fixed origin and no redirects prevent credentials going to a user-controlled host.
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Aulora-Kanban",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.ok) return response;
  if (response.status === 401)
    throw new ConvexError("Your GitHub token is invalid or expired. Reconnect with a new token");
  if (response.status === 403 || response.status === 429)
    throw new ConvexError(
      "GitHub denied this request. Check token permissions or try again after the rate limit resets",
    );
  if (response.status === 404)
    throw new ConvexError("Repository not found or your GitHub token does not have access");
  throw new ConvexError("GitHub is unavailable. Try again later");
}

export const browse = action({
  args: {
    repository: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("issues"), v.literal("pulls"))),
    state: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("all"))),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GitHubBrowseResult> => {
    const { token } = await ctx.runQuery(internal.kanbanGithub.credentials, {});
    const page = args.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new ConvexError("Invalid page");
    if (args.repository && !isGithubRepositoryName(args.repository))
      throw new ConvexError("Use an owner/repository name");
    const kind = args.kind ?? "issues";
    const path = args.repository
      ? `/repos/${args.repository}/${kind}?state=${args.state ?? "open"}&sort=updated&direction=desc&per_page=50&page=${page}`
      : `/user/repos?sort=updated&per_page=50&page=${page}`;
    // Fixed origin and no redirects prevent credentials going to a user-controlled host.
    const response = await githubRequest(path, token);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new ConvexError("Unexpected GitHub response");
    // Check current standing again after the external request, including token revocation.
    const current = await ctx.runQuery(internal.kanbanGithub.credentials, {});
    if (!sameSecret(current.token, token))
      throw new ConvexError("GitHub connection changed. Try again");
    const hasMore = response.headers.get("link")?.includes('rel="next"') ?? false;
    if (!args.repository) {
      const repos = data as GitHubRepository[];
      return {
        repositories: repos.map((r) => ({
          name: r.full_name,
          url: `https://github.com/${r.full_name}`,
          private: r.private,
          description: r.description,
        })),
        items: [],
        hasMore,
      };
    }
    const items = data as GitHubItem[];
    return {
      repositories: [],
      hasMore,
      items: items
        .filter((i) => kind === "pulls" || !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          updatedAt: i.updated_at,
          url: `https://github.com/${args.repository}/${kind === "pulls" ? "pull" : "issues"}/${i.number}`,
          kind: kind === "pulls" ? "pull" : "issue",
          draft: i.draft ?? false,
        })),
    };
  },
});
