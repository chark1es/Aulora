import { Icon, IconButton, SegmentedControl, Spinner } from "@aulora/ui-web";
import { Component, type ReactNode, useState } from "react";
import { NoteDialogs } from "./NoteDialogs";
import { NoteEditor } from "./NoteEditor";
import { NoteHistory } from "./NoteHistory";
import { NotesLibrary } from "./NotesLibrary";
import { folderPath, type NoteSummary } from "./types";
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
          <button
            type="button"
            className="rounded-[9px] bg-surface-3 px-3 py-1.5 text-[13px] text-text"
            onClick={this.props.onBack}
          >
            Back to chat
          </button>
          <button
            type="button"
            className="rounded-[9px] bg-accent px-3 py-1.5 text-[13px] text-on-accent"
            onClick={() => {
              this.setState({ error: false });
            }}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }
}

function NotesHeader({ ctl, onBack }: { ctl: NotesController; onBack: () => void }) {
  return (
    <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <IconButton label="Back to chat" size="sm" onClick={onBack}>
        <Icon name="chevron-left" size={18} />
      </IconButton>
      <Icon name="note" size={18} className="text-accent" />
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
      className="flex shrink-0 animate-fade-in items-center gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2 text-[13px] text-danger"
    >
      <p className="flex-1">{ctl.error}</p>
      <IconButton
        label="Dismiss error"
        size="sm"
        className="text-danger hover:text-danger"
        onClick={ctl.clearError}
      >
        <Icon name="x" size={14} />
      </IconButton>
    </div>
  );
}

/** The breadcrumb and view switch above an open note. */
function DetailHeader({ ctl, onBackToList }: { ctl: NotesController; onBackToList: () => void }) {
  const path = folderPath(ctl.folders, ctl.detail?.folderId ?? null);
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      <IconButton label="Back to notes" size="sm" onClick={onBackToList}>
        <Icon name="chevron-left" size={18} />
      </IconButton>
      <nav
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px] text-text-muted"
        aria-label="Note location"
      >
        <span className="shrink-0">Notes</span>
        {path.map((folder) => (
          <span key={folder.id} className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">›</span>
            <span className="truncate">{folder.name}</span>
          </span>
        ))}
        <span className="shrink-0">›</span>
        <span className="truncate font-semibold text-text">
          {ctl.detail?.title.trim() || "Untitled note"}
        </span>
      </nav>
      <SegmentedControl
        label="Note view"
        value={ctl.tab}
        onChange={ctl.setTab}
        options={[
          { value: "edit", label: "Edit" },
          { value: "history", label: "History" },
        ]}
      />
    </div>
  );
}

function NotesContent(props: NotesProps) {
  const ctl = useNotes(props);
  const [detailOpen, setDetailOpen] = useState(false);

  if (!ctl.canView) {
    return (
      <section className="pane flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-5">
        <p className="text-sm text-text-muted">You do not have access to Notes.</p>
      </section>
    );
  }

  const openNote = (id: NoteSummary["id"]) => {
    ctl.setNoteId(id);
    ctl.setTab("edit");
    setDetailOpen(true);
  };
  const newNote = async () => {
    const id = await ctl.createNote();
    if (id !== undefined) setDetailOpen(true);
  };
  const backToList = () => {
    setDetailOpen(false);
  };

  const selected = detailOpen && ctl.noteId !== undefined;

  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Notes">
      <NotesHeader ctl={ctl} onBack={props.onBack} />
      <NotesError ctl={ctl} />
      {ctl.overview === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="Loading notes" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col">
            {selected ? (
              ctl.detail === undefined ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner label="Loading note" />
                </div>
              ) : (
                <>
                  <DetailHeader ctl={ctl} onBackToList={backToList} />
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {ctl.tab === "edit" ? <NoteEditor ctl={ctl} /> : <NoteHistory ctl={ctl} />}
                  </div>
                </>
              )
            ) : (
              <NotesLibrary ctl={ctl} onOpenNote={openNote} onNewNote={() => void newNote()} />
            )}
          </div>
        </div>
      )}
      <NoteDialogs ctl={ctl} />
    </section>
  );
}

/** The Notes addon: a single column that shows the list, then the open note. */
export function NotesView(props: NotesProps) {
  return (
    <NotesBoundary onBack={props.onBack}>
      <NotesContent {...props} />
    </NotesBoundary>
  );
}
