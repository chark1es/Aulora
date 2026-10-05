/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { type ContextMenuItem, useContextMenu } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type MouseEvent, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { type Board, type BoardMember, type Card, failure } from "./types";

export interface CardDetailProps {
  card: Card;
  board: Board;
  members: readonly BoardMember[];
  permissions: bigint;
  ownUserId: string;
  now: number;
  onClose: () => void;
}

export type CardComment = FunctionReturnType<typeof api.kanbanComments.comments>["page"][number];

function dateInput(at: number | undefined): string {
  return at === undefined ? "" : new Date(at).toISOString().slice(0, 10);
}

/** The card's editable fields, with dates as days and the estimate as typed. */
function draftFor(card: Card) {
  return {
    title: card.title,
    notes: card.notes,
    checklist: card.checklist,
    githubLinks: card.githubLinks,
    labelIds: card.labelIds,
    assigneeIds: card.assigneeIds,
    priority: card.priority,
    startAt: dateInput(card.startAt),
    dueAt: dateInput(card.dueAt),
    estimateMinutes: card.estimateMinutes === undefined ? "" : String(card.estimateMinutes),
    revision: card.revision,
  };
}

export type CardDraft = ReturnType<typeof draftFor>;

/** The fields being edited, compared against what was last loaded or saved. */
function useCardDraft(card: Card) {
  const [draft, setDraft] = useState(() => draftFor(card));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftFor(card)));
  const adopt = (next: CardDraft) => {
    setDraft(next);
    setBaseline(JSON.stringify(next));
  };
  return {
    draft,
    setDraft,
    dirty: JSON.stringify(draft) !== baseline,
    /** Someone else saved the card since this draft was loaded. */
    stale: draft.revision !== card.revision,
    adopt,
    reload: () => {
      adopt(draftFor(card));
    },
    /** A move bumps the revision without touching anything in the draft. */
    bumpRevision: () => {
      setDraft((current) => ({ ...current, revision: current.revision + 1 }));
      setBaseline((current) =>
        JSON.stringify({ ...(JSON.parse(current) as CardDraft), revision: card.revision + 1 }),
      );
    },
  };
}

/** What the viewer may do with this card. */
function cardAccess({ card, board, permissions, ownUserId }: CardDetailProps) {
  const open = !board.archived && !card.archived;
  const mayEdit = hasPermission(permissions, Permission.EditKanban);
  const canEdit = open && mayEdit;
  const canComment = open && hasPermission(permissions, Permission.CommentKanban);
  const canManage = hasPermission(permissions, Permission.ManageKanban);
  const running = card.timerStartedAt !== undefined;
  const ownsTimer = card.timerUserId === ownUserId || canManage;
  return {
    canEdit,
    canComment,
    canManage,
    canModerate: open && (canComment || canManage),
    canAttach: canEdit && hasPermission(permissions, Permission.AttachFiles),
    canTime: canEdit || (open && running && ownsTimer),
    canArchive: !board.archived && mayEdit,
  };
}

type Pending = "save" | "comment" | "other";

/** Runs a write, remembers which kind is in flight, and keeps its outcome for the footer. */
function useCardRunner() {
  const [pending, setPending] = useState<Pending | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const run = async (work: () => Promise<unknown>, success?: string, kind: Pending = "other") => {
    setPending(kind);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
      if (success !== undefined) setNotice(success);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setPending(undefined);
    }
  };
  return { pending, busy: pending !== undefined, error, setError, notice, run };
}

/** Starts or stops the timer without locking the form: it touches no edited field. */
function useTimerToggle(card: Card, setError: (error: string | undefined) => void) {
  const timer = useMutation(api.kanban.timer);
  const toggling = useRef(false);
  return async () => {
    if (toggling.current) return;
    toggling.current = true;
    setError(undefined);
    try {
      await timer({ cardId: card._id, running: card.timerStartedAt === undefined });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      toggling.current = false;
    }
  };
}

/** Which confirmation is open over the card, if any. */
export type CardConfirm = "discard" | "reload" | "archive" | "delete";

/** Right-click menus mirror a row's own buttons. */
function useRowMenu() {
  const openMenu = useContextMenu();
  return (event: MouseEvent, label: string, items: ContextMenuItem[]) => {
    if (items.length === 0) return;
    event.preventDefault();
    openMenu({ clientX: event.clientX, clientY: event.clientY, items, label });
  };
}

/** Everything the card dialog and its sections share. Edits wait for **Save card**. */
export function useCardEditor(props: CardDetailProps) {
  const { card, onClose } = props;
  const update = useMutation(api.kanban.updateCard);
  const move = useMutation(api.kanban.moveCard);
  const fields = useCardDraft(card);
  const runner = useCardRunner();
  const [confirm, setConfirm] = useState<CardConfirm | undefined>();
  const [github, setGithub] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editingComment, setEditingComment] = useState<CardComment>();
  const [removingComment, setRemovingComment] = useState<CardComment>();
  const { draft } = fields;
  const save = () => {
    void runner.run(
      async () => {
        await update({
          cardId: card._id,
          ...draft,
          startAt: draft.startAt ? Date.parse(`${draft.startAt}T00:00:00Z`) : null,
          dueAt: draft.dueAt ? Date.parse(`${draft.dueAt}T23:59:59Z`) : null,
          estimateMinutes: draft.estimateMinutes === "" ? null : Number(draft.estimateMinutes),
        });
        fields.adopt({ ...draft, revision: draft.revision + 1 });
      },
      "Card saved",
      "save",
    );
  };
  const close = () => {
    if (runner.busy) return;
    if (fields.dirty || commentText.trim() !== "") setConfirm("discard");
    else onClose();
  };
  const moveTo = (columnId: string) => {
    if (columnId === card.columnId) return;
    void runner.run(async () => {
      await move({ cardId: card._id, columnId });
      fields.bumpRevision();
    });
  };
  return {
    ...props,
    ...fields,
    ...runner,
    ...cardAccess(props),
    confirm,
    setConfirm,
    github,
    setGithub,
    commentText,
    setCommentText,
    editingComment,
    setEditingComment,
    removingComment,
    setRemovingComment,
    save,
    close,
    moveTo,
    toggleTimer: useTimerToggle(card, runner.setError),
    menu: useRowMenu(),
    memberName: (id: string) =>
      props.members.find((member) => member.userId === id)?.displayName ?? "Former member",
  };
}

export type CardEditor = ReturnType<typeof useCardEditor>;
