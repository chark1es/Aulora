import { hasPermission, kanbanDuration, Permission } from "@aulora/core";
import {
  Button,
  ConfirmDialog,
  type ContextMenuItem,
  cn,
  Icon,
  IconButton,
  Input,
  Modal,
  Spinner,
  Switch,
  useContextMenu,
} from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { BoardSettings } from "./BoardSettings";
import { CardDetail } from "./CardDetail";
import {
  AvatarStack,
  ChecklistMenu,
  dueLabel,
  FilterTrigger,
  filterChip,
  LabelChip,
  menuRow,
  PRIORITIES,
  PRIORITY,
  PriorityFlag,
  personOptions,
  popoverPanel,
  usePopover,
} from "./controls";
import { GithubBrowser } from "./GithubBrowser";
import { useFlip } from "./motion";
import { type Board, type BoardMember, type Card, failure } from "./types";

interface Props {
  ownUserId: string;
  permissions: bigint;
  members: readonly BoardMember[];
  onBack: () => void;
}
class KanbanBoundary extends Component<
  { children: ReactNode; onBack: () => void },
  { error: boolean }
> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    if (this.state.error)
      return (
        <section className="pane flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-5">
          <h2 className="text-lg font-semibold">Kanban could not load</h2>
          <p className="max-w-md text-center text-sm text-text-muted">
            The addon may be disabled or your access may have changed. Return to chat, or retry to
            reload your boards.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={this.props.onBack}>
              Back to chat
            </Button>
            <Button onClick={() => this.setState({ error: false })}>Retry</Button>
          </div>
        </section>
      );
    return this.props.children;
  }
}
export function KanbanView(props: Props) {
  return (
    <KanbanBoundary onBack={props.onBack}>
      <KanbanContent {...props} />
    </KanbanBoundary>
  );
}
/** Columns share the width evenly between these bounds, then the board scrolls sideways. */
const COLUMN_MIN = 272;
const COLUMN_MAX = 420;
const COLUMN_GAP = 12;
type Anchor = { clientX: number; clientY: number };
/** A place in a column: before the given card, or at the end. */
type Slot = { columnId: string; beforeId?: Id<"kanbanCards"> };
const sameSlot = (a: Slot | null, b: Slot | null) =>
  a?.columnId === b?.columnId && a?.beforeId === b?.beforeId;
/** Opens a menu under the button that was pressed. */
function below(event: React.MouseEvent): Anchor {
  const rect = event.currentTarget.getBoundingClientRect();
  return { clientX: rect.left, clientY: rect.bottom + 4 };
}
function KanbanContent({ ownUserId, permissions, members, onBack }: Props) {
  const boards = useQuery(api.kanban.listBoards, {});
  const createBoard = useMutation(api.kanban.createBoard);
  const createCard = useMutation(api.kanban.createCard);
  const updateCard = useMutation(api.kanban.updateCard);
  const move = useMutation(api.kanban.moveCard);
  const archiveCard = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const timer = useMutation(api.kanban.timer);
  const archiveBoard = useMutation(api.kanban.archiveBoard);
  const deleteBoard = useMutation(api.kanban.deleteBoard);
  const openMenu = useContextMenu();
  const columnsRef = useRef<HTMLElement | null>(null);
  const [boardId, setBoardId] = useState<Id<"kanbanBoards"> | null>(null);
  const [showArchivedBoards, setArchivedBoards] = useState(false);
  const [showArchivedCards, setArchivedCards] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [privateBoard, setPrivateBoard] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "deleteBoard" } | { kind: "archiveBoard" } | { kind: "deleteCard"; card: Card } | null
  >(null);
  const [github, setGithub] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Id<"kanbanCards"> | null>(null);
  const [search, setSearch] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [composing, setComposing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // The card being dragged, its size, and where it started.
  const [drag, setDrag] = useState<{ id: Id<"kanbanCards">; height: number; home: Slot } | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<Slot | null>(null);
  const dragFrame = useRef(0);
  const dropping = useRef(false);
  const dragging = drag?.id ?? null;
  const visibleBoards = (boards ?? []).filter((b) => b.archived === showArchivedBoards);
  const board = visibleBoards.find((b) => b.id === boardId) ?? visibleBoards[0];
  const cards = useQuery(api.kanban.listCards, board ? { boardId: board.id } : "skip");
  const canManage = hasPermission(permissions, Permission.ManageKanban);
  const canEdit = hasPermission(permissions, Permission.EditKanban) && !board?.archived;
  const canArrange = canEdit && !showArchivedCards;
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  // A board change starts a new filter and editing context.
  const currentBoardId = board?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the editing context whenever the selected board changes
  useEffect(() => {
    setLabels([]);
    setAssignees([]);
    setPriorities([]);
    setSearch("");
    setSelectedCard(null);
    setSettings(false);
    setArchivedCards(false);
    setComposing(null);
  }, [currentBoardId]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setBusy(false);
      endDrag();
    }
  }
  function endDrag() {
    cancelAnimationFrame(dragFrame.current);
    dropping.current = false;
    setDrag(null);
    setDropTarget(null);
  }
  const filtering = !!(search.trim() || assignees.length || labels.length || priorities.length);
  const clearFilters = () => {
    setSearch("");
    setAssignees([]);
    setLabels([]);
    setPriorities([]);
  };
  const inView = (cards ?? []).filter((c) => c.archived === showArchivedCards);
  const filtered = inView.filter(
    (c) =>
      `${c.title} ${c.notes}`.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!assignees.length ||
        (assignees.includes("unassigned") && !c.assigneeIds.length) ||
        c.assigneeIds.some((id) => assignees.includes(id))) &&
      (!labels.length || c.labelIds.some((id) => labels.includes(id))) &&
      (!priorities.length || priorities.includes(c.priority)),
  );
  useFlip(columnsRef, `${board?.id}:${showArchivedCards}`);
  const detail = cards?.find((c) => c._id === selectedCard);
  const boardMembers = members.filter((m) => !board?.private || board.memberIds.includes(m.userId));
  /** A column at its limit takes no more cards, but its own cards can still be reordered. */
  const blocked = (columnId: string) => {
    const column = board?.columns.find((c) => c.id === columnId);
    return (
      !!drag &&
      drag.home.columnId !== columnId &&
      column?.wipLimit !== undefined &&
      (cards ?? []).filter((c) => c.columnId === columnId && !c.archived).length >= column.wipLimit
    );
  };
  function startDrag(card: Card, siblings: readonly Card[], height: number) {
    const next = siblings[siblings.findIndex((c) => c._id === card._id) + 1];
    const home: Slot = { columnId: card.columnId, ...(next ? { beforeId: next._id } : {}) };
    // Wait a frame so the browser's drag image still shows the whole card.
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = requestAnimationFrame(() => {
      setDrag({ id: card._id, height, home });
      setDropTarget(home);
    });
  }
  /** Follows the pointer: the card lands above the first card whose middle is below it. */
  function hover(event: React.DragEvent<HTMLElement>, columnId: string) {
    if (!canArrange || !drag) return;
    event.stopPropagation();
    let beforeId: Id<"kanbanCards"> | undefined;
    for (const tile of event.currentTarget.querySelectorAll<HTMLElement>("[data-card]")) {
      const box = tile.getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) {
        beforeId = tile.dataset.card as Id<"kanbanCards">;
        break;
      }
    }
    const next: Slot = { columnId, ...(beforeId ? { beforeId } : {}) };
    if (blocked(columnId)) event.dataTransfer.dropEffect = "none";
    else event.preventDefault();
    setDropTarget((current) => (sameSlot(current, next) ? current : next));
  }
  /** Drops the card where the placeholder is shown. */
  function drop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!drag || !dropTarget || !canArrange || busy) return;
    if (sameSlot(dropTarget, drag.home) || blocked(dropTarget.columnId)) return endDrag();
    // Keep the placeholder until the move is saved, so the card does not jump back first.
    dropping.current = true;
    void run(() => move({ cardId: drag.id, ...dropTarget }));
  }
  function boardMenu(anchor: Anchor) {
    if (!board) return;
    const items: ContextMenuItem[] = [];
    if (canManage && !board.archived)
      items.push({
        id: "settings",
        label: "Board settings…",
        icon: <Icon name="settings" size={14} />,
        onSelect: () => setSettings(true),
      });
    items.push(
      {
        id: "github",
        label: canEdit ? "Add card from GitHub…" : "Browse GitHub…",
        icon: <Icon name="link" size={14} />,
        onSelect: () => setGithub(true),
      },
      {
        id: "archived-cards",
        label: showArchivedCards ? "Show active cards" : "Show archived cards",
        icon: <Icon name="archive" size={14} />,
        onSelect: () => setArchivedCards(!showArchivedCards),
      },
    );
    if (filtering)
      items.push({
        id: "clear",
        label: "Clear filters",
        icon: <Icon name="x" size={14} />,
        onSelect: clearFilters,
      });
    if (canManage)
      items.push(
        board.archived
          ? {
              id: "restore",
              label: "Restore board",
              icon: <Icon name="unarchive" size={14} />,
              separatorBefore: true,
              onSelect: () => void run(() => archiveBoard({ boardId: board.id, archived: false })),
            }
          : {
              id: "archive",
              label: "Archive board…",
              icon: <Icon name="archive" size={14} />,
              separatorBefore: true,
              onSelect: () => setConfirm({ kind: "archiveBoard" }),
            },
        {
          id: "delete",
          label: "Delete board…",
          icon: <Icon name="trash" size={14} />,
          danger: true,
          onSelect: () => setConfirm({ kind: "deleteBoard" }),
        },
      );
    openMenu({
      clientX: anchor.clientX,
      clientY: anchor.clientY,
      items,
      label: `${board.name} actions`,
    });
  }
  function columnMenu(anchor: Anchor, column: Board["columns"][number], full: boolean) {
    const items: ContextMenuItem[] = [];
    if (canArrange)
      items.push({
        id: "add",
        label: full ? "Column limit reached" : "Add card",
        icon: <Icon name="plus" size={14} />,
        disabled: full,
        onSelect: () => setComposing(column.id),
      });
    if (canManage && !board?.archived)
      items.push({
        id: "columns",
        label: "Edit columns…",
        icon: <Icon name="settings" size={14} />,
        onSelect: () => setSettings(true),
      });
    if (filtering)
      items.push({
        id: "clear",
        label: "Clear filters",
        icon: <Icon name="x" size={14} />,
        onSelect: clearFilters,
      });
    if (items.length)
      openMenu({
        clientX: anchor.clientX,
        clientY: anchor.clientY,
        items,
        label: `${column.name} actions`,
      });
  }
  function cardMenu(anchor: Anchor, card: Card, siblings: readonly Card[]) {
    if (!board) return;
    const index = siblings.findIndex((c) => c._id === card._id);
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: "Open card",
        icon: <Icon name="expand" size={14} />,
        onSelect: () => setSelectedCard(card._id),
      },
    ];
    if (canArrange) {
      const before = siblings[index - 1];
      const after = siblings[index + 2];
      items.push(
        {
          id: "up",
          label: "Move up",
          icon: <Icon name="arrow-up" size={14} />,
          separatorBefore: true,
          disabled: busy || !before,
          onSelect: () =>
            before &&
            void run(() =>
              move({ cardId: card._id, columnId: card.columnId, beforeId: before._id }),
            ),
        },
        {
          id: "down",
          label: "Move down",
          icon: <Icon name="arrow-down" size={14} />,
          disabled: busy || index === siblings.length - 1,
          onSelect: () =>
            void run(() =>
              move({
                cardId: card._id,
                columnId: card.columnId,
                ...(after ? { beforeId: after._id } : {}),
              }),
            ),
        },
        ...board.columns
          .filter((c) => c.id !== card.columnId)
          .map((c, i) => ({
            id: `column-${c.id}`,
            label: `Move to ${c.name}`,
            icon: <Icon name="chevron-right" size={14} />,
            separatorBefore: i === 0,
            disabled: busy,
            onSelect: () => void run(() => move({ cardId: card._id, columnId: c.id })),
          })),
      );
      const mine = card.assigneeIds.includes(ownUserId);
      if (mine || boardMembers.some((m) => m.userId === ownUserId))
        items.push({
          id: "assign",
          label: mine ? "Unassign me" : "Assign to me",
          icon: <Icon name="user-plus" size={14} />,
          separatorBefore: true,
          disabled: busy,
          onSelect: () =>
            void run(() =>
              updateCard({
                cardId: card._id,
                revision: card.revision,
                title: card.title,
                notes: card.notes,
                checklist: card.checklist,
                githubLinks: card.githubLinks,
                labelIds: card.labelIds,
                priority: card.priority,
                startAt: card.startAt ?? null,
                dueAt: card.dueAt ?? null,
                estimateMinutes: card.estimateMinutes ?? null,
                assigneeIds: mine
                  ? card.assigneeIds.filter((id) => id !== ownUserId)
                  : [...card.assigneeIds, ownUserId],
              }),
            ),
        });
    }
    const running = card.timerStartedAt !== undefined;
    if (
      !card.archived &&
      !board.archived &&
      (running ? card.timerUserId === ownUserId || canManage : canEdit)
    )
      items.push({
        id: "timer",
        label: running ? "Stop timer" : "Start timer",
        icon: <Icon name={running ? "stop" : "play"} size={14} />,
        disabled: busy,
        onSelect: () => void run(() => timer({ cardId: card._id, running: !running })),
      });
    items.push({
      id: "copy",
      label: "Copy title",
      icon: <Icon name="copy" size={14} />,
      separatorBefore: true,
      onSelect: () => void navigator.clipboard?.writeText(card.title),
    });
    if (canEdit)
      items.push({
        id: "archive",
        label: card.archived ? "Restore card" : "Archive card",
        icon: <Icon name={card.archived ? "unarchive" : "archive"} size={14} />,
        disabled: busy,
        onSelect: () => void run(() => archiveCard({ cardId: card._id, archived: !card.archived })),
      });
    if (canManage)
      items.push({
        id: "delete",
        label: "Delete card…",
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onSelect: () => setConfirm({ kind: "deleteCard", card }),
      });
    openMenu({
      clientX: anchor.clientX,
      clientY: anchor.clientY,
      items,
      label: `${card.title} actions`,
    });
  }
  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Kanban board">
      <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <IconButton label="Back to chat" size="sm" onClick={onBack}>
          <Icon name="chevron-left" size={18} />
        </IconButton>
        <BoardSwitcher
          boards={visibleBoards}
          board={board}
          archived={showArchivedBoards}
          canManage={canManage}
          onSelect={(id) => {
            setBoardId(id);
            setError(null);
          }}
          onNew={() => setNewBoard(true)}
          onToggleArchived={() => {
            setArchivedBoards(!showArchivedBoards);
            setBoardId(null);
          }}
        />
        {board?.description ? (
          <p
            className="hidden min-w-0 flex-1 truncate text-[13px] text-text-muted md:block"
            title={board.description}
          >
            {board.description}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        {board && (
          <>
            {board.private && (
              <AvatarStack userIds={board.memberIds} members={members} max={4} size={22} />
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setGithub(true)}
              leading={<Icon name="link" size={14} />}
            >
              GitHub
            </Button>
            {canManage && !board.archived && (
              <IconButton label="Board settings" size="sm" onClick={() => setSettings(true)}>
                <Icon name="settings" size={16} />
              </IconButton>
            )}
            <IconButton label="Board actions" size="sm" onClick={(e) => boardMenu(below(e))}>
              <Icon name="more-horizontal" size={16} />
            </IconButton>
          </>
        )}
      </header>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 animate-fade-in items-center gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2 text-[13px] text-danger"
        >
          <p className="flex-1">{error}</p>
          <IconButton
            label="Dismiss error"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => setError(null)}
          >
            <Icon name="x" size={14} />
          </IconButton>
        </div>
      )}
      {boards === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="Loading boards" />
        </div>
      ) : !board ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-accent-soft text-accent">
            <Icon name="kanban" size={28} />
          </span>
          <h2 className="text-lg font-semibold">
            {showArchivedBoards ? "No archived boards" : "Plan your next project"}
          </h2>
          <p className="max-w-md text-sm text-text-muted">
            {showArchivedBoards
              ? "Boards you archive are kept here until you restore or delete them."
              : canManage
                ? "Create a board, then organize your work into cards and columns."
                : "No boards are available to you. Ask a board manager to create one or add you to a private board."}
          </p>
          {showArchivedBoards ? (
            <Button variant="secondary" onClick={() => setArchivedBoards(false)}>
              Back to active boards
            </Button>
          ) : (
            canManage && <Button onClick={() => setNewBoard(true)}>Create your first board</Button>
          )}
        </div>
      ) : (
        <>
          <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <label className="relative min-w-[160px] max-w-[280px] flex-1">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                aria-label="Search cards"
                placeholder="Search cards"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-[8px] border border-border bg-surface-2 pl-8 pr-2.5 text-[13px] text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              />
            </label>
            <ChecklistMenu
              label="Filter by assignee"
              options={[
                {
                  id: "unassigned",
                  label: "Unassigned",
                  leading: (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-text-muted/60" />
                  ),
                },
                ...personOptions(boardMembers, []),
              ]}
              selected={assignees}
              onChange={setAssignees}
              searchPlaceholder="Find a person"
              triggerClassName={filterChip(assignees.length > 0)}
              trigger={<FilterTrigger icon="users" label="Assignee" count={assignees.length} />}
            />
            <ChecklistMenu
              label="Filter by label"
              options={board.labels.map((l) => ({
                id: l.id,
                label: l.name,
                leading: (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                ),
              }))}
              selected={labels}
              onChange={setLabels}
              emptyText="This board has no labels yet"
              triggerClassName={filterChip(labels.length > 0)}
              trigger={<FilterTrigger icon="label" label="Label" count={labels.length} />}
            />
            <ChecklistMenu
              label="Filter by priority"
              options={[...PRIORITIES].reverse().map((p) => ({
                id: p,
                label: PRIORITY[p].label,
                leading: <PriorityFlag priority={p} />,
              }))}
              selected={priorities}
              onChange={setPriorities}
              triggerClassName={filterChip(priorities.length > 0)}
              trigger={<FilterTrigger icon="flag" label="Priority" count={priorities.length} />}
            />
            {filtering && (
              <Button size="sm" variant="ghost" className="animate-fade-in" onClick={clearFilters}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-xs tabular-nums text-text-muted">
              {filtering ? `${filtered.length} of ${inView.length}` : inView.length}{" "}
              {showArchivedCards ? "archived" : inView.length === 1 ? "card" : "cards"}
            </span>
          </div>
          {(board.archived || showArchivedCards) && (
            <div className="flex shrink-0 animate-fade-in items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[13px] text-text-muted">
              <Icon name="archive" size={14} />
              <p className="flex-1">
                {board.archived
                  ? "This board is archived. Restore it to make changes."
                  : "Showing archived cards. Open or right-click a card to restore it."}
              </p>
              {board.archived ? (
                canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void run(() => archiveBoard({ boardId: board.id, archived: false }))
                    }
                  >
                    Restore board
                  </Button>
                )
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setArchivedCards(false)}>
                  Back to active cards
                </Button>
              )}
            </div>
          )}
          {cards === undefined ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner label="Loading cards" />
            </div>
          ) : (
            <section
              className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4"
              ref={columnsRef}
              aria-label="Board columns"
              onDragOver={(e) => {
                if (drag && dropTarget && !blocked(dropTarget.columnId)) e.preventDefault();
              }}
              onDrop={drop}
              onContextMenu={(e) => {
                e.preventDefault();
                boardMenu(e);
              }}
            >
              <div
                key={board.id}
                className="mx-auto flex min-h-0 w-full shrink-0 animate-fade-in gap-3"
                style={{
                  minWidth: board.columns.length * (COLUMN_MIN + COLUMN_GAP) - COLUMN_GAP,
                  maxWidth: board.columns.length * (COLUMN_MAX + COLUMN_GAP) - COLUMN_GAP,
                }}
              >
                {board.columns.map((column) => {
                  const columnCards = filtered
                    .filter((c) => c.columnId === column.id)
                    .sort((a, b) => a.position - b.position);
                  const total = cards.filter((c) => c.columnId === column.id && !c.archived).length;
                  const full = column.wipLimit !== undefined && total >= column.wipLimit;
                  // A refused card stays where it was, so its placeholder goes back home.
                  const refused =
                    !!drag && dropTarget?.columnId === column.id && blocked(column.id);
                  const landing =
                    drag && dropTarget && (blocked(dropTarget.columnId) ? drag.home : dropTarget);
                  const target = landing && landing.columnId === column.id ? landing : null;
                  const slot = target && drag && (
                    <DropSlot key="slot" id={drag.id} height={drag.height} />
                  );
                  return (
                    <section
                      key={column.id}
                      aria-label={column.name}
                      className={cn(
                        "flex min-h-0 min-w-0 flex-1 basis-0 flex-col rounded-[14px] bg-surface-2 transition-shadow",
                        refused ? "ring-2 ring-danger/60" : target && "ring-2 ring-accent/50",
                      )}
                      onDragOver={(e) => hover(e, column.id)}
                      onDrop={drop}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        columnMenu(e, column, full);
                      }}
                    >
                      <header className="flex h-11 shrink-0 items-center gap-2 pl-3.5 pr-2">
                        <h3 className="min-w-0 truncate text-[13px] font-semibold">
                          {column.name}
                        </h3>
                        <span
                          title={column.wipLimit ? `Limit of ${column.wipLimit} cards` : undefined}
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                            full ? "bg-danger/15 text-danger" : "bg-surface-3 text-text-muted",
                          )}
                        >
                          {columnCards.length}
                          {column.wipLimit ? ` / ${column.wipLimit}` : ""}
                        </span>
                        <span className="flex-1" />
                        {canArrange && (
                          <IconButton
                            label={`Add card to ${column.name}`}
                            size="sm"
                            disabled={full}
                            onClick={() => setComposing(column.id)}
                          >
                            <Icon name="plus" size={16} />
                          </IconButton>
                        )}
                      </header>
                      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                        {refused && (
                          <p
                            role="status"
                            className="shrink-0 animate-fade-in rounded-[10px] border border-dashed border-danger/50 bg-danger/10 px-2 py-2.5 text-center text-xs font-medium text-danger"
                          >
                            Column limit reached
                          </p>
                        )}
                        {columnCards.flatMap((c) => [
                          target?.beforeId === c._id && slot,
                          <CardTile
                            key={c._id}
                            card={c}
                            board={board}
                            members={members}
                            now={now}
                            dragged={dragging === c._id}
                            canDrag={canArrange && !busy}
                            onOpen={() => setSelectedCard(c._id)}
                            onMenu={(anchor) => cardMenu(anchor, c, columnCards)}
                            onDrag={(height) => startDrag(c, columnCards, height)}
                            onDragEnd={() => {
                              if (!dropping.current) endDrag();
                            }}
                          />,
                        ])}
                        {target && !target.beforeId && slot}
                        {!columnCards.some((c) => c._id !== dragging) &&
                          !slot &&
                          composing !== column.id && (
                            <p className="rounded-[10px] border border-dashed border-border px-2 py-5 text-center text-xs text-text-muted">
                              {filtering
                                ? "No matching cards"
                                : showArchivedCards
                                  ? "No archived cards"
                                  : canArrange
                                    ? "Drop a card here or add one"
                                    : "No cards yet"}
                            </p>
                          )}
                        {canArrange && (
                          <NewCard
                            full={full}
                            columnName={column.name}
                            open={composing === column.id}
                            onOpen={() => setComposing(column.id)}
                            onClose={() => setComposing(null)}
                            onCreate={(title) =>
                              run(() =>
                                createCard({ boardId: board.id, columnId: column.id, title }),
                              )
                            }
                          />
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {board && (
        <ConfirmDialog
          open={confirm?.kind === "deleteBoard"}
          onClose={() => setConfirm(null)}
          title="Permanently delete board?"
          description="All cards, comments, activity and uploaded board files will be deleted. This cannot be undone."
          confirmLabel="Delete board"
          variant="danger"
          onConfirm={() => {
            setConfirm(null);
            void run(() => deleteBoard({ boardId: board.id }));
          }}
        />
      )}
      {board && (
        <ConfirmDialog
          open={confirm?.kind === "archiveBoard"}
          onClose={() => setConfirm(null)}
          title="Archive board?"
          description="Work timers will stop. You can restore this board from archived boards."
          confirmLabel="Archive board"
          onConfirm={() => {
            setConfirm(null);
            void run(() => archiveBoard({ boardId: board.id, archived: true }));
          }}
        />
      )}
      <ConfirmDialog
        open={confirm?.kind === "deleteCard"}
        onClose={() => setConfirm(null)}
        title="Permanently delete card?"
        description="This deletes the card, comments, activity and attachments that are not used on other cards. It cannot be undone."
        confirmLabel="Delete card"
        variant="danger"
        onConfirm={() => {
          const target = confirm?.kind === "deleteCard" ? confirm.card : null;
          setConfirm(null);
          if (target) void run(() => deleteCard({ cardId: target._id }));
        }}
      />
      {newBoard && (
        <Modal
          open
          onClose={() => setNewBoard(false)}
          label="New board"
          footer={
            <>
              <Button variant="secondary" onClick={() => setNewBoard(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="kanban-new-board"
                disabled={!boardName.trim()}
                loading={busy}
              >
                Create board
              </Button>
            </>
          }
        >
          <form
            id="kanban-new-board"
            className="flex flex-col gap-4 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const id = await createBoard({
                  name: boardName,
                  private: privateBoard,
                  memberIds: [ownUserId],
                });
                setBoardId(id);
                setArchivedBoards(false);
                setBoardName("");
                setNewBoard(false);
              });
            }}
          >
            <Input
              label="Board name"
              placeholder="e.g. Website launch"
              maxLength={120}
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
            />
            <Switch
              label="Private board"
              checked={privateBoard}
              onChange={setPrivateBoard}
              description="Only you and board managers have access initially. Add members in Board settings."
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
      {settings && board && (
        <BoardSettings
          key={board.id}
          board={board}
          members={members}
          onClose={() => setSettings(false)}
        />
      )}
      {detail && board && (
        <CardDetail
          key={detail._id}
          card={detail}
          board={board}
          permissions={permissions}
          ownUserId={ownUserId}
          members={members}
          now={now}
          onClose={() => setSelectedCard(null)}
        />
      )}
      {github && (
        <GithubBrowser
          onClose={() => setGithub(false)}
          {...(board && canEdit
            ? {
                onPick: (item: { title: string; url: string }) => {
                  const first = board.columns[0];
                  if (!first) return;
                  setGithub(false);
                  void run(() =>
                    createCard({
                      boardId: board.id,
                      columnId: first.id,
                      title: item.title.slice(0, 200),
                      githubLink: item.url,
                    }),
                  );
                },
              }
            : {})}
        />
      )}
    </section>
  );
}
/** The outline of the dragged card, shown where it will land. */
function DropSlot({ id, height }: { id: Id<"kanbanCards">; height: number }) {
  return (
    <div
      aria-hidden
      data-flip={id}
      data-drop-slot
      className="shrink-0 rounded-[10px] border-2 border-dashed border-accent/70 bg-accent-soft"
      style={{ height }}
    />
  );
}
function BoardSwitcher({
  boards,
  board,
  archived,
  canManage,
  onSelect,
  onNew,
  onToggleArchived,
}: {
  boards: readonly Board[];
  board: Board | undefined;
  archived: boolean;
  canManage: boolean;
  onSelect: (id: Id<"kanbanBoards">) => void;
  onNew: () => void;
  onToggleArchived: () => void;
}) {
  const { open, setOpen, rootRef, onKeyDown } = usePopover();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the popover from any child
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label={board ? `${board.name}, switch board` : "Switch board"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 max-w-full items-center gap-2 rounded-[8px] px-2 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          open && "bg-surface-3",
        )}
      >
        <Icon name="kanban" size={18} className="text-accent" />
        <span className="min-w-0 truncate text-[15px] font-semibold">
          {board?.name ?? (archived ? "Archived boards" : "Kanban")}
        </span>
        {board?.private && <Icon name="lock" size={13} className="text-text-muted" />}
        {board?.archived && (
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
            Archived
          </span>
        )}
        <Icon name="chevron-down" size={14} className="text-text-muted" />
      </button>
      {open && (
        <div className={cn(popoverPanel, "left-0")}>
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {archived ? "Archived boards" : "Boards"}
          </p>
          <div className="max-h-72 overflow-y-auto">
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-current={b.id === board?.id}
                className={menuRow}
                onClick={() => {
                  onSelect(b.id);
                  setOpen(false);
                }}
              >
                <Icon name={b.private ? "lock" : "kanban"} size={14} className="text-text-muted" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {b.id === board?.id && <Icon name="check" size={14} className="text-accent" />}
              </button>
            ))}
            {!boards.length && (
              <p className="px-2 py-3 text-center text-xs text-text-muted">No boards</p>
            )}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            {canManage && (
              <button
                type="button"
                className={menuRow}
                onClick={() => {
                  onNew();
                  setOpen(false);
                }}
              >
                <Icon name="plus" size={14} className="text-text-muted" />
                New board
              </button>
            )}
            <button
              type="button"
              className={menuRow}
              onClick={() => {
                onToggleArchived();
                setOpen(false);
              }}
            >
              <Icon name={archived ? "kanban" : "archive"} size={14} className="text-text-muted" />
              {archived ? "Show active boards" : "Show archived boards"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function NewCard({
  full,
  columnName,
  open,
  onOpen,
  onClose,
  onCreate,
}: {
  full: boolean;
  columnName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCreate: (title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  if (!open || full)
    return (
      <button
        type="button"
        disabled={full}
        onClick={onOpen}
        className="flex h-8 w-full shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-60"
      >
        {!full && <Icon name="plus" size={14} />}
        {full ? "Column limit reached" : "Add card"}
      </button>
    );
  // Stays open after a save so several cards can be added in a row.
  const submit = () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    void onCreate(title).then((saved) => {
      setSaving(false);
      if (saved) setTitle("");
      field.current?.focus();
    });
  };
  return (
    <form
      className="flex shrink-0 origin-top animate-pop-in flex-col gap-2 rounded-[10px] border border-accent/60 bg-surface-1 p-2.5 shadow-md shadow-black/10"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={field}
        // biome-ignore lint/a11y/noAutofocus: the composer opens on request and is ready to type in
        autoFocus
        rows={2}
        maxLength={200}
        aria-label={`New card in ${columnName}`}
        placeholder="What needs to be done?"
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="w-full resize-none bg-transparent text-[13px] font-medium leading-snug text-text placeholder:font-normal placeholder:text-text-muted focus-visible:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" type="submit" disabled={!title.trim()} loading={saving}>
          Add card
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-text-muted">Enter to add</span>
      </div>
    </form>
  );
}
function shortDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "<1m";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function CardTile({
  card,
  board,
  members,
  now,
  dragged,
  canDrag,
  onOpen,
  onMenu,
  onDrag,
  onDragEnd,
}: {
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
}) {
  const running = card.timerStartedAt !== undefined;
  const tracked =
    card.trackedMs +
    (card.timerStartedAt === undefined ? 0 : Math.max(0, now - card.timerStartedAt));
  const done = card.checklist.filter((i) => i.done).length;
  const due = card.dueAt === undefined ? null : dueLabel(card.dueAt, now);
  const meta = "flex items-center gap-1";
  const hasFooter =
    card.priority !== "none" ||
    due !== null ||
    card.checklist.length > 0 ||
    card.fileIds.length > 0 ||
    card.githubLinks.length > 0 ||
    tracked > 0 ||
    running ||
    card.assigneeIds.length > 0;
  return (
    // While dragged the card steps out of the list; a placeholder shows where it will land.
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the actions button
    <div
      {...(dragged ? {} : { "data-flip": card._id, "data-card": card._id })}
      className={cn(
        "group relative shrink-0",
        dragged && "pointer-events-none !absolute h-0 w-0 overflow-hidden opacity-0",
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(e);
      }}
    >
      <button
        type="button"
        aria-label={`Open card ${card.title}`}
        draggable={canDrag}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card._id);
          onDrag(e.currentTarget.offsetHeight);
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-2 rounded-[10px] border border-border bg-surface-1 p-3 text-left shadow-sm shadow-black/5 transition duration-150 ease-out",
          "hover:-translate-y-px hover:border-text-muted/40 hover:shadow-md hover:shadow-black/10 active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          canDrag && "cursor-grab active:cursor-grabbing",
        )}
      >
        {!!card.labelIds.length && (
          <span className="flex flex-wrap gap-1 pr-6">
            {board.labels
              .filter((l) => card.labelIds.includes(l.id))
              .map((l) => (
                <LabelChip key={l.id} name={l.name} color={l.color} />
              ))}
          </span>
        )}
        <span
          className={cn(
            "break-words text-[13px] font-medium leading-snug",
            !card.labelIds.length && "pr-6",
          )}
        >
          {card.title}
        </span>
        {hasFooter && (
          <span className="flex items-end gap-2">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-muted">
              {card.priority !== "none" && (
                <span className={cn(meta, PRIORITY[card.priority].tone)}>
                  <PriorityFlag priority={card.priority} size={12} />
                  {PRIORITY[card.priority].label}
                </span>
              )}
              {due && (
                <span
                  className={cn(meta, due.overdue && !card.archived && "text-danger")}
                  title={due.overdue ? "Overdue" : "Due date"}
                >
                  <Icon name="calendar" size={12} />
                  {due.text}
                </span>
              )}
              {!!card.checklist.length && (
                <span
                  className={cn(meta, done === card.checklist.length && "text-secondary")}
                  title="Checklist"
                >
                  <Icon name="checklist" size={12} />
                  {done}/{card.checklist.length}
                </span>
              )}
              {!!card.fileIds.length && (
                <span className={meta} title="Attachments">
                  <Icon name="paperclip" size={12} />
                  {card.fileIds.length}
                </span>
              )}
              {!!card.githubLinks.length && (
                <span className={meta} title="GitHub links">
                  <Icon name="link" size={12} />
                  {card.githubLinks.length}
                </span>
              )}
              {(tracked > 0 || running) && (
                <span
                  className={cn(meta, "tabular-nums", running && "font-medium text-accent")}
                  title={running ? "Timer running" : "Time tracked"}
                >
                  <Icon name="timer" size={12} className={running ? "animate-pulse" : undefined} />
                  {running ? kanbanDuration(tracked) : shortDuration(tracked)}
                </span>
              )}
            </span>
            <AvatarStack userIds={card.assigneeIds} members={members} />
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Actions for ${card.title}`}
        onClick={(e) => onMenu(below(e))}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] bg-surface-1 text-text-muted opacity-0 transition hover:bg-surface-3 hover:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <Icon name="more-horizontal" size={16} />
      </button>
    </div>
  );
}
