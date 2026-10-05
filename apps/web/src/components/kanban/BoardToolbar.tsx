import { Button, Icon } from "@aulora/ui-web";
import { UNASSIGNED } from "./board-logic";
import {
  ChecklistMenu,
  FilterTrigger,
  filterChip,
  PRIORITIES,
  PriorityFlag,
  personOptions,
  priorityInfo,
} from "./controls";
import type { Board } from "./types";
import type { BoardController } from "./use-board";

interface Props {
  ctl: BoardController;
  board: Board;
}

function SearchBox({ ctl }: { ctl: BoardController }) {
  return (
    <label className="relative min-w-[160px] max-w-[280px] flex-1">
      <Icon
        name="search"
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        aria-label="Search cards"
        placeholder="Search cards"
        value={ctl.filters.search}
        onChange={(event) => {
          ctl.setFilters({ ...ctl.filters, search: event.target.value });
        }}
        className="h-8 w-full rounded-[8px] border border-border bg-surface-2 pl-8 pr-2.5 text-[13px] text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      />
    </label>
  );
}

function AssigneeFilter({ ctl }: { ctl: BoardController }) {
  const { filters } = ctl;
  const unassigned = {
    id: UNASSIGNED,
    label: "Unassigned",
    leading: (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-text-muted/60" />
    ),
  };
  return (
    <ChecklistMenu
      label="Filter by assignee"
      options={[unassigned, ...personOptions(ctl.boardMembers, [])]}
      selected={filters.assignees}
      onChange={(assignees) => {
        ctl.setFilters({ ...filters, assignees });
      }}
      searchPlaceholder="Find a person"
      triggerClassName={filterChip(filters.assignees.length > 0)}
      trigger={<FilterTrigger icon="users" label="Assignee" count={filters.assignees.length} />}
    />
  );
}

function LabelFilter({ ctl, board }: Props) {
  const { filters } = ctl;
  return (
    <ChecklistMenu
      label="Filter by label"
      options={board.labels.map((label) => ({
        id: label.id,
        label: label.name,
        leading: (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: label.color }}
          />
        ),
      }))}
      selected={filters.labels}
      onChange={(labels) => {
        ctl.setFilters({ ...filters, labels });
      }}
      emptyText="This board has no labels yet"
      triggerClassName={filterChip(filters.labels.length > 0)}
      trigger={<FilterTrigger icon="label" label="Label" count={filters.labels.length} />}
    />
  );
}

function PriorityFilter({ ctl }: { ctl: BoardController }) {
  const { filters } = ctl;
  return (
    <ChecklistMenu
      label="Filter by priority"
      options={[...PRIORITIES].reverse().map((priority) => ({
        id: priority,
        label: priorityInfo(priority).label,
        leading: <PriorityFlag priority={priority} />,
      }))}
      selected={filters.priorities}
      onChange={(priorities) => {
        ctl.setFilters({ ...filters, priorities });
      }}
      triggerClassName={filterChip(filters.priorities.length > 0)}
      trigger={<FilterTrigger icon="flag" label="Priority" count={filters.priorities.length} />}
    />
  );
}

function cardCount(ctl: BoardController): string {
  const total = ctl.inView.length;
  const shown = ctl.filtering ? `${ctl.filtered.length} of ${total}` : String(total);
  if (ctl.archivedCards) return `${shown} archived`;
  return `${shown} ${total === 1 ? "card" : "cards"}`;
}

/** Search and the three checklist filters, with a running count of cards. */
export function BoardToolbar({ ctl, board }: Props) {
  return (
    <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <SearchBox ctl={ctl} />
      <AssigneeFilter ctl={ctl} />
      <LabelFilter ctl={ctl} board={board} />
      <PriorityFilter ctl={ctl} />
      {ctl.filtering && (
        <Button size="sm" variant="ghost" className="animate-fade-in" onClick={ctl.clearFilters}>
          Clear
        </Button>
      )}
      <span className="ml-auto text-xs tabular-nums text-text-muted">{cardCount(ctl)}</span>
    </div>
  );
}

/** Says why the board cannot be changed, with the way back. */
export function ArchivedBanner({ ctl, board }: Props) {
  if (!board.archived && !ctl.archivedCards) return null;
  return (
    <div className="flex shrink-0 animate-fade-in items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[13px] text-text-muted">
      <Icon name="archive" size={14} />
      <p className="flex-1">
        {board.archived
          ? "This board is archived. Restore it to make changes."
          : "Showing archived cards. Open or right-click a card to restore it."}
      </p>
      {board.archived && ctl.canManage && (
        <Button
          size="sm"
          variant="secondary"
          loading={ctl.busy}
          onClick={() => {
            void ctl.run(() => ctl.mutations.archiveBoard({ boardId: board.id, archived: false }));
          }}
        >
          Restore board
        </Button>
      )}
      {!board.archived && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            ctl.setArchivedCards(false);
          }}
        >
          Back to active cards
        </Button>
      )}
    </div>
  );
}
