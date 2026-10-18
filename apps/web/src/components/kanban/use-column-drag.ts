import type { DragEvent } from "react";
import { useState } from "react";
import type { Column } from "./board-logic";
import { type ColumnDropPlacement, reorderColumns } from "./column-reorder";

/**
 * The drag MIME type that marks a settings column drag. It keeps reordering the
 * board's columns apart from dragging cards, which carry `text/plain`.
 */
export const COLUMN_DRAG_TYPE = "application/x-aulora-kanban-column";

/** The drag attributes a settings row hands to its handle and its list item. */
export interface ColumnRowDrag {
  /** True for the row that is being dragged. */
  readonly dragging: boolean;
  /** Where the drop line shows on this row, or `null` when it is not the target. */
  readonly dropPlacement: ColumnDropPlacement | null;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

/** A row's drop position: above the pointer lands before it, below lands after. */
function placementAt(event: DragEvent<HTMLElement>): ColumnDropPlacement {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? "before" : "after";
}

interface ColumnDragOptions {
  readonly columns: readonly Column[];
  readonly onReorder: (columns: Column[]) => void;
}

/**
 * Native drag-and-drop reordering of the settings column list. The handle
 * starts the drag, the row accepts it, and the drop reports the new order to
 * the caller, which holds the board draft. Mirrors the chat category drag.
 */
export function useColumnDrag({ columns, onReorder }: ColumnDragOptions) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    readonly columnId: string;
    readonly placement: ColumnDropPlacement;
  } | null>(null);

  const clear = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const rowDrag = (columnId: string): ColumnRowDrag => ({
    dragging: dragId === columnId,
    dropPlacement:
      dragId !== null && dropTarget?.columnId === columnId ? dropTarget.placement : null,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(COLUMN_DRAG_TYPE, columnId);
      setDragId(columnId);
    },
    onDragEnd: clear,
    onDragOver: (event) => {
      // The row cannot land on itself, so it never shows a drop line.
      if (dragId === null || dragId === columnId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const placement = placementAt(event);
      setDropTarget((current) =>
        current?.columnId === columnId && current.placement === placement
          ? current
          : { columnId, placement },
      );
    },
    onDragLeave: (event) => {
      const next = event.relatedTarget as Node | null;
      if (next !== null && event.currentTarget.contains(next)) return;
      setDropTarget((current) => (current?.columnId === columnId ? null : current));
    },
    onDrop: (event) => {
      const draggedId = dragId;
      clear();
      if (draggedId === null) return;
      event.preventDefault();
      const next = reorderColumns(columns, draggedId, columnId, placementAt(event));
      if (next !== null) onReorder(next);
    },
  });

  return { rowDrag };
}
