import { cn, Icon, IconButton } from "@aulora/ui-web";
import { useRef } from "react";
import { type Column, cardsInColumn, isColumnFull } from "./board-logic";
import { openBoardMenu, openCardMenu, openColumnMenu } from "./board-menus";
import { CardTile } from "./CardTile";
import { useFlip } from "./motion";
import { NewCard } from "./NewCard";
import type { Board, Card } from "./types";
import type { BoardController } from "./use-board";
import { type CardDrag, useCardDrag } from "./use-card-drag";

/** Columns share the width evenly between these bounds, then the board scrolls sideways. */
const COLUMN_MIN = 272;
const COLUMN_MAX = 420;
const COLUMN_GAP = 12;

/** The outline of the dragged card, shown where it will land. */
function DropSlot({ drag }: { drag: NonNullable<CardDrag["drag"]> }) {
  return (
    <div
      aria-hidden
      data-flip={drag.id}
      data-drop-slot
      className="shrink-0 rounded-[10px] border-2 border-dashed border-accent/70 bg-accent-soft"
      style={{ height: drag.height }}
    />
  );
}

interface ColumnProps {
  ctl: BoardController;
  dnd: CardDrag;
  board: Board;
  column: Column;
}

function ColumnHeader({
  ctl,
  column,
  count,
}: Pick<ColumnProps, "ctl" | "column"> & { count: number }) {
  const full = isColumnFull(column, ctl.cards ?? []);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 pl-3.5 pr-2">
      <h3 className="min-w-0 truncate text-[13px] font-semibold">{column.name}</h3>
      <span
        title={column.wipLimit ? `Limit of ${column.wipLimit} cards` : undefined}
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
          full ? "bg-danger/15 text-danger" : "bg-surface-3 text-text-muted",
        )}
      >
        {count}
        {column.wipLimit ? ` / ${column.wipLimit}` : ""}
      </span>
      <span className="flex-1" />
      {ctl.canArrange && (
        <IconButton
          label={`Add card to ${column.name}`}
          size="sm"
          disabled={full}
          onClick={() => {
            ctl.setComposing(column.id);
          }}
        >
          <Icon name="plus" size={16} />
        </IconButton>
      )}
    </header>
  );
}

function emptyText(ctl: BoardController): string {
  if (ctl.filtering) return "No matching cards";
  if (ctl.archivedCards) return "No archived cards";
  return ctl.canArrange ? "Drop a card here or add one" : "No cards yet";
}

interface ListProps extends ColumnProps {
  cards: readonly Card[];
}

/** The column's cards in order, with the landing placeholder among them while dragging. */
function ColumnCards({ ctl, dnd, board, column, cards }: ListProps) {
  const { drag, landing } = dnd;
  const target = drag !== undefined && landing?.columnId === column.id ? landing : undefined;
  const slot = drag !== undefined && target !== undefined && <DropSlot key="slot" drag={drag} />;
  const others = cards.filter((card) => card._id !== drag?.id);
  return (
    <>
      {cards.flatMap((card) => [
        target?.beforeId === card._id && slot,
        <CardTile
          key={card._id}
          card={card}
          board={board}
          members={ctl.members}
          now={ctl.now}
          dragged={drag?.id === card._id}
          canDrag={ctl.canArrange && !ctl.busy}
          onOpen={() => {
            ctl.setSelectedCard(card._id);
          }}
          onMenu={(anchor) => {
            openCardMenu(ctl, anchor, card, cards);
          }}
          onDrag={(height) => {
            dnd.start(card, cards, height);
          }}
          onDragEnd={dnd.release}
        />,
      ])}
      {target !== undefined && target.beforeId === undefined && slot}
      {others.length === 0 && slot === false && ctl.composing !== column.id && (
        <p className="rounded-[10px] border border-dashed border-border px-2 py-5 text-center text-xs text-text-muted">
          {emptyText(ctl)}
        </p>
      )}
    </>
  );
}

/** One column: a drop target holding its cards and the composer for a new one. */
function BoardColumn({ ctl, dnd, board, column }: ColumnProps) {
  const cards = cardsInColumn(ctl.filtered, column.id);
  const refused = dnd.refusedColumn === column.id;
  const targeted = dnd.drag !== undefined && dnd.landing?.columnId === column.id;
  return (
    <section
      aria-label={column.name}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 basis-0 flex-col rounded-[14px] bg-surface-2 transition-shadow",
        refused ? "ring-2 ring-danger/60" : targeted && "ring-2 ring-accent/50",
      )}
      onDragOver={(event) => {
        dnd.hover(event, column.id);
      }}
      onDrop={dnd.drop}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openColumnMenu(ctl, event, column);
      }}
    >
      <ColumnHeader ctl={ctl} column={column} count={cards.length} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {refused && (
          <p
            role="status"
            className="shrink-0 animate-fade-in rounded-[10px] border border-dashed border-danger/50 bg-danger/10 px-2 py-2.5 text-center text-xs font-medium text-danger"
          >
            Column limit reached
          </p>
        )}
        <ColumnCards ctl={ctl} dnd={dnd} board={board} column={column} cards={cards} />
        {ctl.canArrange && (
          <NewCard
            full={isColumnFull(column, ctl.cards ?? [])}
            columnName={column.name}
            open={ctl.composing === column.id}
            onOpen={() => {
              ctl.setComposing(column.id);
            }}
            onClose={() => {
              ctl.setComposing(undefined);
            }}
            onCreate={(title) =>
              ctl.run(() =>
                ctl.mutations.createCard({ boardId: board.id, columnId: column.id, title }),
              )
            }
          />
        )}
      </div>
    </section>
  );
}

/** The board itself: every column side by side, filling the width and scrolling when there are many. */
export function BoardColumns({ ctl, board }: { ctl: BoardController; board: Board }) {
  const root = useRef<HTMLElement | null>(null);
  const dnd = useCardDrag(ctl);
  useFlip(root, `${board.id}:${String(ctl.archivedCards)}`);
  const count = board.columns.length;
  return (
    <section
      className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4"
      ref={root}
      aria-label="Board columns"
      onDragOver={(event) => {
        if (dnd.accepts) event.preventDefault();
      }}
      onDrop={dnd.drop}
      onContextMenu={(event) => {
        event.preventDefault();
        openBoardMenu(ctl, event);
      }}
    >
      <div
        key={board.id}
        className="mx-auto flex min-h-0 w-full shrink-0 animate-fade-in gap-3"
        style={{
          minWidth: count * (COLUMN_MIN + COLUMN_GAP) - COLUMN_GAP,
          maxWidth: count * (COLUMN_MAX + COLUMN_GAP) - COLUMN_GAP,
        }}
      >
        {board.columns.map((column) => (
          <BoardColumn key={column.id} ctl={ctl} dnd={dnd} board={board} column={column} />
        ))}
      </div>
    </section>
  );
}
