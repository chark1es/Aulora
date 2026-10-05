import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyTimer,
  type Card,
  type Column,
  cardsInColumn,
  dueLabel,
  filterCards,
  filterCount,
  formatDay,
  isColumnFull,
  localDay,
  monthGrid,
  moveStep,
  NO_FILTERS,
  shortDuration,
  UNASSIGNED,
} from "../src/lib/kanban";

function card(id: string, patch: Partial<Card> = {}): Card {
  return {
    _id: id,
    _creationTime: 0,
    boardId: "board",
    title: id,
    notes: "",
    checklist: [],
    githubLinks: [],
    columnId: "todo",
    position: 0,
    labelIds: [],
    assigneeIds: [],
    priority: "none",
    fileIds: [],
    creatorId: "alice",
    archived: false,
    trackedMs: 0,
    updatedAt: 0,
    revision: 0,
    ...patch,
  } as Card;
}
const order = (cards: readonly Card[], columnId: string) =>
  cardsInColumn(cards, columnId).map((entry) => entry._id);

describe("filterCards", () => {
  const cards = [
    card("login", { title: "Fix login", assigneeIds: ["alice"], labelIds: ["bug"] }),
    card("docs", { notes: "Explain login flow", priority: "high" }),
    card("ship", { assigneeIds: ["bob"], labelIds: ["bug"], priority: "urgent" }),
  ];
  const ids = (filters: Partial<typeof NO_FILTERS>) =>
    filterCards(cards, { ...NO_FILTERS, ...filters }).map((entry) => entry._id);

  it("searches titles and notes without regard to case", () => {
    expect(ids({ search: " LOGIN " })).toEqual(["login", "docs"]);
  });
  it("widens within one filter and narrows across filters", () => {
    expect(ids({ assignees: ["alice", "bob"] })).toEqual(["login", "ship"]);
    expect(ids({ assignees: ["alice", "bob"], priorities: ["urgent"] })).toEqual(["ship"]);
    expect(ids({ labels: ["bug"], search: "fix" })).toEqual(["login"]);
  });
  it("finds cards nobody holds", () => {
    expect(ids({ assignees: [UNASSIGNED] })).toEqual(["docs"]);
    expect(ids({ assignees: [UNASSIGNED, "bob"] })).toEqual(["docs", "ship"]);
  });
  it("counts each choice and the search once", () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(
      filterCount({ search: "x", assignees: ["a", "b"], labels: [], priorities: ["low"] }),
    ).toBe(4);
  });
});

describe("moving cards", () => {
  const cards = [
    card("a", { position: 0 }),
    card("b", { position: 1 }),
    card("c", { position: 2 }),
    card("d", { columnId: "done", position: 0 }),
  ];
  const column = cardsInColumn(cards, "todo");

  it("steps a card one place and stops at either end", () => {
    expect(moveStep(column, "a", "up")).toBeNull();
    expect(moveStep(column, "b", "up")).toEqual({ columnId: "todo", beforeId: "a" });
    expect(moveStep(column, "a", "down")).toEqual({ columnId: "todo", beforeId: "c" });
    expect(moveStep(column, "b", "down")).toEqual({ columnId: "todo" });
    expect(moveStep(column, "c", "down")).toBeNull();
  });
  it("previews a move within a column", () => {
    const moved = applyMove(cards, { cardId: "c", columnId: "todo", beforeId: "a" });
    expect(order(moved, "todo")).toEqual(["c", "a", "b"]);
  });
  it("previews a move to the end of another column", () => {
    const moved = applyMove(cards, { cardId: "a", columnId: "done" });
    expect(order(moved, "todo")).toEqual(["b", "c"]);
    expect(order(moved, "done")).toEqual(["d", "a"]);
  });
  it("leaves the list alone when the card is unknown", () => {
    expect(applyMove(cards, { cardId: "missing", columnId: "done" })).toEqual(cards);
  });
  it("counts only active cards against a column limit", () => {
    const limited: Column = { id: "todo", name: "To do", wipLimit: 3 };
    expect(isColumnFull(limited, cards)).toBe(true);
    expect(isColumnFull(limited, [...cards.slice(1), card("a", { archived: true })])).toBe(false);
    expect(isColumnFull({ id: "todo", name: "To do" }, cards)).toBe(false);
  });
});

describe("timers", () => {
  it("starts a timer for the viewer and banks the time when it stops", () => {
    const started = applyTimer([card("a")], { cardId: "a", running: true }, "alice", 1000);
    expect(started[0]).toMatchObject({ timerStartedAt: 1000, timerUserId: "alice" });
    const stopped = applyTimer(started, { cardId: "a", running: false }, "alice", 61_000);
    expect(stopped[0]?.timerStartedAt).toBeUndefined();
    expect(stopped[0]?.timerUserId).toBeUndefined();
    expect(stopped[0]?.trackedMs).toBe(60_000);
  });
  it("shows short durations in minutes and hours", () => {
    expect(shortDuration(20_000)).toBe("<1m");
    expect(shortDuration(5 * 60_000)).toBe("5m");
    expect(shortDuration(135 * 60_000)).toBe("2h 15m");
  });
});

describe("dates", () => {
  const now = new Date(2026, 9, 3, 15).getTime();
  const at = (day: string) => Date.parse(`${day}T23:59:59Z`);

  it("names the days around today and flags the past as overdue", () => {
    expect(dueLabel(at("2026-10-03"), now)).toEqual({ text: "Today", overdue: false });
    expect(dueLabel(at("2026-10-04"), now)).toEqual({ text: "Tomorrow", overdue: false });
    expect(dueLabel(at("2026-10-02"), now)).toEqual({ text: "Yesterday", overdue: true });
    expect(dueLabel(at("2026-09-01"), now).overdue).toBe(true);
  });
  it("writes days out without the year when it is the current one", () => {
    expect(formatDay("2026-10-04")).toBe("Oct 4, 2026");
    expect(formatDay("2026-10-04", 2026)).toBe("Oct 4");
    expect(formatDay("2027-01-09", 2026)).toBe("Jan 9, 2027");
    expect(dueLabel(at("2026-12-25"), now).text).toBe("Dec 25");
  });
  it("offsets the local day across a month end", () => {
    expect(localDay(now)).toBe("2026-10-03");
    expect(localDay(now, 7)).toBe("2026-10-10");
    expect(localDay(new Date(2026, 9, 31, 9).getTime(), 1)).toBe("2026-11-01");
  });
  it("lays a month out as six weeks starting on Sunday", () => {
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-27");
    expect(grid).toContain("2026-10-31");
    expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(0);
  });
});
