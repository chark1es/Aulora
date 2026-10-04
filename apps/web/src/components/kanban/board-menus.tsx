import { type ContextMenuItem, Icon } from "@aulora/ui-web";
import { type Anchor, type Column, copyText, isColumnFull, savedFields } from "./board-logic";
import type { Board, Card } from "./types";
import type { BoardController } from "./use-board";

function moveWithinColumn(ctl: BoardController, card: Card, siblings: readonly Card[]) {
  const index = siblings.findIndex((entry) => entry._id === card._id);
  const before = index > 0 ? siblings.at(index - 1) : undefined;
  const after = siblings.at(index + 2);
  const moveBefore = (beforeId: Card["_id"] | undefined) => {
    void ctl.run(() =>
      ctl.mutations.move({
        cardId: card._id,
        columnId: card.columnId,
        ...(beforeId === undefined ? {} : { beforeId }),
      }),
    );
  };
  const items: ContextMenuItem[] = [
    {
      id: "up",
      label: "Move up",
      icon: <Icon name="arrow-up" size={14} />,
      separatorBefore: true,
      disabled: ctl.busy || before === undefined,
      onSelect: () => {
        if (before !== undefined) moveBefore(before._id);
      },
    },
    {
      id: "down",
      label: "Move down",
      icon: <Icon name="arrow-down" size={14} />,
      disabled: ctl.busy || index === siblings.length - 1,
      onSelect: () => {
        moveBefore(after?._id);
      },
    },
  ];
  return items;
}

function moveToColumn(ctl: BoardController, board: Board, card: Card): ContextMenuItem[] {
  const others = board.columns.filter((column) => column.id !== card.columnId);
  return others.map((column, index) => ({
    id: `column-${column.id}`,
    label: `Move to ${column.name}`,
    icon: <Icon name="chevron-right" size={14} />,
    separatorBefore: index === 0,
    disabled: ctl.busy,
    onSelect: () => {
      void ctl.run(() => ctl.mutations.move({ cardId: card._id, columnId: column.id }));
    },
  }));
}

function assignToMe(ctl: BoardController, card: Card): ContextMenuItem[] {
  const me = ctl.ownUserId;
  const mine = card.assigneeIds.includes(me);
  if (!mine && !ctl.boardMembers.some((member) => member.userId === me)) return [];
  const assigneeIds = mine ? card.assigneeIds.filter((id) => id !== me) : [...card.assigneeIds, me];
  return [
    {
      id: "assign",
      label: mine ? "Unassign me" : "Assign to me",
      icon: <Icon name="user-plus" size={14} />,
      separatorBefore: true,
      disabled: ctl.busy,
      onSelect: () => {
        void ctl.run(() => ctl.mutations.updateCard({ ...savedFields(card), assigneeIds }));
      },
    },
  ];
}

function timerItem(ctl: BoardController, board: Board, card: Card): ContextMenuItem[] {
  const running = card.timerStartedAt !== undefined;
  const allowed = running ? card.timerUserId === ctl.ownUserId || ctl.canManage : ctl.canEdit;
  if (card.archived || board.archived || !allowed) return [];
  return [
    {
      id: "timer",
      label: running ? "Stop timer" : "Start timer",
      icon: <Icon name={running ? "stop" : "play"} size={14} />,
      disabled: ctl.busy,
      onSelect: () => {
        void ctl.run(() => ctl.mutations.timer({ cardId: card._id, running: !running }));
      },
    },
  ];
}

function keepOrRemove(ctl: BoardController, card: Card): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (ctl.canEdit)
    items.push({
      id: "archive",
      label: card.archived ? "Restore card" : "Archive card",
      icon: <Icon name={card.archived ? "unarchive" : "archive"} size={14} />,
      disabled: ctl.busy,
      onSelect: () => {
        void ctl.run(() =>
          ctl.mutations.archiveCard({ cardId: card._id, archived: !card.archived }),
        );
      },
    });
  if (ctl.canManage)
    items.push({
      id: "delete",
      label: "Delete card…",
      icon: <Icon name="trash" size={14} />,
      danger: true,
      onSelect: () => {
        ctl.setConfirm({ kind: "deleteCard", card });
      },
    });
  return items;
}

function cardItems(ctl: BoardController, board: Board, card: Card, siblings: readonly Card[]) {
  const arrange = ctl.canArrange
    ? [
        ...moveWithinColumn(ctl, card, siblings),
        ...moveToColumn(ctl, board, card),
        ...assignToMe(ctl, card),
      ]
    : [];
  const items: ContextMenuItem[] = [
    {
      id: "open",
      label: "Open card",
      icon: <Icon name="expand" size={14} />,
      onSelect: () => {
        ctl.setSelectedCard(card._id);
      },
    },
    ...arrange,
    ...timerItem(ctl, board, card),
    {
      id: "copy",
      label: "Copy title",
      icon: <Icon name="copy" size={14} />,
      separatorBefore: true,
      onSelect: () => {
        copyText(card.title);
      },
    },
    ...keepOrRemove(ctl, card),
  ];
  return items;
}

/** A card's right-click menu; `siblings` is its column in order. */
export function openCardMenu(
  ctl: BoardController,
  anchor: Anchor,
  card: Card,
  siblings: readonly Card[],
) {
  if (ctl.board === undefined) return;
  ctl.openMenu({
    clientX: anchor.clientX,
    clientY: anchor.clientY,
    items: cardItems(ctl, ctl.board, card, siblings),
    label: `${card.title} actions`,
  });
}

function clearFiltersItem(ctl: BoardController): ContextMenuItem[] {
  if (!ctl.filtering) return [];
  return [
    {
      id: "clear",
      label: "Clear filters",
      icon: <Icon name="x" size={14} />,
      onSelect: ctl.clearFilters,
    },
  ];
}

/** A column's right-click menu. */
export function openColumnMenu(ctl: BoardController, anchor: Anchor, column: Column) {
  const full = isColumnFull(column, ctl.cards ?? []);
  const items: ContextMenuItem[] = [];
  if (ctl.canArrange)
    items.push({
      id: "add",
      label: full ? "Column limit reached" : "Add card",
      icon: <Icon name="plus" size={14} />,
      disabled: full,
      onSelect: () => {
        ctl.setComposing(column.id);
      },
    });
  if (ctl.canManage && ctl.board?.archived !== true)
    items.push({
      id: "columns",
      label: "Edit columns…",
      icon: <Icon name="settings" size={14} />,
      onSelect: () => {
        ctl.setSettings(true);
      },
    });
  items.push(...clearFiltersItem(ctl));
  if (items.length === 0) return;
  ctl.openMenu({
    clientX: anchor.clientX,
    clientY: anchor.clientY,
    items,
    label: `${column.name} actions`,
  });
}

function manageBoard(ctl: BoardController, board: Board): ContextMenuItem[] {
  if (!ctl.canManage) return [];
  const archive: ContextMenuItem = board.archived
    ? {
        id: "restore",
        label: "Restore board",
        icon: <Icon name="unarchive" size={14} />,
        separatorBefore: true,
        onSelect: () => {
          void ctl.run(() => ctl.mutations.archiveBoard({ boardId: board.id, archived: false }));
        },
      }
    : {
        id: "archive",
        label: "Archive board…",
        icon: <Icon name="archive" size={14} />,
        separatorBefore: true,
        onSelect: () => {
          ctl.setConfirm({ kind: "archiveBoard" });
        },
      };
  return [
    archive,
    {
      id: "delete",
      label: "Delete board…",
      icon: <Icon name="trash" size={14} />,
      danger: true,
      onSelect: () => {
        ctl.setConfirm({ kind: "deleteBoard" });
      },
    },
  ];
}

function boardItems(ctl: BoardController, board: Board): ContextMenuItem[] {
  const settings: ContextMenuItem[] =
    ctl.canManage && !board.archived
      ? [
          {
            id: "settings",
            label: "Board settings…",
            icon: <Icon name="settings" size={14} />,
            onSelect: () => {
              ctl.setSettings(true);
            },
          },
        ]
      : [];
  return [
    ...settings,
    {
      id: "github",
      label: ctl.canEdit ? "Add card from GitHub…" : "Browse GitHub…",
      icon: <Icon name="link" size={14} />,
      onSelect: () => {
        ctl.setGithub(true);
      },
    },
    {
      id: "archived-cards",
      label: ctl.archivedCards ? "Show active cards" : "Show archived cards",
      icon: <Icon name="archive" size={14} />,
      onSelect: () => {
        ctl.setArchivedCards(!ctl.archivedCards);
      },
    },
    ...clearFiltersItem(ctl),
    ...manageBoard(ctl, board),
  ];
}

/** The board's own menu, from its actions button or a right-click on the background. */
export function openBoardMenu(ctl: BoardController, anchor: Anchor) {
  if (ctl.board === undefined) return;
  ctl.openMenu({
    clientX: anchor.clientX,
    clientY: anchor.clientY,
    items: boardItems(ctl, ctl.board),
    label: `${ctl.board.name} actions`,
  });
}
