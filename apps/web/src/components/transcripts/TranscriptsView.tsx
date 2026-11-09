import {
  canDeleteTranscripts,
  formatLocalDateTime,
  hasPermission,
  Permission,
  parseTranscriptSummary,
  TRANSCRIPTION_MAX_LIST_SESSIONS,
} from "@aulora/core";
import {
  Badge,
  Button,
  ConfirmDialog,
  cn,
  EmptyState,
  Icon,
  IconButton,
  Spinner,
  Text,
} from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { AddonBoundary } from "../addons/AddonBoundary";
import { SummaryView } from "./SummaryView";
import { formatSessionLength, sessionTitle } from "./session-labels";
import { summaryPanel } from "./summary-state";
import { TranscriptBody } from "./TranscriptBody";

export interface TranscriptsViewProps {
  readonly permissions: bigint;
  readonly titles: ReadonlyMap<string, string>;
  readonly onBack: () => void;
}

/** The Transcripts surface: finished and live transcripts, with summaries. */
export function TranscriptsView(props: TranscriptsViewProps) {
  return (
    <AddonBoundary title="Transcripts" onBack={props.onBack}>
      <TranscriptsBody {...props} />
    </AddonBoundary>
  );
}

function TranscriptsBody({ permissions, titles, onBack }: TranscriptsViewProps) {
  const sessions = useQuery(api.transcription.listSessions, {
    limit: TRANSCRIPTION_MAX_LIST_SESSIONS,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sessions?.find((session) => session.id === openId) ?? null;

  return (
    <section className="pane flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Transcripts">
      <header className="material-chrome relative z-30 flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <IconButton
          label={open !== null ? "Back to transcripts" : "Back to chat"}
          size="sm"
          className={open !== null ? "" : "md:hidden"}
          onClick={() => {
            if (open !== null) {
              setOpenId(null);
            } else {
              onBack();
            }
          }}
        >
          <Icon name="chevron-left" size={18} />
        </IconButton>
        <Icon name="message" size={18} className="text-accent" />
        <h1 className="min-w-0 truncate text-[15px] font-semibold">Transcripts</h1>
      </header>

      {sessions === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="Loading transcripts" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon="message"
            title="No transcripts yet"
            description="When someone starts transcription in a call, the transcript and a summary show up here."
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul
            aria-label="Transcribed calls"
            className={cn(
              "min-h-0 w-full shrink-0 overflow-y-auto border-border p-2 md:w-[300px] md:border-r",
              open !== null && "hidden md:block",
            )}
          >
            {sessions.map((session) => {
              const selected = session.id === openId;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      setOpenId(session.id);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      selected ? "bg-accent/10" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">
                        {sessionTitle(session.channelId, titles)}
                      </span>
                      {session.status === "active" && <Badge tone="success">Live</Badge>}
                      {session.status === "ending" && <Badge>Finishing</Badge>}
                      {session.status === "failed" && <Badge tone="danger">Failed</Badge>}
                    </span>
                    <span className="text-[12px] tabular-nums text-text-muted">
                      {formatLocalDateTime(session.startedAt)}
                    </span>
                    <span className="text-[12px] text-text-muted">
                      {formatSessionLength(session.startedAt, session.endedAt)} ·{" "}
                      {session.segmentCount} {session.segmentCount === 1 ? "line" : "lines"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={cn("min-h-0 min-w-0 flex-1", open === null && "hidden md:block")}>
            {open === null ? (
              <div className="flex h-full items-center justify-center p-6">
                <Text tone="muted" size="sm">
                  Choose a call to read its transcript.
                </Text>
              </div>
            ) : (
              <SessionDetail
                key={open.id}
                sessionId={open.id}
                title={sessionTitle(open.channelId, titles)}
                canDelete={canDeleteTranscripts(permissions)}
                canManage={hasPermission(permissions, Permission.ManageTranscription)}
                onDeleted={() => {
                  setOpenId(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SessionDetail({
  sessionId,
  title,
  canDelete,
  canManage,
  onDeleted,
}: {
  readonly sessionId: string;
  readonly title: string;
  readonly canDelete: boolean;
  readonly canManage: boolean;
  readonly onDeleted: () => void;
}) {
  const session = useQuery(api.transcription.getSession, { sessionId: sessionId as never });
  const requestSummary = useMutation(api.transcription.requestSummary);
  const deleteSession = useMutation(api.transcription.deleteSession);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // When this view first saw the summary pending, for sessions where the server
  // does not say when it was requested.
  const [pendingSeenAt, setPendingSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pending = session?.summaryStatus === "pending";
  useEffect(() => {
    if (!pending) {
      setPendingSeenAt(null);
      return;
    }
    setPendingSeenAt((current) => current ?? Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [pending]);

  if (session === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading transcript" />
      </div>
    );
  }
  const summary = parseTranscriptSummary(session.summary);
  // Not returned by the server today; used when it is, else this view's own clock.
  const extra = session as { summaryRequestedAt?: number | null };
  const requestedAt = extra.summaryRequestedAt ?? pendingSeenAt;
  const panel = summaryPanel({
    sessionStatus: session.status,
    summaryStatus: session.summaryStatus,
    hasSummary: summary !== null,
    configured: session.summaryConfigured,
    canManage,
    pendingForMs: pending && requestedAt !== null ? Math.max(0, now - requestedAt) : null,
  });
  const fail = (cause: unknown, fallback: string) => {
    setError(cause instanceof Error && cause.message.length > 0 ? cause.message : fallback);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 py-6">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em] text-text">
              {title}
            </h2>
            <p className="mt-0.5 text-[12.5px] tabular-nums text-text-muted">
              {formatLocalDateTime(session.startedAt)} ·{" "}
              {formatSessionLength(session.startedAt, session.endedAt)}
              {session.status === "active"
                ? " · live"
                : session.status === "ending"
                  ? " · finishing"
                  : ""}
            </p>
            {session.retentionExpiresAt !== null && (
              <p className="mt-0.5 text-[12px] text-text-muted">
                Deleted automatically {formatLocalDateTime(session.retentionExpiresAt)}.
              </p>
            )}
          </div>
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              leading={<Icon name="trash" size={14} />}
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              Delete
            </Button>
          )}
        </header>

        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}

        <section aria-labelledby="summary-heading" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 id="summary-heading" className="text-[14px] font-semibold text-text">
              Summary
            </h3>
            <span className="flex-1" />
            {panel.action !== null && (
              <Button
                variant="secondary"
                size="sm"
                loading={requesting}
                disabled={requesting}
                onClick={() => {
                  setRequesting(true);
                  setError(null);
                  void requestSummary({ sessionId: sessionId as never })
                    .catch((cause: unknown) => {
                      fail(cause, "Could not request a summary. Try again.");
                    })
                    .finally(() => {
                      setRequesting(false);
                    });
                }}
              >
                {panel.action === "generate" ? "Generate summary" : "Regenerate"}
              </Button>
            )}
          </div>
          {panel.kind === "pending" ? (
            <p role="status" className="flex items-center gap-2 text-[13px] text-text-muted">
              <Spinner size={16} label="Writing the summary" />
              {panel.stalled
                ? "Taking longer than expected. You can start it again."
                : "Writing the summary…"}
            </p>
          ) : panel.kind === "ready" && summary !== null ? (
            <>
              <SummaryView summary={summary} />
              {session.summaryModel !== null && session.summaryAt !== null && (
                <p className="text-[11.5px] text-text-muted">
                  Written by {session.summaryModel} on {formatLocalDateTime(session.summaryAt)}.
                  Summaries are generated by a language model and can be wrong.
                </p>
              )}
            </>
          ) : panel.kind === "error" ? (
            <Text tone="danger" size="sm" role="alert">
              {session.summaryError ?? "The summary could not be written."} Check the summary
              endpoint in Settings, then try again.
            </Text>
          ) : panel.kind === "not-configured" ? (
            <Text tone="muted" size="sm" role="status">
              No summary service configured.
              {panel.showSettingsHint
                ? " Set one up in Workspace settings > Addons > Transcription."
                : ""}
            </Text>
          ) : panel.kind === "waiting-for-end" ? (
            <Text tone="muted" size="sm">
              {session.status === "ending"
                ? "Collecting the last of the audio. The summary starts once the transcript is complete."
                : "A summary can be written once transcription has stopped."}
            </Text>
          ) : (
            <Text tone="muted" size="sm">
              Summary not generated yet.
            </Text>
          )}
        </section>

        <section aria-labelledby="transcript-heading" className="flex flex-col gap-2">
          <h3 id="transcript-heading" className="text-[14px] font-semibold text-text">
            Transcript
          </h3>
          <TranscriptBody sessionId={sessionId} />
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
        }}
        title="Delete this transcript?"
        description="The transcript and its summary are removed for everyone. This cannot be undone."
        confirmLabel="Delete transcript"
        variant="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          setError(null);
          void deleteSession({ sessionId: sessionId as never })
            .then(onDeleted)
            .catch((cause: unknown) => {
              fail(cause, "Could not delete the transcript. Try again.");
            });
        }}
      />
    </div>
  );
}
