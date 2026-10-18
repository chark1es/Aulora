import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { BoardSettings } from "../components/kanban/BoardSettings";
import type { Board, BoardMember, Card } from "../components/kanban/types";
import { applyTheme, type ResolvedTheme } from "../lib/theme";

/**
 * Dev-only visual harness for the Kanban board settings. It renders the real
 * {@link BoardSettings} over fixtures so the column list can be checked (and
 * captured) in both themes without a running backend. Registered at
 * `/__preview/kanban` only in development builds.
 *
 * The theme follows the query string, which keeps the screenshots
 * reproducible:
 *
 *   /__preview/kanban?theme=light
 *   /__preview/kanban?theme=dark
 */

const BOARD = {
  id: "preview-board",
  name: "Website launch",
  description: "Everything shipping this quarter, tracked end to end.",
  columns: [
    { id: "backlog", name: "Backlog" },
    { id: "design", name: "Design", wipLimit: 3 },
    { id: "build", name: "In progress", wipLimit: 4 },
    { id: "review", name: "Review" },
    { id: "done", name: "Done" },
  ],
  labels: [
    { id: "bug", name: "Bug", color: "#d70015" },
    { id: "design", name: "Design", color: "#5856d6" },
  ],
  private: false,
  memberIds: [],
  archived: false,
  updatedAt: 1,
} as unknown as Board;

/** A card per column with the shape the count reads; only `columnId` matters here. */
const CARDS = [
  { _id: "c1", columnId: "backlog" },
  { _id: "c2", columnId: "backlog" },
  { _id: "c3", columnId: "backlog" },
  { _id: "c4", columnId: "design" },
  { _id: "c5", columnId: "design" },
  { _id: "c6", columnId: "build" },
  { _id: "c7", columnId: "build" },
  { _id: "c8", columnId: "build" },
  { _id: "c9", columnId: "build" },
  { _id: "c10", columnId: "review" },
  { _id: "c11", columnId: "done" },
  { _id: "c12", columnId: "done" },
] as unknown as Card[];

const MEMBERS: readonly BoardMember[] = [
  { userId: "alice", displayName: "Alice Reed" },
  { userId: "bob", displayName: "Bob Chen" },
];

/** The theme named in `?theme=`, defaulting to light. */
function initialTheme(): ResolvedTheme {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("theme");
  return value === "dark" ? "dark" : "light";
}

export function KanbanPreviewRoute() {
  const [theme, setTheme] = useState<ResolvedTheme>(initialTheme);
  const convex = useMemo(() => new ConvexReactClient("http://127.0.0.1:9"), []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <ConvexProvider client={convex}>
      <div className="fixed right-3 top-3 z-[60] flex gap-1.5">
        {(["light", "dark"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => {
              setTheme(value);
            }}
            className={
              theme === value
                ? "rounded-[7px] bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent"
                : "rounded-[7px] bg-surface-2 px-3 py-1.5 text-[13px] text-text-muted shadow"
            }
          >
            {value === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <BoardSettings board={BOARD} members={MEMBERS} cards={CARDS} onClose={() => undefined} />
    </ConvexProvider>
  );
}
