import { avatarHead } from "@aulora/avatars";
import { Button, cn, Icon, IconButton } from "@aulora/ui-web";
import { type DragEvent, type KeyboardEvent, useId, useMemo, useState } from "react";
import type { Column } from "./board-logic";
import { moveColumnBy } from "./column-reorder";
import { type Card, newItemId } from "./types";
import { type ColumnRowDrag, useColumnDrag } from "./use-column-drag";

/** `kanban.updateBoard` rejects a board with more than this many columns. */
const MAX_COLUMNS = 20;

/** How many cards sit in each column, including archived ones. */
function countByColumn(cards: readonly Card[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.columnId, (counts.get(card.columnId) ?? 0) + 1);
  return counts;
}

/** The column with its work-in-progress limit set, or cleared. */
function withWipLimit(column: Column, wipLimit: number | undefined): Column {
  return wipLimit === undefined
    ? { id: column.id, name: column.name }
    : { id: column.id, name: column.name, wipLimit };
}

/** Six dots in two columns: the grab affordance for a reorderable row. */
function GripDots() {
  return (
    <svg
      viewBox="0 0 10 16"
      width="10"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {[3, 8, 13].map((y) => (
        <g key={y}>
          <circle cx="2.5" cy={y} r="1.4" />
          <circle cx="7.5" cy={y} r="1.4" />
        </g>
      ))}
    </svg>
  );
}

/** The column's own colour: the pastel its blobatar wears, readable on either theme. */
function ColumnDot({ seed }: { seed: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
      style={{ backgroundColor: avatarHead(seed, "light") }}
    />
  );
}

/** The card tally, shown beside the WIP limit it is measured against. */
function CardCount({ count, limit }: { count: number; limit: number | undefined }) {
  return (
    <span
      data-column-count
      title={`${count} cards, including archived`}
      className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium tabular-nums text-text-muted"
    >
      {count}
      {limit !== undefined ? ` / ${limit}` : ""}
    </span>
  );
}

interface GripHandleProps {
  label: string;
  grabbed: boolean;
  describedBy: string;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

/** The grab handle: drag it with a pointer, or drive it with the keyboard. */
function GripHandle({
  label,
  grabbed,
  describedBy,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: GripHandleProps) {
  return (
    <button
      type="button"
      draggable
      aria-label={label}
      aria-pressed={grabbed}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-[7px] text-text-muted motion-safe:transition",
        "hover:bg-surface-3 hover:text-text active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-1",
        grabbed && "cursor-grabbing bg-accent-soft text-accent ring-1 ring-accent/40",
      )}
    >
      <GripDots />
    </button>
  );
}

interface ColumnRowProps {
  boardId: string;
  column: Column;
  index: number;
  cardCount: number | undefined;
  drag: ColumnRowDrag;
  grabbed: boolean;
  canRemove: boolean;
  describedBy: string;
  onRename: (name: string) => void;
  onWipLimit: (wipLimit: number | undefined) => void;
  onRemove: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** One column: its handle, colour, name, tally, WIP limit and remove button. */
function ColumnRow(props: ColumnRowProps) {
  const { boardId, column, index, cardCount, drag, grabbed, describedBy } = props;
  return (
    <li
      data-column-row={column.id}
      data-dragging={drag.dragging || undefined}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
      className={cn(
        "group relative flex items-center gap-1.5 rounded-[10px] border border-border bg-surface-1 py-1 pl-1 pr-1.5",
        "motion-safe:transition hover:border-text-muted/30 hover:bg-surface-2",
        drag.dragging &&
          "border-accent/60 bg-surface-2 shadow-lg shadow-black/20 ring-1 ring-accent/30 motion-safe:scale-[1.01]",
      )}
    >
      {drag.dropPlacement !== null && (
        <span
          aria-hidden="true"
          data-column-drop={drag.dropPlacement}
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-accent motion-safe:animate-fade-in",
            drag.dropPlacement === "before" ? "-top-[3px]" : "-bottom-[3px]",
          )}
        />
      )}
      <GripHandle
        label={`Reorder ${column.name} column`}
        grabbed={grabbed}
        describedBy={describedBy}
        onKeyDown={props.onKeyDown}
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
      />
      <ColumnDot seed={`aulora:kanban:${boardId}:${column.id}`} />
      <input
        aria-label={`Column ${index + 1} name`}
        maxLength={80}
        placeholder="Column name"
        value={column.name}
        onChange={(event) => {
          props.onRename(event.target.value);
        }}
        className="h-9 min-w-0 flex-1 rounded-[7px] bg-transparent px-2 text-[13px] font-medium text-text placeholder:font-normal placeholder:text-text-muted motion-safe:transition hover:bg-surface-3 focus:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {cardCount !== undefined && <CardCount count={cardCount} limit={column.wipLimit} />}
      <label className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-text-muted">
        <span className="hidden sm:inline">WIP</span>
        <input
          type="number"
          min={1}
          max={500}
          placeholder="—"
          aria-label={`Work-in-progress limit for ${column.name}`}
          value={column.wipLimit ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            props.onWipLimit(raw === "" ? undefined : Number(raw));
          }}
          className="h-9 w-14 shrink-0 rounded-[7px] border border-border bg-surface-3 px-1 text-center text-[13px] tabular-nums text-text placeholder:text-text-muted motion-safe:transition hover:bg-surface-2 focus-visible:border-accent focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
      </label>
      <IconButton
        size="md"
        variant="danger"
        disabled={!props.canRemove}
        label={`Remove ${column.name} column`}
        onClick={props.onRemove}
      >
        <Icon name="trash" size={16} />
      </IconButton>
    </li>
  );
}

export interface ColumnListProps {
  /** Seeds each column's colour so it stays the same across reorders. */
  boardId: string;
  columns: readonly Column[];
  /** The board's cards, or `undefined` while they load. */
  cards: readonly Card[] | undefined;
  onChange: (columns: Column[]) => void;
}

/**
 * The columns fieldset: drag a handle to reorder the columns, rename them
 * inline, set a WIP limit, remove one, or add another. Ordering is local to the
 * board draft and saved with the rest of the board by `kanban.updateBoard`.
 */
export function ColumnList({ boardId, columns, cards, onChange }: ColumnListProps) {
  const [grabbed, setGrabbed] = useState<{ id: string; origin: readonly Column[] } | null>(null);
  const [announce, setAnnounce] = useState("");
  const hintId = useId();
  const counts = useMemo(() => (cards === undefined ? undefined : countByColumn(cards)), [cards]);
  const drag = useColumnDrag({ columns, onReorder: onChange });

  const nameOf = (id: string): string =>
    columns.find((column) => column.id === id)?.name ?? "column";

  const rename = (id: string, name: string) => {
    onChange(columns.map((column) => (column.id === id ? { ...column, name } : column)));
  };
  const setWipLimit = (id: string, wipLimit: number | undefined) => {
    onChange(columns.map((column) => (column.id === id ? withWipLimit(column, wipLimit) : column)));
  };
  const remove = (id: string) => {
    onChange(columns.filter((column) => column.id !== id));
  };
  const add = () => {
    onChange([...columns, { id: newItemId(), name: "New column" }]);
  };

  const onGripKeyDown = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (grabbed?.id === id) {
        setGrabbed(null);
        setAnnounce(`Dropped ${nameOf(id)}`);
      } else {
        setGrabbed({ id, origin: columns });
        setAnnounce(
          `Grabbed ${nameOf(id)}. Use the up and down arrow keys to move, space to drop, escape to cancel.`,
        );
      }
      return;
    }
    if (grabbed?.id !== id) return;
    if (event.key === "Escape") {
      // Keep Escape for cancelling the grab instead of closing the dialog.
      event.preventDefault();
      event.stopPropagation();
      onChange([...grabbed.origin]);
      setGrabbed(null);
      setAnnounce(`Cancelled reordering of ${nameOf(id)}`);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = moveColumnBy(columns, id, event.key === "ArrowUp" ? -1 : 1);
    if (next === null) return;
    onChange(next);
    setAnnounce(
      `${nameOf(id)} moved to position ${next.findIndex((c) => c.id === id) + 1} of ${next.length}`,
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex w-full items-baseline justify-between gap-3 text-[13px] font-medium">
        <span>Columns</span>
        <span className="text-[11px] font-normal tabular-nums text-text-muted">
          {columns.length} / {MAX_COLUMNS}
        </span>
      </legend>
      <p id={hintId} className="text-xs text-text-muted">
        Drag a handle to reorder, or focus it and press space, then use the arrow keys. Move every
        card out of a column, including archived cards, before removing it.
      </p>
      <ul className="flex flex-col gap-1.5">
        {columns.map((column, index) => {
          const dragProps = drag.rowDrag(column.id);
          return (
            <ColumnRow
              key={column.id}
              boardId={boardId}
              column={column}
              index={index}
              cardCount={counts === undefined ? undefined : (counts.get(column.id) ?? 0)}
              drag={dragProps}
              grabbed={grabbed?.id === column.id}
              canRemove={columns.length > 1}
              describedBy={hintId}
              onRename={(name) => {
                rename(column.id, name);
              }}
              onWipLimit={(wipLimit) => {
                setWipLimit(column.id, wipLimit);
              }}
              onRemove={() => {
                remove(column.id);
              }}
              onKeyDown={(event) => {
                onGripKeyDown(column.id, event);
              }}
            />
          );
        })}
      </ul>
      <Button
        variant="secondary"
        className="self-start"
        leading={<Icon name="plus" size={14} />}
        disabled={columns.length >= MAX_COLUMNS}
        onClick={add}
      >
        Add column
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </fieldset>
  );
}
