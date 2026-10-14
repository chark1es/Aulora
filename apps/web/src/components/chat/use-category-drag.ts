/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { useRef, useState } from "react";
import type { CategoryView } from "../../lib/workspace-admin";
import {
  type CategoryDropPlacement,
  type CategoryMove,
  computeCategoryReorder,
} from "./category-reorder";

/**
 * The drag MIME type that marks a category header drag. It keeps category
 * reordering distinct from channel reordering, which carries `text/plain`.
 */
export const CATEGORY_DRAG_TYPE = "application/x-aulora-category";

/** A category header's drop position: above or below the hovered header. */
export interface CategoryDropTarget {
  readonly categoryId: string;
  readonly placement: CategoryDropPlacement;
}

/** The drag attributes a category header hands to `SectionHeader`. */
export interface CategoryHeaderDrag {
  readonly dragging: boolean;
  readonly dropPlacement: CategoryDropPlacement | null;
  readonly onDragStart: (_event: React.DragEvent) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (_event: React.DragEvent) => void;
  readonly onDragLeave: (_event: React.DragEvent) => void;
  readonly onDrop: (_event: React.DragEvent) => void;
}

interface CategoryDragState {
  readonly dragCategoryId: string | null;
  readonly dropTarget: CategoryDropTarget | null;
}

export interface CategoryDrag {
  readonly dragCategoryId: string | null;
  readonly dropTarget: CategoryDropTarget | null;
  /** True while a drag is in flight, including the click that trails a drop. */
  readonly isDragging: () => boolean;
  readonly headerDrag: (categoryId: string) => CategoryHeaderDrag;
}

interface CategoryDragOptions {
  readonly categories: readonly CategoryView[];
  readonly canReorder: boolean;
  readonly onReorderCategories: ((moves: readonly CategoryMove[]) => void) | undefined;
}

/** The drop position for a pointer at `clientY` over a header's bounding box. */
function placementAt(
  event: React.DragEvent,
  currentTarget: EventTarget | null,
): CategoryDropPlacement {
  const rect = (currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/** Drag-and-drop reordering of category headers. Mirrors {@link useChannelDrag}. */
export function useCategoryDrag(options: CategoryDragOptions): CategoryDrag {
  const [state, setState] = useState<CategoryDragState>({
    dragCategoryId: null,
    dropTarget: null,
  });
  const draggingRef = useRef(false);
  const { categories, canReorder, onReorderCategories } = options;

  const clearDrag = () => {
    setState({ dragCategoryId: null, dropTarget: null });
  };

  const endDrag = () => {
    clearDrag();
    // Let any trailing click from the drag settle before re-enabling toggles.
    window.setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };

  const headerDrag = (categoryId: string): CategoryHeaderDrag => ({
    dragging: state.dragCategoryId === categoryId,
    dropPlacement: state.dropTarget?.categoryId === categoryId ? state.dropTarget.placement : null,
    onDragStart: (event) => {
      if (!canReorder) {
        return;
      }
      draggingRef.current = true;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CATEGORY_DRAG_TYPE, categoryId);
      setState((current) => ({ ...current, dragCategoryId: categoryId }));
    },
    onDragEnd: endDrag,
    onDragOver: (event) => {
      if (!canReorder || state.dragCategoryId === null) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const placement = placementAt(event, event.currentTarget);
      setState((current) =>
        current.dropTarget?.categoryId === categoryId && current.dropTarget.placement === placement
          ? current
          : { ...current, dropTarget: { categoryId, placement } },
      );
    },
    onDragLeave: (event) => {
      const next = event.relatedTarget as Node | null;
      if (next !== null && (event.currentTarget as HTMLElement).contains(next)) {
        return;
      }
      setState((current) =>
        current.dropTarget?.categoryId === categoryId ? { ...current, dropTarget: null } : current,
      );
    },
    onDrop: (event) => {
      const draggedId = state.dragCategoryId;
      clearDrag();
      if (draggedId === null || onReorderCategories === undefined) {
        return;
      }
      event.preventDefault();
      const placement = placementAt(event, event.currentTarget);
      const moves = computeCategoryReorder(categories, draggedId, categoryId, placement);
      if (moves !== null) {
        onReorderCategories(moves);
      }
    },
  });

  return {
    dragCategoryId: state.dragCategoryId,
    dropTarget: state.dropTarget,
    isDragging: () => draggingRef.current,
    headerDrag,
  };
}
