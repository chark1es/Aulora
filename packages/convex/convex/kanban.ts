import {
  DEFAULT_KANBAN_COLUMNS,
  hasPermission,
  isKanbanGithubLink,
  Permission,
} from "@aulora/core";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { assertMayParticipate } from "./lib/bans";
import { boardContent, requireBoard, requireKanban, writableBoard } from "./lib/kanban";
import {
  activity,
  boardFields,
  cardAccess,
  cardContent,
  cardFields,
  cardMetadata,
  checkWip,
  stopTimer,
  text,
  uniqueIds,
  validateMembers,
} from "./lib/kanbanCards";
import { requireWorkspacePermission } from "./lib/permissions";
import { sealString } from "./lib/sse";
export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const { userId } = await requireWorkspacePermission(ctx, Permission.ManageWorkspace);
    await assertMayParticipate(ctx, userId);
    const server = await ctx.db.query("server").first();
    if (!server) throw new ConvexError("Workspace not initialized");
    if (!enabled) {
      const running = await ctx.db
        .query("kanbanCards")
        .withIndex("by_running_timer", (q) => q.gt("timerStartedAt", 0))
        .collect();
      for (const card of running) await stopTimer(ctx, card);
    }
    await ctx.db.patch(server._id, { settings: { ...server.settings, kanbanEnabled: enabled } });
    await writeAudit(ctx, {
      actorId: userId,
      action: "kanban.setEnabled",
      targetId: server._id,
      meta: JSON.stringify({ enabled }),
    });
  },
});
export const listBoards = query({
  args: {},
  handler: async (ctx) => {
    const { userId, permissions } = await requireKanban(ctx);
    const boards = await ctx.db.query("kanbanBoards").take(200);
    return Promise.all(
      boards
        .filter(
          (b) =>
            !b.deleted &&
            (!b.private ||
              b.memberIds.includes(userId) ||
              hasPermission(permissions, Permission.ManageKanban)),
        )
        .map(async (b) => ({
          id: b._id,
          ...(await boardContent(b)),
          private: b.private,
          memberIds: b.memberIds,
          archived: b.archived,
          updatedAt: b.updatedAt,
        })),
    );
  },
});
export const createBoard = mutation({
  args: { name: v.string(), private: v.boolean(), memberIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireKanban(ctx, Permission.ManageKanban);
    await assertMayParticipate(ctx, userId);
    text(args.name, "Board name", 120);
    await validateMembers(ctx, args.memberIds);
    if ((await ctx.db.query("kanbanBoards").take(200)).length >= 200)
      throw new ConvexError("This workspace has reached its 200-board limit");
    const id = await ctx.db.insert("kanbanBoards", {
      contentCiphertext: "",
      private: args.private,
      memberIds: [...new Set([...args.memberIds, userId])],
      creatorId: userId,
      archived: false,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(id, {
      contentCiphertext: await sealString(
        { scope: "kanban.board", recordId: id },
        JSON.stringify({
          name: args.name.trim(),
          description: "",
          columns: DEFAULT_KANBAN_COLUMNS,
          labels: [],
        }),
      ),
    });
    await writeAudit(ctx, { actorId: userId, action: "kanban.createBoard", targetId: id });
    return id;
  },
});
export const updateBoard = mutation({
  args: {
    boardId: v.id("kanbanBoards"),
    expectedUpdatedAt: v.number(),
    ...boardFields,
    private: v.boolean(),
    memberIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { board, userId } = await writableBoard(ctx, args.boardId, Permission.ManageKanban);
    if (board.updatedAt !== args.expectedUpdatedAt)
      throw new ConvexError("The board changed. Reload its settings and try again");
    text(args.name, "Board name", 120);
    text(args.description, "Description", 5000, false);
    if (!args.columns.length || args.columns.length > 20) throw new ConvexError("Use 1–20 columns");
    uniqueIds(
      args.columns.map((c) => c.id),
      20,
    );
    uniqueIds(
      args.labels.map((l) => l.id),
      50,
    );
    for (const c of args.columns) {
      text(c.name, "Column name", 80);
      if (
        c.wipLimit !== undefined &&
        (!Number.isInteger(c.wipLimit) || c.wipLimit < 1 || c.wipLimit > 500)
      )
        throw new ConvexError("WIP limits must be 1–500");
    }
    for (const l of args.labels) {
      text(l.name, "Label name", 50);
      if (!/^#[0-9a-f]{6}$/i.test(l.color))
        throw new ConvexError("Label colors must be hex colors");
    }
    await validateMembers(ctx, args.memberIds);
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();
    for (const card of cards) {
      if (!args.columns.some((c) => c.id === card.columnId))
        throw new ConvexError(
          "Move cards out of a column before removing it, including archived cards",
        );
      if (card.labelIds.some((id) => !args.labels.some((l) => l.id === id)))
        throw new ConvexError("Remove a label from its cards before deleting it");
    }
    await ctx.db.patch(board._id, {
      contentCiphertext: await sealString(
        { scope: "kanban.board", recordId: board._id },
        JSON.stringify({
          name: args.name.trim(),
          description: args.description,
          columns: args.columns,
          labels: args.labels,
        }),
      ),
      private: args.private,
      memberIds: args.memberIds,
      updatedAt: Math.max(Date.now(), board.updatedAt + 1),
    });
    // Removed private-board members cannot keep a timer running invisibly.
    if (args.private)
      for (const card of cards) {
        if (card.timerUserId && !args.memberIds.includes(card.timerUserId))
          await stopTimer(ctx, card);
        const assigneeIds = card.assigneeIds.filter((id) => args.memberIds.includes(id));
        if (assigneeIds.length !== card.assigneeIds.length) {
          await ctx.db.patch(card._id, {
            assigneeIds,
            revision: card.revision + 1,
            updatedAt: Date.now(),
          });
          await activity(ctx, card._id, userId, "Removed assignees after board membership changed");
        }
      }
    await writeAudit(ctx, { actorId: userId, action: "kanban.updateBoard", targetId: board._id });
  },
});
export const archiveBoard = mutation({
  args: { boardId: v.id("kanbanBoards"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { board, userId } = await requireBoard(ctx, args.boardId, Permission.ManageKanban);
    await assertMayParticipate(ctx, userId);
    if (args.archived) {
      const cards = await ctx.db
        .query("kanbanCards")
        .withIndex("by_board", (q) => q.eq("boardId", board._id))
        .collect();
      for (const card of cards) await stopTimer(ctx, card);
    }
    await ctx.db.patch(board._id, { archived: args.archived, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: userId,
      action: args.archived ? "kanban.archiveBoard" : "kanban.restoreBoard",
      targetId: board._id,
    });
  },
});
export const listCards = query({
  args: { boardId: v.id("kanbanBoards") },
  handler: async (ctx, args) => {
    await requireBoard(ctx, args.boardId);
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
      .collect();
    return Promise.all(
      cards.map(async ({ contentCiphertext: _sealed, ...card }) => ({
        ...card,
        ...(await cardContent({ ...card, contentCiphertext: _sealed })),
      })),
    );
  },
});
export const createCard = mutation({
  args: {
    boardId: v.id("kanbanBoards"),
    columnId: v.string(),
    title: v.string(),
    githubLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { board, userId } = await writableBoard(ctx, args.boardId);
    text(args.title, "Title", 200);
    if (args.githubLink && !isKanbanGithubLink(args.githubLink))
      throw new ConvexError("Invalid GitHub link");
    const content = await boardContent(board);
    if (!content.columns.some((c) => c.id === args.columnId))
      throw new ConvexError("Column not found");
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();
    if (cards.length >= 500) throw new ConvexError("This board has reached its 500-card limit");
    checkWip(content.columns, cards, args.columnId);
    const id = await ctx.db.insert("kanbanCards", {
      boardId: board._id,
      contentCiphertext: "",
      columnId: args.columnId,
      position:
        Math.max(-1, ...cards.filter((c) => c.columnId === args.columnId).map((c) => c.position)) +
        1,
      labelIds: [],
      assigneeIds: [],
      priority: "none",
      fileIds: [],
      creatorId: userId,
      archived: false,
      trackedMs: 0,
      updatedAt: Date.now(),
      revision: 0,
    });
    await ctx.db.patch(id, {
      contentCiphertext: await sealString(
        { scope: "kanban.card", recordId: id },
        JSON.stringify({
          title: args.title.trim(),
          notes: "",
          checklist: [],
          githubLinks: args.githubLink ? [args.githubLink] : [],
        }),
      ),
    });
    await activity(ctx, id, userId, "Created card");
    return id;
  },
});
export const updateCard = mutation({
  args: { cardId: v.id("kanbanCards"), revision: v.number(), ...cardFields, ...cardMetadata },
  handler: async (ctx, args) => {
    const { board, card, userId } = await cardAccess(ctx, args.cardId);
    if (card.revision !== args.revision)
      throw new ConvexError("The card changed. Close and reopen it before saving");
    text(args.title, "Title", 200);
    text(args.notes, "Notes", 30000, false);
    uniqueIds(
      args.checklist.map((c) => c.id),
      100,
    );
    for (const item of args.checklist) text(item.text, "Checklist item", 500);
    uniqueIds(args.labelIds, 50);
    await validateMembers(ctx, args.assigneeIds);
    const content = await boardContent(board);
    if (args.labelIds.some((id) => !content.labels.some((l) => l.id === id)))
      throw new ConvexError("Label not found");
    if (board.private && args.assigneeIds.some((id) => !board.memberIds.includes(id)))
      throw new ConvexError("Assignees must be members of this private board");
    for (const date of [args.startAt, args.dueAt])
      if (date !== null && (!Number.isFinite(date) || date < 0 || date > 8640000000000000))
        throw new ConvexError("Invalid date");
    if (args.startAt !== null && args.dueAt !== null && args.startAt > args.dueAt)
      throw new ConvexError("Due date must follow the start date");
    if (
      args.estimateMinutes !== null &&
      (!Number.isFinite(args.estimateMinutes) ||
        args.estimateMinutes < 0 ||
        args.estimateMinutes > 525600)
    )
      throw new ConvexError("Estimate must be 0–525600 minutes");
    if (args.githubLinks.length > 20 || args.githubLinks.some((url) => !isKanbanGithubLink(url)))
      throw new ConvexError("Use GitHub repository, issue or pull request URLs");
    await ctx.db.patch(card._id, {
      contentCiphertext: await sealString(
        { scope: "kanban.card", recordId: card._id },
        JSON.stringify({
          title: args.title.trim(),
          notes: args.notes,
          checklist: args.checklist,
          githubLinks: args.githubLinks,
        }),
      ),
      labelIds: args.labelIds,
      assigneeIds: args.assigneeIds,
      priority: args.priority,
      startAt: args.startAt ?? undefined,
      dueAt: args.dueAt ?? undefined,
      estimateMinutes: args.estimateMinutes ?? undefined,
      updatedAt: Date.now(),
      revision: card.revision + 1,
    });
    await activity(ctx, card._id, userId, "Updated card details");
  },
});
export const moveCard = mutation({
  args: {
    cardId: v.id("kanbanCards"),
    columnId: v.string(),
    beforeId: v.optional(v.id("kanbanCards")),
  },
  handler: async (ctx, args) => {
    const { board, card, userId } = await cardAccess(ctx, args.cardId);
    const content = await boardContent(board);
    const target = content.columns.find((c) => c.id === args.columnId);
    if (!target) throw new ConvexError("Column not found");
    const cards = await ctx.db
      .query("kanbanCards")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();
    checkWip(content.columns, cards, args.columnId, card._id);
    const ordered = cards
      .filter((c) => c.columnId === args.columnId && c._id !== card._id && !c.archived)
      .sort((a, b) => a.position - b.position);
    let index = ordered.length;
    if (args.beforeId) {
      index = ordered.findIndex((c) => c._id === args.beforeId);
      if (index < 0) throw new ConvexError("Target card not found in this column");
    }
    ordered.splice(index, 0, card);
    for (const [position, row] of ordered.entries())
      await ctx.db.patch(row._id, { columnId: args.columnId, position });
    await ctx.db.patch(card._id, { updatedAt: Date.now(), revision: card.revision + 1 });
    await activity(ctx, card._id, userId, `Moved to ${target.name}`);
  },
});
export const archiveCard = mutation({
  args: { cardId: v.id("kanbanCards"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const { board, card, userId } = await cardAccess(ctx, args.cardId, Permission.EditKanban, true);
    if (!args.archived) {
      const cards = await ctx.db
        .query("kanbanCards")
        .withIndex("by_board", (q) => q.eq("boardId", board._id))
        .collect();
      checkWip((await boardContent(board)).columns, cards, card.columnId, card._id);
    }
    await stopTimer(ctx, card);
    await ctx.db.patch(card._id, {
      archived: args.archived,
      updatedAt: Date.now(),
      revision: card.revision + 1,
    });
    await activity(ctx, card._id, userId, args.archived ? "Archived card" : "Restored card");
  },
});
export const timer = mutation({
  args: { cardId: v.id("kanbanCards"), running: v.boolean() },
  handler: async (ctx, args) => {
    const { card, userId, permissions } = await cardAccess(
      ctx,
      args.cardId,
      args.running ? Permission.EditKanban : Permission.ViewKanban,
    );
    if (
      card.timerUserId &&
      card.timerUserId !== userId &&
      !hasPermission(permissions, Permission.ManageKanban)
    )
      throw new ConvexError("Only the timer owner or a board manager can stop this timer");
    if (args.running) {
      if (card.timerStartedAt !== undefined)
        throw new ConvexError("A timer is already running on this card");
      const active = await ctx.db
        .query("kanbanCards")
        .withIndex("by_timer_user", (q) => q.eq("timerUserId", userId))
        .first();
      if (active) throw new ConvexError("Stop your other timer before starting this one");
      await ctx.db.patch(card._id, { timerStartedAt: Date.now(), timerUserId: userId });
    } else await stopTimer(ctx, card);
    await activity(
      ctx,
      card._id,
      userId,
      args.running ? "Started work timer" : "Stopped work timer",
    );
  },
});
export const attachFile = mutation({
  args: { cardId: v.id("kanbanCards"), fileId: v.id("files"), remove: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { card, userId } = await cardAccess(ctx, args.cardId);
    await requireWorkspacePermission(ctx, Permission.AttachFiles);
    const file = await ctx.db.get(args.fileId);
    if (
      !file ||
      file.kanbanBoardId !== card.boardId ||
      (!args.remove && file.uploaderId !== userId)
    )
      throw new ConvexError("File does not belong to this board and uploader");
    const fileIds = args.remove
      ? card.fileIds.filter((id) => id !== args.fileId)
      : [...new Set([...card.fileIds, args.fileId])];
    if (fileIds.length > 20) throw new ConvexError("A card can have up to 20 attachments");
    await ctx.db.patch(card._id, { fileIds, updatedAt: Date.now() });
    await activity(
      ctx,
      card._id,
      userId,
      args.remove ? "Removed an attachment" : "Added an attachment",
    );
  },
});
export const deleteCard = mutation({
  args: { cardId: v.id("kanbanCards") },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("Card not found");
    const { userId } = await requireBoard(ctx, card.boardId, Permission.ManageKanban);
    await assertMayParticipate(ctx, userId);
    await ctx.db.delete(card._id);
    await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupCard, {
      cardId: card._id,
      boardId: card.boardId,
      fileIds: card.fileIds,
    });
    await writeAudit(ctx, { actorId: userId, action: "kanban.deleteCard", targetId: card._id });
  },
});
export const deleteBoard = mutation({
  args: { boardId: v.id("kanbanBoards") },
  handler: async (ctx, args) => {
    const { board, userId } = await requireBoard(ctx, args.boardId, Permission.ManageKanban);
    await assertMayParticipate(ctx, userId);
    await ctx.db.patch(board._id, { deleted: true, archived: true });
    await ctx.scheduler.runAfter(0, internal.kanbanCleanup.cleanupBoard, { boardId: board._id });
    await writeAudit(ctx, { actorId: userId, action: "kanban.deleteBoard", targetId: board._id });
  },
});
