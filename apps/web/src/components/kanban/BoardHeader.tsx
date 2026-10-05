import { Button, cn, Icon, IconButton } from "@aulora/ui-web";
import { below } from "./board-logic";
import { openBoardMenu } from "./board-menus";
import { AvatarStack, menuRow, popoverPanel, usePopover } from "./controls";
import type { Board } from "./types";
import type { BoardController } from "./use-board";

interface Props {
  ctl: BoardController;
}

function SwitcherButton({ ctl, open, onToggle }: Props & { open: boolean; onToggle: () => void }) {
  const { board } = ctl;
  return (
    <button
      type="button"
      aria-label={board ? `${board.name}, switch board` : "Switch board"}
      aria-haspopup="true"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex h-8 max-w-full items-center gap-2 rounded-[8px] px-2 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        open && "bg-surface-3",
      )}
    >
      <Icon name="kanban" size={18} className="text-accent" />
      <span className="min-w-0 truncate text-[15px] font-semibold">
        {board?.name ?? (ctl.archivedBoards ? "Archived boards" : "Kanban")}
      </span>
      {board?.private === true && <Icon name="lock" size={13} className="text-text-muted" />}
      {board?.archived === true && (
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          Archived
        </span>
      )}
      <Icon name="chevron-down" size={14} className="text-text-muted" />
    </button>
  );
}

function BoardRow({ ctl, entry, onDone }: Props & { entry: Board; onDone: () => void }) {
  const current = entry.id === ctl.board?.id;
  return (
    <button
      type="button"
      aria-current={current}
      className={menuRow}
      onClick={() => {
        ctl.setBoardId(entry.id);
        ctl.setError(undefined);
        onDone();
      }}
    >
      <Icon name={entry.private ? "lock" : "kanban"} size={14} className="text-text-muted" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {current && <Icon name="check" size={14} className="text-accent" />}
    </button>
  );
}

/** The board's name; pressing it lists the other boards, a new one and the archive. */
function BoardSwitcher({ ctl }: Props) {
  const { open, setOpen, rootRef, onKeyDown } = usePopover();
  const close = () => {
    setOpen(false);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the popover from any child
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <SwitcherButton
        ctl={ctl}
        open={open}
        onToggle={() => {
          setOpen(!open);
        }}
      />
      {open && (
        <div className={cn(popoverPanel, "left-0")}>
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {ctl.archivedBoards ? "Archived boards" : "Boards"}
          </p>
          <div className="max-h-72 overflow-y-auto">
            {ctl.visibleBoards.map((entry) => (
              <BoardRow key={entry.id} ctl={ctl} entry={entry} onDone={close} />
            ))}
            {ctl.visibleBoards.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-text-muted">No boards</p>
            )}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            {ctl.canManage && (
              <button
                type="button"
                className={menuRow}
                onClick={() => {
                  ctl.setNewBoard(true);
                  close();
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
                ctl.setArchivedBoards(!ctl.archivedBoards);
                ctl.setBoardId(undefined);
                close();
              }}
            >
              <Icon
                name={ctl.archivedBoards ? "kanban" : "archive"}
                size={14}
                className="text-text-muted"
              />
              {ctl.archivedBoards ? "Show active boards" : "Show archived boards"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** GitHub, settings and the board menu, shown once a board is open. */
function BoardButtons({ ctl, board }: Props & { board: Board }) {
  return (
    <>
      {board.private && (
        <AvatarStack userIds={board.memberIds} members={ctl.members} max={4} size={22} />
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          ctl.setGithub(true);
        }}
        leading={<Icon name="link" size={14} />}
      >
        GitHub
      </Button>
      {ctl.canManage && !board.archived && (
        <IconButton
          label="Board settings"
          size="sm"
          onClick={() => {
            ctl.setSettings(true);
          }}
        >
          <Icon name="settings" size={16} />
        </IconButton>
      )}
      <IconButton
        label="Board actions"
        size="sm"
        onClick={(event) => {
          openBoardMenu(ctl, below(event.currentTarget));
        }}
      >
        <Icon name="more-horizontal" size={16} />
      </IconButton>
    </>
  );
}

export function BoardHeader({ ctl }: Props) {
  const { board } = ctl;
  return (
    <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <IconButton label="Back to chat" size="sm" onClick={ctl.onBack}>
        <Icon name="chevron-left" size={18} />
      </IconButton>
      <BoardSwitcher ctl={ctl} />
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
      {board !== undefined && <BoardButtons ctl={ctl} board={board} />}
    </header>
  );
}

/** A failed write, shown until it is dismissed or the next write starts. */
export function BoardError({ ctl }: Props) {
  if (ctl.error === undefined) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 animate-fade-in items-center gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2 text-[13px] text-danger"
    >
      <p className="flex-1">{ctl.error}</p>
      <IconButton
        label="Dismiss error"
        size="sm"
        className="text-danger hover:text-danger"
        onClick={() => {
          ctl.setError(undefined);
        }}
      >
        <Icon name="x" size={14} />
      </IconButton>
    </div>
  );
}

function emptyMessage(ctl: BoardController): string {
  if (ctl.archivedBoards)
    return "Boards you archive are kept here until you restore or delete them.";
  if (ctl.canManage) return "Create a board, then organize your work into cards and columns.";
  return "No boards are available to you. Ask a board manager to create one or add you to a private board.";
}

/** Shown when there is no board to open. */
export function BoardEmpty({ ctl }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-accent-soft text-accent">
        <Icon name="kanban" size={28} />
      </span>
      <h2 className="text-lg font-semibold">
        {ctl.archivedBoards ? "No archived boards" : "Plan your next project"}
      </h2>
      <p className="max-w-md text-sm text-text-muted">{emptyMessage(ctl)}</p>
      {ctl.archivedBoards && (
        <Button
          variant="secondary"
          onClick={() => {
            ctl.setArchivedBoards(false);
          }}
        >
          Back to active boards
        </Button>
      )}
      {!ctl.archivedBoards && ctl.canManage && (
        <Button
          onClick={() => {
            ctl.setNewBoard(true);
          }}
        >
          Create your first board
        </Button>
      )}
    </div>
  );
}
