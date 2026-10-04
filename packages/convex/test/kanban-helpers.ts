import { Permission } from "@aulora/core";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedWorkspace } from "./helpers";

export const MEMBER =
  Permission.ViewKanban | Permission.EditKanban | Permission.CommentKanban | Permission.AttachFiles;
export async function setup(permissions = MEMBER) {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: permissions,
    members: [{ userId: "alice" }, { userId: "bob" }],
  });
  const owner = t.withIdentity({ subject: "owner-1" });
  await owner.mutation(api.kanban.setEnabled, { enabled: true });
  const boardId = await owner.mutation(api.kanban.createBoard, {
    name: "Release",
    private: false,
    memberIds: [],
  });
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  return { t, owner, alice, bob, boardId };
}
export async function cardArgs(
  alice: ReturnType<ReturnType<typeof newTest>["withIdentity"]>,
  boardId: Id<"kanbanBoards">,
  cardId: Id<"kanbanCards">,
) {
  const card = (await alice.query(api.kanban.listCards, { boardId })).find((c) => c._id === cardId);
  if (!card) throw new Error("Missing card");
  return {
    cardId,
    revision: card.revision,
    title: card.title,
    notes: card.notes,
    checklist: card.checklist,
    githubLinks: card.githubLinks,
    labelIds: card.labelIds,
    assigneeIds: card.assigneeIds,
    priority: card.priority,
    startAt: card.startAt ?? null,
    dueAt: card.dueAt ?? null,
    estimateMinutes: card.estimateMinutes ?? null,
  };
}
