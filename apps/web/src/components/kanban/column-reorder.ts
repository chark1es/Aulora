/** Anything with a stable `id`, such as a board column. */
interface Identified {
  readonly id: string;
}

/** Whether a dragged column lands above or below the row it was dropped on. */
export type ColumnDropPlacement = "before" | "after";

function sameOrder<T extends Identified>(first: readonly T[], second: readonly T[]): boolean {
  return (
    first.length === second.length && first.every((item, index) => item.id === second.at(index)?.id)
  );
}

/**
 * The columns with `draggedId` moved before or after `targetId`, or `null` when
 * the drop changes nothing (same row, unknown id) so no write is needed. The
 * order is the stored order: `kanban.updateBoard` persists the column array as
 * it arrives, so reordering is just a matter of handing it back in a new order.
 */
export function reorderColumns<T extends Identified>(
  columns: readonly T[],
  draggedId: string,
  targetId: string,
  placement: ColumnDropPlacement,
): T[] | null {
  if (draggedId === targetId) return null;
  const dragged = columns.find((column) => column.id === draggedId);
  if (dragged === undefined) return null;
  const rest = columns.filter((column) => column.id !== draggedId);
  const targetIndex = rest.findIndex((column) => column.id === targetId);
  if (targetIndex === -1) return null;
  const next = [...rest];
  next.splice(placement === "before" ? targetIndex : targetIndex + 1, 0, dragged);
  return sameOrder(columns, next) ? null : next;
}

/**
 * The columns with `id` moved `delta` places (negative moves it up), or `null`
 * when it is missing or already at the edge. This is the keyboard shortcut
 * behind the grip handle, kept next to {@link reorderColumns} so both paths
 * share one definition of "the new order".
 */
export function moveColumnBy<T extends Identified>(
  columns: readonly T[],
  id: string,
  delta: number,
): T[] | null {
  const from = columns.findIndex((column) => column.id === id);
  const to = from + delta;
  if (from === -1 || delta === 0 || to < 0 || to >= columns.length) return null;
  const next = [...columns];
  const moved = next.splice(from, 1);
  next.splice(to, 0, ...moved);
  return next;
}
