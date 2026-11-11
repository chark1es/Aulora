import {
  Button,
  cn,
  Icon,
  IconButton,
  MODAL_SHADOW,
  SegmentedControl,
  Spinner,
  usePrefersReducedMotion,
} from "@aulora/ui-web";
import { Component, type ReactNode, useState } from "react";
import { NoteDialogs } from "./NoteDialogs";
import { NoteEditor } from "./NoteEditor";
import { NoteHistory } from "./NoteHistory";
import { NotesLibrary } from "./NotesLibrary";
import { folderPath, relativeTime } from "./types";
import { type NotesController, type NotesProps, useNotes } from "./use-notes";

interface BoundaryProps {
  children: ReactNode;
  onBack: () => void;
}

/** Keeps a failed notes query from taking the whole chat down with it. */
class NotesBoundary extends Component<BoundaryProps, { error: boolean }> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="pane flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-5">
        <h2 className="text-lg font-semibold">Notes could not load</h2>
        <p className="max-w-md text-center text-sm text-text-muted">
          The addon may be disabled or your access may have changed. Return to chat, or retry to
          reload your notes.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={this.props.onBack}>
            Back to chat
          </Button>
          <Button
            onClick={() => {
              this.setState({ error: false });
            }}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }
}

function NotesHeader({ ctl }: { ctl: NotesController }) {
  return (
    <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <IconButton label="Back to chat" size="sm" onClick={ctl.onBack}>
        <Icon name="chevron-left" size={18} />
      </IconButton>
      <Icon name="note" size={18} className="text-accent-text" />
      <span className="min-w-0 truncate text-[15px] font-semibold">Notes</span>
      <span className="flex-1" />
      <span className="text-xs tabular-nums text-text-muted">
        {ctl.notes.length} {ctl.notes.length === 1 ? "note" : "notes"}
      </span>
    </header>
  );
}

/** A failed write, shown until it is dismissed or the next write starts. */
function NotesError({ ctl }: { ctl: NotesController }) {
  if (ctl.error === undefined) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 animate-fade-in items-center gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2 text-[13px] text-danger-text"
    >
      <p className="flex-1">{ctl.error}</p>
      <IconButton
        label="Dismiss error"
        size="sm"
        className="text-danger-text hover:text-danger-text"
        onClick={ctl.clearError}
      >
        <Icon name="x" size={14} />
      </IconButton>
    </div>
  );
}

/** Secondary and destructive note actions, kept out of the way of the content. */
function DetailMenu({ ctl }: { ctl: NotesController }) {
  const [open, setOpen] = useState(false);
  const detail = ctl.detail;
  if (detail === undefined) return null;
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="relative">
      <IconButton
        label="More actions"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Icon name="more-horizontal" size={18} />
      </IconButton>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className={cn(
              "absolute right-0 top-[calc(100%+4px)] z-50 w-44 rounded-[12px] bg-surface-2 p-1",
              MODAL_SHADOW,
            )}
          >
            <button
              type="button"
              role="menuitem"
              disabled={!ctl.canEdit || ctl.busy}
              onClick={() => {
                close();
                void ctl.archiveNote(detail, !detail.archived);
              }}
              className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3 disabled:opacity-50"
            >
              <Icon name={detail.archived ? "unarchive" : "archive"} size={15} />
              {detail.archived ? "Restore" : "Archive"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!ctl.canDelete || ctl.busy}
              onClick={() => {
                close();
                ctl.requestDeleteNote(detail);
              }}
              className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-danger-text transition hover:bg-danger/10 disabled:opacity-50"
            >
              <Icon name="trash" size={15} />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DetailEditAction({ ctl }: { ctl: NotesController }) {
  return (
    <>
      {ctl.tab === "edit" &&
        (ctl.editing ? (
          <Button
            size="sm"
            disabled={!ctl.canEdit || !ctl.dirty || ctl.busy}
            loading={ctl.busy}
            leading={<Icon name="check" size={14} />}
            onClick={() => void ctl.saveNote()}
          >
            Save
          </Button>
        ) : ctl.canEdit ? (
          <Button
            size="sm"
            leading={<Icon name="pencil" size={14} />}
            onClick={() => {
              ctl.setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : null)}
    </>
  );
}

function DetailTabs({ ctl }: { ctl: NotesController }) {
  const now = Date.now();
  const path = folderPath(ctl.folders, ctl.detail?.folderId ?? null);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <IconButton label="Back to list" size="sm" onClick={ctl.closeNote}>
        <Icon name="chevron-left" size={16} />
      </IconButton>
      <nav
        className="flex min-w-0 flex-1 items-center gap-1 text-[12px] text-text-muted"
        aria-label="Note folder"
      >
        <Icon name="grid" size={13} className="shrink-0" />
        <span className="shrink-0">Notes</span>
        {path.map((folder) => (
          <span key={folder.id} className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">›</span>
            <span className="truncate">{folder.name}</span>
          </span>
        ))}
        {ctl.detail !== undefined && (
          <span className="ml-2 hidden shrink-0 text-[11px] lg:inline">
            Updated {relativeTime(ctl.detail.updatedAt, now)}
          </span>
        )}
      </nav>
      <SegmentedControl
        label="Note view"
        value={ctl.tab}
        onChange={ctl.setTab}
        options={[
          { value: "edit", label: "Note" },
          { value: "history", label: "History" },
        ]}
      />
      <DetailMenu ctl={ctl} />
      <DetailEditAction ctl={ctl} />
    </div>
  );
}

/** The right-hand pane: the open note, or a spinner while it loads. */
function DetailPane({ ctl }: { ctl: NotesController }) {
  if (ctl.detail === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Loading note" />
      </div>
    );
  }
  return (
    <>
      <DetailTabs ctl={ctl} />
      {ctl.conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 p-4 text-sm text-text">
          <p>
            This note changed while you were editing. Reload the latest version or keep your draft
            and save again.
          </p>
          <Button size="sm" onClick={ctl.reloadLatest}>
            Reload latest
          </Button>
          <Button size="sm" onClick={ctl.overwriteWithMyVersion}>
            Keep my version
          </Button>
        </div>
      )}
      {ctl.replacingNewerVersion && (
        <p role="status" className="px-4 pb-3 text-sm text-text">
          Saving will replace the newer version
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ctl.tab === "edit" ? <NoteEditor ctl={ctl} /> : <NoteHistory ctl={ctl} />}
      </div>
    </>
  );
}

/** Row skeletons for the notes library while its first page loads. */
function NotesListSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1" aria-busy="true">
      <p role="status" className="sr-only">
        Loading notes
      </p>
      <aside aria-hidden="true" className="min-h-0 w-full shrink-0 border-border">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
          <span className="h-8 w-full animate-pulse rounded-input bg-surface-3 motion-reduce:animate-none" />
          <span className="h-4 w-40 animate-pulse rounded bg-surface-3 motion-reduce:animate-none" />
        </div>
        <ul className="flex flex-col gap-0.5 p-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <li key={row} className="flex flex-col gap-1.5 rounded-[8px] px-2.5 py-2">
              <span className="h-3.5 w-2/3 animate-pulse rounded bg-surface-3 motion-reduce:animate-none" />
              <span className="h-2.5 w-full animate-pulse rounded bg-surface-3 motion-reduce:animate-none" />
              <span className="h-2.5 w-24 animate-pulse rounded bg-surface-3 motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function NotesContent(props: NotesProps) {
  const ctl = useNotes(props);
  const reduced = usePrefersReducedMotion();
  const selected = ctl.noteId !== undefined;
  if (!ctl.canView) {
    return (
      <section className="pane flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-5">
        <p className="text-sm text-text-muted">You do not have access to Notes.</p>
      </section>
    );
  }
  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Notes">
      <NotesHeader ctl={ctl} />
      <NotesError ctl={ctl} />
      {ctl.overview === undefined ? (
        <NotesListSkeleton />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          <NotesLibrary ctl={ctl} />
          {selected && (
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col",
                !reduced && "animate-slide-in-right",
              )}
            >
              <DetailPane ctl={ctl} />
            </div>
          )}
        </div>
      )}
      <NoteDialogs ctl={ctl} />
    </section>
  );
}

/** The Notes addon: folders and tags on the left, a note list, and an editor/history. */
export function NotesView(props: NotesProps) {
  return (
    <NotesBoundary onBack={props.onBack}>
      <NotesContent {...props} />
    </NotesBoundary>
  );
}
