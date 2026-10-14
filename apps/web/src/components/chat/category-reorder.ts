import type { CategoryView } from "../../lib/workspace-admin";

/** One persisted category position, as sent to `categories.reorder`. */
export interface CategoryMove {
  readonly categoryId: string;
  readonly position: number;
}

/** Whether a dragged category lands above or below the header it was dropped on. */
export type CategoryDropPlacement = "before" | "after";

/**
 * Computes the batch of category positions for a drag that drops `draggedId`
 * before/after `targetId`. Positions are renumbered contiguously from zero.
 * Returns `null` for an invalid drop (same header, unknown id) or one that
 * leaves the order unchanged, so callers can skip the write.
 */
export function computeCategoryReorder(
  categories: readonly CategoryView[],
  draggedId: string,
  targetId: string,
  placement: CategoryDropPlacement,
): CategoryMove[] | null {
  if (draggedId === targetId) {
    return null;
  }
  const ordered = [...categories].sort((a, b) => a.position - b.position);
  const dragged = ordered.find((category) => category.id === draggedId);
  if (dragged === undefined) {
    return null;
  }
  const withoutDragged = ordered.filter((category) => category.id !== draggedId);
  const targetIndex = withoutDragged.findIndex((category) => category.id === targetId);
  if (targetIndex === -1) {
    return null;
  }
  const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
  const next = [...withoutDragged];
  next.splice(insertAt, 0, dragged);
  if (next.every((category, index) => category.id === ordered.at(index)?.id)) {
    return null;
  }
  return next.map((category, position) => ({ categoryId: category.id, position }));
}
