import { Button, Spinner } from "@aulora/ui-web";
import { Component, type ReactNode } from "react";
import { BoardColumns } from "./BoardColumns";
import { BoardDialogs } from "./BoardDialogs";
import { BoardEmpty, BoardError, BoardHeader } from "./BoardHeader";
import { ArchivedBanner, BoardToolbar } from "./BoardToolbar";
import { type BoardController, type KanbanProps, useBoard } from "./use-board";

interface BoundaryProps {
  children: ReactNode;
  onBack: () => void;
}

/** Keeps a failed board query from taking the whole chat down with it. */
class KanbanBoundary extends Component<BoundaryProps, { error: boolean }> {
  override state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  override render() {
    if (!this.state.error) return this.props.children;
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

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

/** The open board: its toolbar, then its columns once the cards have loaded. */
function BoardBody({ ctl }: { ctl: BoardController }) {
  const { board } = ctl;
  if (ctl.boards === undefined) return <Loading label="Loading boards" />;
  if (board === undefined) return <BoardEmpty ctl={ctl} />;
  return (
    <>
      <BoardToolbar ctl={ctl} board={board} />
      <ArchivedBanner ctl={ctl} board={board} />
      {ctl.cards === undefined ? (
        <Loading label="Loading cards" />
      ) : (
        <BoardColumns ctl={ctl} board={board} />
      )}
    </>
  );
}

function KanbanContent(props: KanbanProps) {
  const ctl = useBoard(props);
  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Kanban board">
      <BoardHeader ctl={ctl} />
      <BoardError ctl={ctl} />
      <BoardBody ctl={ctl} />
      <BoardDialogs ctl={ctl} />
    </section>
  );
}

/** The Kanban addon: one board at a time, with its cards in columns. */
export function KanbanView(props: KanbanProps) {
  return (
    <KanbanBoundary onBack={props.onBack}>
      <KanbanContent {...props} />
    </KanbanBoundary>
  );
}
