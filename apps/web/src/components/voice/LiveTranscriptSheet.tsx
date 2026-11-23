import { formatTranscriptTime } from "@aulora/core";
import {
  Badge,
  Button,
  cn,
  Icon,
  IconButton,
  Spinner,
  Text,
  usePrefersReducedMotion,
} from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { requestOpenTranscript } from "../../lib/transcription/transcript-navigation";
import { groupEditableTurns } from "../transcripts/transcript-turns";

/** How many of the newest lines the panel follows. The server clamps to 80. */
const LIVE_LINES = 50;
/** Distance from the bottom that still counts as "following the newest line". */
const STICK_PX = 32;

/** The live transcript body. Loaded on demand the first time the panel opens. */
export function LiveTranscriptPanel({
  sessionId,
  open,
  onClose,
  onOpenFull,
}: {
  readonly sessionId: string | null;
  readonly open: boolean;
  readonly onOpenFull?: () => void;
  readonly onClose: () => void;
}) {
  // "skip" releases the subscription whenever the panel is closed.
  const live = useQuery(
    api.transcription.liveSegments,
    open && sessionId !== null
      ? { sessionId: sessionId as Id<"transcriptionSessions">, limit: LIVE_LINES }
      : "skip",
  );
  const reducedMotion = usePrefersReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const segments = live?.segments;
  const turns = useMemo(
    () =>
      groupEditableTurns(
        (segments ?? []).map((segment) => ({
          id: segment.id,
          seq: segment.seq,
          speakerKey: segment.speakerKey,
          speakerName: segment.speakerName,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
          edited: segment.edited,
        })),
      ),
    [segments],
  );
  const newest = segments?.at(-1);
  const newestId = newest?.id ?? null;
  const newestText = newest?.text ?? null;

  const scrollToEnd = (smooth: boolean) => {
    const node = scroller.current;
    if (node !== null) {
      node.scrollTo?.({
        top: node.scrollHeight,
        behavior: smooth && !reducedMotion ? "smooth" : "auto",
      });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest line changes
  useEffect(() => {
    if (following) {
      scrollToEnd(false);
    }
  }, [newestId, newestText, following]);

  if (!open || sessionId === null) {
    return null;
  }

  const announcement =
    newest !== undefined ? `${newest.speakerName.trim() || "Someone"}: ${newest.text}` : "";

  return (
    <aside
      aria-label="Live transcript"
      className={cn(
        "flex min-h-0 flex-col bg-surface-1",
        "md:w-[320px] md:shrink-0 md:border-l md:border-border",
        "max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:max-h-[60%] max-md:rounded-t-[14px] max-md:border-t max-md:border-border max-md:shadow-2xl max-md:shadow-black/40",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
          Live transcript
        </h3>
        {live?.status === "active" && <Badge tone="success">Live</Badge>}
        <IconButton label="Close live transcript" size="sm" onClick={onClose}>
          <Icon name="x" size={14} />
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          data-testid="live-transcript-scroll"
          className="h-full max-h-full overflow-y-auto px-3 py-2"
          onScroll={(event) => {
            const node = event.currentTarget;
            setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight <= STICK_PX);
          }}
        >
          {live === undefined ? (
            <div className="flex justify-center py-6">
              <Spinner label="Loading live transcript" />
            </div>
          ) : live === null ? (
            <Text tone="muted" size="sm">
              This transcript is no longer available.
            </Text>
          ) : turns.length === 0 ? (
            <Text tone="muted" size="sm">
              Listening… lines appear here a few seconds after someone speaks.
            </Text>
          ) : (
            <ol className="flex flex-col gap-2.5" aria-label="Transcript lines">
              {turns.map((turn) => (
                <li key={turn.key} className="min-w-0">
                  <p className="flex items-baseline gap-1.5 text-[12px] font-semibold text-text">
                    <span className="truncate">{turn.speakerName}</span>
                    <span className="text-[11px] font-normal tabular-nums text-text-muted">
                      {formatTranscriptTime(turn.startMs)}
                    </span>
                    {turn.edited && (
                      <span className="text-[11px] font-normal text-text-muted">edited</span>
                    )}
                  </p>
                  <p className="text-[13px] leading-relaxed text-text">{turn.text}</p>
                </li>
              ))}
            </ol>
          )}
          {live != null && live.status !== "active" && (
            <p className="pt-2 text-[12px] text-text-muted">Transcription has ended.</p>
          )}
        </div>
        {!following && (
          <button
            type="button"
            onClick={() => {
              setFollowing(true);
              scrollToEnd(true);
            }}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] font-medium text-text shadow-lg transition hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon name="arrow-down" size={12} />
            Jump to latest
          </button>
        )}
      </div>

      {/* Announces only the newest line, not the whole transcript. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <footer className="shrink-0 border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          leading={<Icon name="expand" size={14} />}
          onClick={() => {
            onOpenFull?.();
            requestOpenTranscript(sessionId);
          }}
        >
          Open full transcript
        </Button>
      </footer>
    </aside>
  );
}

export default LiveTranscriptPanel;
