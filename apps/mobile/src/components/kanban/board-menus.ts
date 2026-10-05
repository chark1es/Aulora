import * as Clipboard from "expo-clipboard";
import { Alert } from "react-native";
import {
  type Board,
  type Card,
  cardsInColumn,
  isColumnFull,
  moveStep,
  NO_FILTERS,
} from "../../lib/kanban";
import type { SheetAction } from "./sheets";
import type { BoardController } from "./use-board";

/** Asks before something that cannot be undone. */
export function confirm(title: string, message: string, label: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: label, style: "destructive", onPress: onConfirm },
  ]);
}

/** Every field `updateCard` needs, taken from the card as saved. */
export function savedFields(card: Card) {
  return {
    cardId: card._id,
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

function moveToColumn(ctl: BoardController, board: Board, card: Card): SheetAction[] {
  const others = board.columns.filter((column) => column.id !== card.columnId);
  return others.map((column, index) => {
    const full = isColumnFull(column, ctl.cards ?? []);
    return {
      id: `column-${column.id}`,
      label: column.name,
      icon: "chevron-right",
      disabled: full,
      ...(full ? { hint: "Column limit reached" } : {}),
      ...(index === 0 ? { section: "Move to" } : {}),
      onPress: () => {
        ctl.showColumn.current(board.columns.indexOf(column));
        void ctl.run(() => ctl.mutations.move({ cardId: card._id, columnId: column.id }));
      },
    };
  });
}

function moveWithinColumn(ctl: BoardController, card: Card): SheetAction[] {
  const siblings = cardsInColumn(ctl.filtered, card.columnId);
  const up = moveStep(siblings, card._id, "up");
  const down = moveStep(siblings, card._id, "down");
  return [
    {
      id: "up",
      label: "Move up",
      icon: "arrow-up",
      section: true,
      disabled: up === null,
      onPress: () => {
        if (up !== null) void ctl.run(() => ctl.mutations.move({ cardId: card._id, ...up }));
      },
    },
    {
      id: "down",
      label: "Move down",
      icon: "arrow-down",
      disabled: down === null,
      onPress: () => {
        if (down !== null) void ctl.run(() => ctl.mutations.move({ cardId: card._id, ...down }));
      },
    },
  ];
}

function assignToMe(ctl: BoardController, card: Card): SheetAction[] {
  const me = ctl.ownUserId;
  const mine = card.assigneeIds.includes(me);
  if (!mine && !ctl.boardMembers.some((member) => member.userId === me)) return [];
  const assigneeIds = mine ? card.assigneeIds.filter((id) => id !== me) : [...card.assigneeIds, me];
  return [
    {
      id: "assign",
      label: mine ? "Unassign me" : "Assign to me",
      icon: "user-plus",
      section: true,
      onPress: () => {
        void ctl.run(() => ctl.mutations.updateCard({ ...savedFields(card), assigneeIds }));
      },
    },
  ];
}

function timerAction(ctl: BoardController, board: Board, card: Card): SheetAction[] {
  const running = card.timerStartedAt !== undefined;
  const allowed = running ? card.timerUserId === ctl.ownUserId || ctl.canManage : ctl.canEdit;
  if (card.archived || board.archived || !allowed) return [];
  return [
    {
      id: "timer",
      label: running ? "Stop timer" : "Start timer",
      icon: running ? "stop" : "play",
      onPress: () => {
        void ctl.run(() => ctl.mutations.timer({ cardId: card._id, running: !running }));
      },
    },
  ];
}

function keepOrRemove(ctl: BoardController, card: Card): SheetAction[] {
  const actions: SheetAction[] = [];
  if (ctl.canEdit)
    actions.push({
      id: "archive",
      label: card.archived ? "Restore card" : "Archive card",
      icon: card.archived ? "unarchive" : "archive",
      onPress: () => {
        void ctl.run(() =>
          ctl.mutations.archiveCard({ cardId: card._id, archived: !card.archived }),
        );
      },
    });
  if (ctl.canManage)
    actions.push({
      id: "delete",
      label: "Delete card…",
      icon: "trash",
      danger: true,
      onPress: () => {
        confirm(
          "Permanently delete card?",
          "This deletes the card with its comments, activity and attachments. It cannot be undone.",
          "Delete card",
          () => {
            void ctl.run(() => ctl.mutations.deleteCard({ cardId: card._id }));
          },
        );
      },
    });
  return actions;
}

/** What a long press on a card offers: the touch version of the web's right-click menu. */
export function cardActions(ctl: BoardController, board: Board, card: Card): SheetAction[] {
  const arrange = ctl.canArrange
    ? [...moveToColumn(ctl, board, card), ...moveWithinColumn(ctl, card), ...assignToMe(ctl, card)]
    : [];
  return [
    {
      id: "open",
      label: "Open card",
      icon: "expand",
      onPress: () => {
        ctl.setDetail(card._id);
      },
    },
    ...arrange,
    ...timerAction(ctl, board, card),
    {
      id: "copy",
      label: "Copy title",
      icon: "copy",
      section: true,
      onPress: () => {
        void Clipboard.setStringAsync(card.title);
      },
    },
    ...keepOrRemove(ctl, card),
  ];
}

function manageBoard(ctl: BoardController, board: Board): SheetAction[] {
  const setArchived = (archived: boolean) => {
    void ctl.run(() => ctl.mutations.archiveBoard({ boardId: board.id, archived }));
  };
  const archive: SheetAction = board.archived
    ? {
        id: "restore",
        label: "Restore board",
        icon: "unarchive",
        section: true,
        onPress: () => {
          setArchived(false);
        },
      }
    : {
        id: "archive",
        label: "Archive board…",
        icon: "archive",
        section: true,
        onPress: () => {
          confirm(
            "Archive board?",
            "Work timers will stop. You can restore this board from archived boards.",
            "Archive board",
            () => {
              setArchived(true);
            },
          );
        },
      };
  return [
    archive,
    {
      id: "delete",
      label: "Delete board…",
      icon: "trash",
      danger: true,
      onPress: () => {
        confirm(
          "Permanently delete board?",
          "All cards, comments, activity and uploaded board files will be deleted. This cannot be undone.",
          "Delete board",
          () => {
            void ctl.run(() => ctl.mutations.deleteBoard({ boardId: board.id }));
          },
        );
      },
    },
  ];
}

/** The board's own menu: settings, archived cards, filters, archive and delete. */
export function boardActions(ctl: BoardController, board: Board): SheetAction[] {
  const actions: SheetAction[] = [];
  if (ctl.canManage && !board.archived)
    actions.push({
      id: "settings",
      label: "Board settings…",
      icon: "settings",
      onPress: () => {
        ctl.setOpen({ kind: "settings" });
      },
    });
  actions.push({
    id: "archived-cards",
    label: ctl.archivedCards ? "Show active cards" : "Show archived cards",
    icon: "archive",
    onPress: () => {
      ctl.setArchivedCards(!ctl.archivedCards);
    },
  });
  if (ctl.filtering)
    actions.push({
      id: "clear",
      label: "Clear filters",
      icon: "x",
      onPress: () => {
        ctl.setFilters(NO_FILTERS);
      },
    });
  return ctl.canManage ? [...actions, ...manageBoard(ctl, board)] : actions;
}

function boardIcon(board: Board, current: boolean) {
  if (current) return "check" as const;
  return board.private ? ("lock" as const) : ("kanban" as const);
}

/** The board switcher: every visible board, then a new one and the archive. */
export function boardChoices(ctl: BoardController): SheetAction[] {
  const actions: SheetAction[] = ctl.visibleBoards.map((entry) => ({
    id: entry.id,
    label: entry.name,
    icon: boardIcon(entry, entry.id === ctl.board?.id),
    onPress: () => {
      ctl.selectBoard(entry.id);
      ctl.setError(undefined);
    },
  }));
  if (ctl.canManage)
    actions.push({
      id: "new",
      label: "New board",
      icon: "plus",
      section: true,
      onPress: () => {
        ctl.setOpen({ kind: "newBoard" });
      },
    });
  actions.push({
    id: "archived",
    label: ctl.archivedBoards ? "Show active boards" : "Show archived boards",
    icon: ctl.archivedBoards ? "kanban" : "archive",
    ...(ctl.canManage ? {} : { section: true as const }),
    onPress: () => {
      ctl.setArchivedBoards(!ctl.archivedBoards);
      ctl.selectBoard(null);
    },
  });
  return actions;
}
