import { hasPermission, type KanbanBoardContent, Permission } from "@aulora/core";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "./auth";
import { assertMayParticipate, listActiveBans } from "./bans";
import { loadPermissionContext, type PermissionContext, workspacePermissions } from "./permissions";
import { openContent } from "./sealed";

type ReadCtx = QueryCtx | MutationCtx;

export async function requireKanbanUser(
  ctx: ReadCtx,
  userId: string,
  flag = Permission.ViewKanban,
) {
  const server = await ctx.db.query("server").first();
  if (server?.settings.kanbanEnabled !== true) throw new ConvexError("Kanban is disabled");
  if ((await listActiveBans(ctx, userId)).length > 0)
    throw new ConvexError("You are banned from this workspace");
  const context = await loadPermissionContext(ctx, userId);
  const permissions = workspacePermissions(context);
  if (!hasPermission(permissions, Permission.ViewKanban) || !hasPermission(permissions, flag)) {
    throw new ConvexError("Missing Kanban permission");
  }
  return { userId, permissions };
}
export async function requireKanban(ctx: ReadCtx, flag = Permission.ViewKanban) {
  const { userId } = await requireAuth(ctx);
  return requireKanbanUser(ctx, userId, flag);
}
export async function requireBoardForUser(
  ctx: ReadCtx,
  userId: string,
  boardId: Id<"kanbanBoards">,
  flag = Permission.ViewKanban,
) {
  const auth = await requireKanbanUser(ctx, userId, flag);
  const board = await ctx.db.get(boardId);
  if (board === null || board.deleted) throw new ConvexError("Board not found");
  if (
    board.private &&
    !board.memberIds.includes(userId) &&
    !hasPermission(auth.permissions, Permission.ManageKanban)
  ) {
    throw new ConvexError("You do not have access to this board");
  }
  return { ...auth, board };
}
export async function requireBoard(
  ctx: ReadCtx,
  boardId: Id<"kanbanBoards">,
  flag = Permission.ViewKanban,
) {
  const { userId } = await requireAuth(ctx);
  return requireBoardForUser(ctx, userId, boardId, flag);
}

/**
 * {@link requireBoardForUser} for an actor whose {@link PermissionContext} is
 * already loaded, so a caller gating many boards pays the role/member load once
 * instead of once per board. Workspace kanban state, bans and the board's own
 * visibility are checked with the same order and errors.
 */
export async function requireBoardForUserFromContext(
  ctx: ReadCtx,
  context: PermissionContext,
  boardId: Id<"kanbanBoards">,
  flag = Permission.ViewKanban,
) {
  const server = await ctx.db.query("server").first();
  if (server?.settings.kanbanEnabled !== true) throw new ConvexError("Kanban is disabled");
  if ((await listActiveBans(ctx, context.userId)).length > 0)
    throw new ConvexError("You are banned from this workspace");
  const permissions = workspacePermissions(context);
  if (!hasPermission(permissions, Permission.ViewKanban) || !hasPermission(permissions, flag)) {
    throw new ConvexError("Missing Kanban permission");
  }
  const board = await ctx.db.get(boardId);
  if (board === null || board.deleted) throw new ConvexError("Board not found");
  if (
    board.private &&
    !board.memberIds.includes(context.userId) &&
    !hasPermission(permissions, Permission.ManageKanban)
  ) {
    throw new ConvexError("You do not have access to this board");
  }
  return { userId: context.userId, permissions, board };
}
export async function writableBoard(
  ctx: MutationCtx,
  boardId: Id<"kanbanBoards">,
  flag = Permission.EditKanban,
) {
  const result = await requireBoard(ctx, boardId, flag);
  await assertMayParticipate(ctx, result.userId);
  if (result.board.archived) throw new ConvexError("Restore the board before editing it");
  return result;
}
export async function boardContent(board: {
  _id: Id<"kanbanBoards">;
  contentCiphertext: string;
}): Promise<KanbanBoardContent> {
  return JSON.parse(
    await openContent({ scope: "kanban.board", recordId: board._id }, board.contentCiphertext),
  );
}
