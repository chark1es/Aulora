/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { kanbanDuration } from "@aulora/core";
import { cn, Icon, type IconProps } from "@aulora/ui-web";
import { type Anchor, below, shortDuration, trackedTime } from "./board-logic";
import { AvatarStack, dueLabel, LabelChip, PriorityFlag, priorityInfo } from "./controls";
import type { Board, BoardMember, Card } from "./types";

const meta = "flex items-center gap-1";

interface CountProps {
  icon: IconProps["name"];
  title: string;
  count: number;
}

function Count({ icon, title, count }: CountProps) {
  if (count === 0) return null;
  return (
    <span className={meta} title={title}>
      <Icon name={icon} size={12} />
      {count}
    </span>
  );
}

function TimerMeta({ card, now }: { card: Card; now: number }) {
  const running = card.timerStartedAt !== undefined;
  const tracked = trackedTime(card, now);
  if (tracked <= 0 && !running) return null;
  return (
    <span
      className={cn(meta, "tabular-nums", running && "font-medium text-accent")}
      title={running ? "Timer running" : "Time tracked"}
    >
      <Icon name="timer" size={12} className={running ? "animate-pulse" : undefined} />
      {running ? kanbanDuration(tracked) : shortDuration(tracked)}
    </span>
  );
}

function ChecklistMeta({ card }: { card: Card }) {
  const total = card.checklist.length;
  const done = card.checklist.filter((item) => item.done).length;
  if (total === 0) return null;
  return (
    <span className={cn(meta, done === total && "text-secondary")} title="Checklist">
      <Icon name="checklist" size={12} />
      {done}/{total}
    </span>
  );
}

/** The small facts under a card's title. */
function CardMeta({ card, now }: { card: Card; now: number }) {
  const due = card.dueAt === undefined ? null : dueLabel(card.dueAt, now);
  const priority = priorityInfo(card.priority);
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-muted">
      {card.priority !== "none" && (
        <span className={cn(meta, priority.tone)}>
          <PriorityFlag priority={card.priority} size={12} />
          {priority.label}
        </span>
      )}
      {due !== null && (
        <span
          className={cn(meta, due.overdue && !card.archived && "text-danger")}
          title={due.overdue ? "Overdue" : "Due date"}
        >
          <Icon name="calendar" size={12} />
          {due.text}
        </span>
      )}
      <ChecklistMeta card={card} />
      <Count icon="paperclip" title="Attachments" count={card.fileIds.length} />
      <Count icon="link" title="GitHub links" count={card.githubLinks.length} />
      <TimerMeta card={card} now={now} />
    </span>
  );
}

function hasFooter(card: Card): boolean {
  return (
    card.priority !== "none" ||
    card.dueAt !== undefined ||
    card.checklist.length > 0 ||
    card.fileIds.length > 0 ||
    card.githubLinks.length > 0 ||
    card.trackedMs > 0 ||
    card.timerStartedAt !== undefined ||
    card.assigneeIds.length > 0
  );
}

export interface CardTileProps {
  card: Card;
  board: Board;
  members: readonly BoardMember[];
  now: number;
  dragged: boolean;
  canDrag: boolean;
  onOpen: () => void;
  onMenu: (anchor: Anchor) => void;
  /** Receives the height of the card, which the landing placeholder copies. */
  onDrag: (height: number) => void;
  onDragEnd: () => void;
}

function CardFace({
  card,
  board,
  members,
  now,
}: Pick<CardTileProps, "card" | "board" | "members" | "now">) {
  const labels = board.labels.filter((label) => card.labelIds.includes(label.id));
  return (
    <>
      {labels.length > 0 && (
        <span className="flex flex-wrap gap-1 pr-6">
          {labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </span>
      )}
      <span
        className={cn(
          "break-words text-[13px] font-medium leading-snug",
          labels.length === 0 && "pr-6",
        )}
      >
        {card.title}
      </span>
      {hasFooter(card) && (
        <span className="flex items-end gap-2">
          <CardMeta card={card} now={now} />
          <AvatarStack userIds={card.assigneeIds} members={members} />
        </span>
      )}
    </>
  );
}

/** One card on the board: click to open, drag to move, right-click for its menu. */
export function CardTile(props: CardTileProps) {
  const { card, dragged, canDrag, onMenu } = props;
  return (
    // While dragged the card steps out of the list; a placeholder shows where it will land.
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the actions button
    <div
      {...(dragged ? {} : { "data-flip": card._id, "data-card": card._id })}
      className={cn(
        "group relative shrink-0",
        dragged && "pointer-events-none !absolute h-0 w-0 overflow-hidden opacity-0",
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(event);
      }}
    >
      <button
        type="button"
        aria-label={`Open card ${card.title}`}
        draggable={canDrag}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", card._id);
          props.onDrag(event.currentTarget.offsetHeight);
        }}
        onDragEnd={props.onDragEnd}
        onClick={props.onOpen}
        className={cn(
          "flex w-full flex-col gap-2 rounded-[10px] border border-border bg-surface-1 p-3 text-left shadow-sm shadow-black/5 transition duration-150 ease-out",
          "hover:-translate-y-px hover:border-text-muted/40 hover:shadow-md hover:shadow-black/10 active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          canDrag && "cursor-grab active:cursor-grabbing",
        )}
      >
        <CardFace card={card} board={props.board} members={props.members} now={props.now} />
      </button>
      <button
        type="button"
        aria-label={`Actions for ${card.title}`}
        onClick={(event) => {
          onMenu(below(event.currentTarget));
        }}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] bg-surface-1 text-text-muted opacity-0 transition hover:bg-surface-3 hover:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <Icon name="more-horizontal" size={16} />
      </button>
    </div>
  );
}
