/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { hasPermission, Permission } from "@aulora/core";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import {
  type Board,
  type BoardMember,
  type Card,
  dayOf,
  endOfDay,
  failure,
  startOfDay,
} from "../../lib/kanban";
import { useNow } from "./parts";
import { useOptimisticTimer } from "./use-board-mutations";

export interface CardSheetProps {
  readonly card: Card;
  readonly board: Board;
  readonly members: readonly BoardMember[];
  readonly permissions: bigint;
  readonly ownUserId: string;
  readonly onClose: () => void;
}

export type CardComment = FunctionReturnType<typeof api.kanbanComments.comments>["page"][number];

/** Which picker is open over the card, if any. */
export type CardPicker =
  | "column"
  | "priority"
  | "assignees"
  | "labels"
  | "start"
  | "due"
  | "attach";

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
    startAt: dayOf(card.startAt),
    dueAt: dayOf(card.dueAt),
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
    reload: () => {
      adopt(draftFor(card));
    },
    adopt,
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
function cardAccess({ card, board, permissions, ownUserId }: CardSheetProps) {
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

/** Runs a write, remembers which kind is in flight, and keeps its failure. */
function useCardRunner() {
  const [pending, setPending] = useState<Pending | undefined>();
  const [error, setError] = useState<string | undefined>();
  const run = async (work: () => Promise<unknown>, kind: Pending = "other") => {
    setPending(kind);
    setError(undefined);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setPending(undefined);
    }
  };
  return { pending, busy: pending !== undefined, error, setError, run };
}

/** Starts or stops the timer without locking the form: it touches no edited field. */
function useTimerToggle(card: Card, ownUserId: string, setError: (error: string) => void) {
  const timer = useOptimisticTimer(ownUserId);
  const toggling = useRef(false);
  return async () => {
    if (toggling.current) return;
    toggling.current = true;
    try {
      await timer({ cardId: card._id, running: card.timerStartedAt === undefined });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      toggling.current = false;
    }
  };
}

/** Everything the card sheet and its sections share. Edits wait for **Save card**. */
export function useCardEditor(props: CardSheetProps) {
  const { card, onClose } = props;
  const update = useMutation(api.kanban.updateCard);
  const move = useMutation(api.kanban.moveCard);
  const fields = useCardDraft(card);
  const runner = useCardRunner();
  const [picker, setPicker] = useState<CardPicker | undefined>();
  const [commentText, setCommentText] = useState("");
  const [editingComment, setEditingComment] = useState<CardComment>();
  const { draft } = fields;
  const unsaved = fields.dirty || commentText.trim() !== "";
  const save = () => {
    void runner.run(async () => {
      await update({
        cardId: card._id,
        ...draft,
        startAt: draft.startAt ? startOfDay(draft.startAt) : null,
        dueAt: draft.dueAt ? endOfDay(draft.dueAt) : null,
        estimateMinutes: draft.estimateMinutes === "" ? null : Number(draft.estimateMinutes),
      });
      fields.adopt({ ...draft, revision: draft.revision + 1 });
    }, "save");
  };
  const close = () => {
    if (runner.busy) return;
    if (!unsaved) {
      onClose();
      return;
    }
    Alert.alert("Discard unsaved changes?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
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
    picker,
    setPicker,
    commentText,
    setCommentText,
    editingComment,
    setEditingComment,
    unsaved,
    save,
    close,
    moveTo,
    toggleTimer: useTimerToggle(card, props.ownUserId, runner.setError),
    /** The time the sheet opened at; only the timer's own clock ticks. */
    now: useNow(false),
  };
}

export type CardEditor = ReturnType<typeof useCardEditor>;
