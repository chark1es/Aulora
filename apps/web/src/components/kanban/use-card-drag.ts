import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { isColumnFull, type Slot, sameSlot } from "./board-logic";
import type { Card } from "./types";
import type { BoardController } from "./use-board";

/** The card being dragged, its size, and where it started. */
interface Drag {
  id: Card["_id"];
  height: number;
  home: Slot;
}

/** The card the pointer is above the middle of, if any: the dragged card lands before it. */
function cardUnderPointer(column: HTMLElement, clientY: number): Card["_id"] | undefined {
  for (const tile of column.querySelectorAll<HTMLElement>("[data-card]")) {
    const box = tile.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return tile.dataset.card as Card["_id"];
  }
  return undefined;
}

/**
 * Dragging a card between and within columns. While a card is dragged it steps
 * out of its list, and a placeholder of the same size shows where it will land.
 */
export function useCardDrag(ctl: BoardController) {
  const [drag, setDrag] = useState<Drag>();
  const [target, setTarget] = useState<Slot>();
  const frame = useRef(0);
  const dropping = useRef(false);
  const end = () => {
    cancelAnimationFrame(frame.current);
    dropping.current = false;
    setDrag(undefined);
    setTarget(undefined);
  };
  // Every write ends the drag, so the placeholder goes once a move is saved or fails.
  ctl.settled.current = end;

  /** A column at its limit takes no more cards, but its own cards can still be reordered. */
  const blocked = (columnId: string) => {
    const column = ctl.board?.columns.find((entry) => entry.id === columnId);
    if (drag === undefined || column === undefined || drag.home.columnId === columnId) return false;
    return isColumnFull(column, ctl.cards ?? []);
  };
  const start = (card: Card, siblings: readonly Card[], height: number) => {
    const next = siblings.at(siblings.findIndex((entry) => entry._id === card._id) + 1);
    const home: Slot = { columnId: card.columnId, ...(next ? { beforeId: next._id } : {}) };
    // Wait a frame so the browser's drag image still shows the whole card.
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setDrag({ id: card._id, height, home });
      setTarget(home);
    });
  };
  /** Follows the pointer: the card lands above the first card whose middle is below it. */
  const hover = (event: DragEvent<HTMLElement>, columnId: string) => {
    if (!ctl.canArrange || drag === undefined) return;
    event.stopPropagation();
    const beforeId = cardUnderPointer(event.currentTarget, event.clientY);
    const next: Slot = { columnId, ...(beforeId === undefined ? {} : { beforeId }) };
    if (blocked(columnId)) event.dataTransfer.dropEffect = "none";
    else event.preventDefault();
    setTarget((current) => (sameSlot(current, next) ? current : next));
  };
  /** Drops the card where the placeholder is shown. */
  const drop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (drag === undefined || target === undefined || !ctl.canArrange || ctl.busy) return;
    if (sameSlot(target, drag.home) || blocked(target.columnId)) {
      end();
      return;
    }
    // Keep the placeholder until the move is saved, so the card does not jump back first.
    dropping.current = true;
    void ctl.run(() => ctl.mutations.move({ cardId: drag.id, ...target }));
  };
  const refusedColumn = target !== undefined && blocked(target.columnId) ? target.columnId : null;
  return {
    drag,
    /** Where the placeholder goes; a refused card stays where it was. */
    landing: drag !== undefined && refusedColumn !== null ? drag.home : target,
    refusedColumn,
    start,
    hover,
    drop,
    /** The browser ends the drag right after a drop; the placeholder waits for the save. */
    release: () => {
      if (!dropping.current) end();
    },
    /** Whether a drop on the board's background would be accepted. */
    accepts: drag !== undefined && target !== undefined && refusedColumn === null,
  };
}

export type CardDrag = ReturnType<typeof useCardDrag>;
