import { type KanbanCardContent, Permission } from "@aulora/core";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { listActiveBans } from "./bans";
import { writableBoard } from "./kanban";
import { requireMember } from "./permissions";
import { openContent } from "./sealed";
import { sealString } from "./sse";

/** Validators and checks shared by the Kanban board, card and comment functions. */

export const column = v.object({
  id: v.string(),
  name: v.string(),
  wipLimit: v.optional(v.number()),
});
export const label = v.object({ id: v.string(), name: v.string(), color: v.string() });
export const boardFields = {
  name: v.string(),
  description: v.string(),
  columns: v.array(column),
  labels: v.array(label),
};
export const cardFields = {
  title: v.string(),
  notes: v.string(),
  checklist: v.array(v.object({ id: v.string(), text: v.string(), done: v.boolean() })),
  githubLinks: v.array(v.string()),
};
export const priority = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);
export const cardMetadata = {
  labelIds: v.array(v.string()),
  assigneeIds: v.array(v.string()),
  priority,
  startAt: v.union(v.number(), v.null()),
  dueAt: v.union(v.number(), v.null()),
  estimateMinutes: v.union(v.number(), v.null()),
};
export function text(value: string, name: string, max: number, required = true) {
  if ((required && !value.trim()) || value.length > max)
    throw new ConvexError(`${name} must be ${required ? "1" : "0"}–${max} characters`);
}
export function uniqueIds(values: string[], max: number) {
  if (
    values.length > max ||
    new Set(values).size !== values.length ||
    values.some((id) => !id || id.length > 100)
  ) {
    throw new ConvexError("Invalid or duplicate identifiers");
  }
}
export async function validateMembers(ctx: MutationCtx, ids: string[]) {
  uniqueIds(ids, 100);
  for (const id of ids) {
    await requireMember(ctx, id);
    if ((await listActiveBans(ctx, id)).length)
      throw new ConvexError("Cannot assign a banned member");
  }
}
export async function activity(
  ctx: MutationCtx,
  cardId: Id<"kanbanCards">,
  actorId: string,
  body: string,
) {
  const id = await ctx.db.insert("kanbanActivity", {
    cardId,
    actorId,
    bodyCiphertext: "",
    at: Date.now(),
  });
  await ctx.db.patch(id, {
    bodyCiphertext: await sealString({ scope: "kanban.activity", recordId: id }, body),
  });
}
export async function stopTimer(ctx: MutationCtx, card: Doc<"kanbanCards">) {
  if (card.timerStartedAt === undefined) return;
  await ctx.db.patch(card._id, {
    trackedMs: card.trackedMs + Math.max(0, Date.now() - card.timerStartedAt),
    timerStartedAt: undefined,
    timerUserId: undefined,
  });
}
export async function cardAccess(
  ctx: MutationCtx,
  cardId: Id<"kanbanCards">,
  flag = Permission.EditKanban,
  allowArchived = false,
) {
  const card = await ctx.db.get(cardId);
  if (!card) throw new ConvexError("Card not found");
  const auth = await writableBoard(ctx, card.boardId, flag);
  if (card.archived && !allowArchived) throw new ConvexError("Restore the card before editing it");
  return { ...auth, card };
}
export async function cardContent(card: Doc<"kanbanCards">): Promise<KanbanCardContent> {
  return JSON.parse(
    await openContent({ scope: "kanban.card", recordId: card._id }, card.contentCiphertext),
  );
}
export function checkWip(
  columns: { id: string; wipLimit?: number }[],
  cards: Doc<"kanbanCards">[],
  columnId: string,
  exclude?: Id<"kanbanCards">,
) {
  const limit = columns.find((c) => c.id === columnId)?.wipLimit;
  if (
    limit !== undefined &&
    cards.filter((c) => c.columnId === columnId && !c.archived && c._id !== exclude).length >= limit
  )
    throw new ConvexError("This column has reached its work-in-progress limit");
}
