import type { Board, Card } from "./types";

export type Column = Board["columns"][number];

/** Where a menu opens: the pointer for a right-click, or under a pressed button. */
export interface Anchor {
  clientX: number;
  clientY: number;
}

/** Opens a menu under the button that was pressed. */
export function below(target: Element): Anchor {
  const rect = target.getBoundingClientRect();
  return { clientX: rect.left, clientY: rect.bottom + 4 };
}

/** A place in a column: before the given card, or at the end. */
export interface Slot {
  columnId: string;
  beforeId?: Card["_id"];
}

export function sameSlot(a: Slot | undefined, b: Slot | undefined): boolean {
  return a?.columnId === b?.columnId && a?.beforeId === b?.beforeId;
}

export const UNASSIGNED = "unassigned";

export interface CardFilters {
  search: string;
  /** User ids, plus `UNASSIGNED` for cards nobody holds. */
  assignees: string[];
  labels: string[];
  priorities: string[];
}

export const NO_FILTERS: CardFilters = { search: "", assignees: [], labels: [], priorities: [] };

export function isFiltering(filters: CardFilters): boolean {
  const chosen = filters.assignees.length + filters.labels.length + filters.priorities.length;
  return filters.search.trim() !== "" || chosen > 0;
}

function matchesAssignee(card: Card, assignees: readonly string[]): boolean {
  if (assignees.length === 0) return true;
  if (assignees.includes(UNASSIGNED) && card.assigneeIds.length === 0) return true;
  return card.assigneeIds.some((id) => assignees.includes(id));
}

/** Choices inside one filter widen the result; separate filters narrow it. */
export function filterCards(cards: readonly Card[], filters: CardFilters): Card[] {
  const search = filters.search.trim().toLowerCase();
  return cards.filter(
    (card) =>
      `${card.title} ${card.notes}`.toLowerCase().includes(search) &&
      matchesAssignee(card, filters.assignees) &&
      (filters.labels.length === 0 || card.labelIds.some((id) => filters.labels.includes(id))) &&
      (filters.priorities.length === 0 || filters.priorities.includes(card.priority)),
  );
}

export function cardsInColumn(cards: readonly Card[], columnId: string): Card[] {
  return cards.filter((card) => card.columnId === columnId).sort((a, b) => a.position - b.position);
}

/** A column at its work-in-progress limit takes no more active cards. */
export function isColumnFull(column: Column, cards: readonly Card[]): boolean {
  if (column.wipLimit === undefined) return false;
  const active = cards.filter((card) => card.columnId === column.id && !card.archived);
  return active.length >= column.wipLimit;
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

export function shortDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function trackedTime(card: Card, now: number): number {
  if (card.timerStartedAt === undefined) return card.trackedMs;
  return card.trackedMs + Math.max(0, now - card.timerStartedAt);
}

/** Copies text where the browser allows it; plain HTTP pages on a LAN have no clipboard. */
export function copyText(text: string): void {
  if ("clipboard" in navigator) void navigator.clipboard.writeText(text);
}
