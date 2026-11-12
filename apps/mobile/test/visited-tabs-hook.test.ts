import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  slot: 0,
  changed: false,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", () => {
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const slot = hooks.slot++;
    const previous = hooks.cells[slot] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
      hooks.cells[slot] = { deps, value: factory() };
    }
    return (hooks.cells[slot] as { value: unknown }).value;
  };
  return {
    useState: (initial: unknown) => {
      const slot = hooks.slot++;
      if (!(slot in hooks.cells)) {
        hooks.cells[slot] = typeof initial === "function" ? initial() : initial;
      }
      return [
        hooks.cells[slot],
        (next: unknown) => {
          const value = typeof next === "function" ? next(hooks.cells[slot]) : next;
          if (value !== hooks.cells[slot]) hooks.changed = true;
          hooks.cells[slot] = value;
        },
      ];
    },
    useMemo: memo,
    useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
      const slot = hooks.slot++;
      const previous = hooks.cells[slot] as
        | { deps: readonly unknown[]; cleanup?: () => void }
        | undefined;
      if (previous && deps.every((dep, index) => dep === previous.deps[index])) {
        return;
      }
      if (previous?.cleanup !== undefined) hooks.cleanups.push(previous.cleanup);
      const cell: { deps: readonly unknown[]; cleanup?: () => void } = { deps };
      hooks.cells[slot] = cell;
      hooks.effects.push(() => {
        const cleanup = effect();
        if (typeof cleanup === "function") cell.cleanup = cleanup as () => void;
      });
    },
  };
});

import { threadInboxQueryArgs } from "../src/lib/thread-inbox-query";
import { HIDDEN_TAB_TTL_MS, useRetainedTabs } from "../src/lib/visited-tabs";

const TABS = ["chats", "dms", "boards", "notes", "threads", "you"] as const;
type Tab = (typeof TABS)[number];

let active: Tab = "chats";
let holdTab: Tab | undefined;
let retained: readonly Tab[] = [];

function render(): void {
  do {
    hooks.changed = false;
    hooks.slot = 0;
    hooks.effects = [];
    // biome-ignore lint/correctness/useHookAtTopLevel: this loop simulates native renders with stable hook cells.
    retained = useRetainedTabs(TABS, active, { holdTab });
    for (const cleanup of hooks.cleanups) cleanup();
    hooks.cleanups = [];
    for (const effect of hooks.effects) effect();
  } while (hooks.changed);
}

function go(tab: Tab, hold: Tab | undefined): readonly Tab[] {
  active = tab;
  holdTab = hold;
  render();
  return retained;
}

function expire(): readonly Tab[] {
  vi.advanceTimersByTime(HIDDEN_TAB_TTL_MS);
  render();
  return retained;
}

function parentThreads(kept: readonly Tab[]) {
  return threadInboxQueryArgs(true, kept.includes("threads"), true);
}

beforeEach(() => {
  vi.useFakeTimers();
  active = "chats";
  holdTab = undefined;
  retained = [];
  hooks.cells = [];
  hooks.cleanups = [];
  hooks.changed = false;
});

describe("useRetainedTabs with a dirty Notes draft", () => {
  it("expires a hidden heavy page while Notes is the active dirty surface", () => {
    go("threads", undefined);
    expect(retained).toContain("threads");
    go("notes", "notes");
    expect([...retained].sort()).toEqual(["notes", "threads"]);

    // The active draft is retained because it is active, not because the hold
    // shields the whole set; Threads must leave after the lifetime.
    const kept = expire();
    expect(kept).toEqual(["notes"]);
    expect(parentThreads(kept)).toEqual({ legacy: "skip", page: "skip" });
  });

  it("keeps a hidden dirty Notes draft but expires another hidden heavy page", () => {
    go("threads", undefined);
    go("notes", "notes");
    go("you", "notes");
    expect([...retained].sort()).toEqual(["notes", "threads", "you"]);

    const kept = expire();
    expect([...kept].sort()).toEqual(["notes", "you"]);
    // The parent Threads query no longer follows the expired page.
    expect(parentThreads(kept)).toEqual({ legacy: "skip", page: "skip" });

    // Discarding the draft lets the retained Notes tab expire too.
    go("you", undefined);
    expect(expire()).toEqual(["you"]);
  });
});
