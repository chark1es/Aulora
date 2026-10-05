import type { ColorToken } from "@aulora/tokens";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../packages/convex/convex/_generated/api";

/**
 * Pure view helpers for the mobile Kanban board, mirroring the web client's
 * behaviour without importing it. Nothing here talks to the server.
 */

export type Board = FunctionReturnType<typeof api.kanban.listBoards>[number];
export type Card = FunctionReturnType<typeof api.kanban.listCards>[number];
export type Column = Board["columns"][number];
export type Priority = Card["priority"];

export interface BoardMember {
  readonly userId: string;
  readonly displayName: string;
}

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

export interface PriorityInfo {
  readonly label: string;
  /** `idle` is the amber presence color, which is not a palette token. */
  readonly tone: ColorToken | "idle";
}

const NO_PRIORITY: PriorityInfo = { label: "No priority", tone: "text-muted" };
const PRIORITY_INFO = new Map<Priority, PriorityInfo>([
  ["none", NO_PRIORITY],
  ["low", { label: "Low", tone: "text-muted" }],
  ["medium", { label: "Medium", tone: "idle" }],
  ["high", { label: "High", tone: "accent" }],
  ["urgent", { label: "Urgent", tone: "danger" }],
]);

/** How a priority is named and coloured. */
export function priorityInfo(priority: Priority): PriorityInfo {
  return PRIORITY_INFO.get(priority) ?? NO_PRIORITY;
}

export const UNASSIGNED = "unassigned";

export interface CardFilters {
  readonly search: string;
  /** User ids, plus `UNASSIGNED` for cards nobody holds. */
  readonly assignees: readonly string[];
  readonly labels: readonly string[];
  readonly priorities: readonly string[];
}

export const NO_FILTERS: CardFilters = { search: "", assignees: [], labels: [], priorities: [] };

/** How many filters are set, for the badge on the filter button. */
export function filterCount(filters: CardFilters): number {
  return (
    (filters.search.trim() ? 1 : 0) +
    filters.assignees.length +
    filters.labels.length +
    filters.priorities.length
  );
}

/** Choices inside one filter widen the result; separate filters narrow it. */
export function filterCards(cards: readonly Card[], filters: CardFilters): Card[] {
  const search = filters.search.trim().toLowerCase();
  return cards.filter(
    (card) =>
      `${card.title} ${card.notes}`.toLowerCase().includes(search) &&
      (!filters.assignees.length ||
        (filters.assignees.includes(UNASSIGNED) && !card.assigneeIds.length) ||
        card.assigneeIds.some((id) => filters.assignees.includes(id))) &&
      (!filters.labels.length || card.labelIds.some((id) => filters.labels.includes(id))) &&
      (!filters.priorities.length || filters.priorities.includes(card.priority)),
  );
}

export function cardsInColumn(cards: readonly Card[], columnId: string): Card[] {
  return cards.filter((card) => card.columnId === columnId).sort((a, b) => a.position - b.position);
}

/** A column at its work-in-progress limit takes no more active cards. */
export function isColumnFull(column: Column, cards: readonly Card[]): boolean {
  return (
    column.wipLimit !== undefined &&
    cards.filter((card) => card.columnId === column.id && !card.archived).length >= column.wipLimit
  );
}

/** Where `moveCard` should put a card: before another card, or at the end. */
export interface MoveTarget {
  columnId: string;
  beforeId?: Card["_id"];
}

/**
 * The `moveCard` target that shifts a card one place within its column, or
 * `null` when it is already at that end. `siblings` is the column in order.
 */
export function moveStep(
  siblings: readonly Card[],
  cardId: string,
  direction: "up" | "down",
): MoveTarget | null {
  const index = siblings.findIndex((card) => card._id === cardId);
  const card = index < 0 ? undefined : siblings.at(index);
  if (card === undefined) return null;
  if (direction === "up") {
    const before = index > 0 ? siblings.at(index - 1) : undefined;
    return before ? { columnId: card.columnId, beforeId: before._id } : null;
  }
  if (index === siblings.length - 1) return null;
  const after = siblings.at(index + 2);
  return { columnId: card.columnId, ...(after ? { beforeId: after._id } : {}) };
}

/** Card dates are stored as UTC days, so they are compared and shown as days. */
export function dayOf(at: number | undefined): string {
  return at === undefined ? "" : new Date(at).toISOString().slice(0, 10);
}

export function startOfDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function endOfDay(day: string): number {
  return Date.parse(`${day}T23:59:59Z`);
}

/** The viewer's local calendar day as `YYYY-MM-DD`, offset by whole days. */
export function localDay(now: number, offsetDays = 0): string {
  const today = new Date(now);
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays))
    .toISOString()
    .slice(0, 10);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const monthName = (month: number) => MONTHS.at(month) ?? "";

/**
 * "Oct 4" or "Oct 4, 2026" for a `YYYY-MM-DD` day. Built by hand because
 * `Intl` date formatting is slow enough on Android to stall a list of cards.
 */
export function formatDay(day: string, year: "always" | number = "always"): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const text = `${monthName(m - 1).slice(0, 3)} ${d}`;
  return year === "always" || year !== y ? `${text}, ${y}` : text;
}

const DAY_MS = 86400000;

function dayName(days: number): string | null {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return null;
}

export interface DueLabel {
  readonly text: string;
  readonly overdue: boolean;
}

export function dueLabel(at: number, now: number): DueLabel {
  const today = new Date(now);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsed = Date.parse(dayOf(at)) - start;
  const days = Math.round(elapsed / DAY_MS);
  const text = dayName(days) ?? formatDay(dayOf(at), today.getFullYear());
  const overdue = days < 0;
  return { text, overdue };
}

export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return formatDay(localDay(at), new Date(now).getFullYear());
}

export function shortDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "<1m";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function trackedTime(card: Card, now: number): number {
  return (
    card.trackedMs +
    (card.timerStartedAt === undefined ? 0 : Math.max(0, now - card.timerStartedAt))
  );
}

/** The six weeks shown for a month, as `YYYY-MM-DD` days starting on Sunday. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = Date.UTC(year, month, 1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}

export function failure(cause: unknown): string {
  if (!(cause instanceof Error)) return "Could not save. Try again.";
  // Convex wraps a thrown message with the function name and a request id.
  const message = /Uncaught (?:ConvexError|Error): (.+?)(?:\n|\s+at |$)/.exec(cause.message);
  return message?.[1] ?? cause.message;
}

let itemSequence = 0;

/** Unique within one card or board, which is all an item id has to be. */
export function newItemId(): string {
  itemSequence += 1;
  return `${Date.now().toString(36)}-${itemSequence.toString(36)}`;
}

/**
 * The card list as it will look once a move is saved, so the board can show
 * the card in its new place before the server answers.
 */
export function applyMove(
  cards: readonly Card[],
  move: { cardId: string; columnId: string; beforeId?: string },
): Card[] {
  const card = cards.find((entry) => entry._id === move.cardId);
  if (!card) return [...cards];
  const column = cardsInColumn(
    cards.filter((entry) => entry._id !== card._id && !entry.archived),
    move.columnId,
  );
  const index = move.beforeId ? column.findIndex((entry) => entry._id === move.beforeId) : -1;
  column.splice(index < 0 ? column.length : index, 0, card);
  const positions = new Map(column.map((entry, position) => [entry._id, position]));
  return cards.map((entry) => {
    const position = positions.get(entry._id);
    return position === undefined ? entry : { ...entry, columnId: move.columnId, position };
  });
}

/** The card list with one card's timer started or stopped, ahead of the server. */
export function applyTimer(
  cards: readonly Card[],
  change: { cardId: string; running: boolean },
  userId: string,
  now: number,
): Card[] {
  return cards.map((card) => {
    if (card._id !== change.cardId) return card;
    if (change.running) return { ...card, timerStartedAt: now, timerUserId: userId };
    const { timerStartedAt, timerUserId, ...rest } = card;
    // A card with no running timer has nothing to stop.
    if (timerStartedAt === undefined || timerUserId === undefined) return card;
    return { ...rest, trackedMs: card.trackedMs + Math.max(0, now - timerStartedAt) };
  });
}
