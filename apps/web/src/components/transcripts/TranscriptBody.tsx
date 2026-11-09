import { formatTranscriptTime, groupTranscriptTurns } from "@aulora/core";
import { Badge, Button, Spinner, Text } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";

/**
 * The speaker-labelled transcript, one bounded page at a time. Each page is its
 * own reactive query keyed by the previous page's opaque `nextCursor`, so a live
 * session keeps filling in and a long one is never loaded in a single read.
 */
export function TranscriptBody({ sessionId }: { readonly sessionId: string }) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [lastNext, setLastNext] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1" data-testid="transcript-body">
      {cursors.map((cursor, index) => (
        <TranscriptPage
          key={cursor ?? "first"}
          sessionId={sessionId}
          cursor={cursor}
          isLast={index === cursors.length - 1}
          onNext={setLastNext}
        />
      ))}
      {lastNext !== null && (
        <div className="pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCursors((current) => [...current, lastNext]);
              setLastNext(null);
            }}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function TranscriptPage({
  sessionId,
  cursor,
  isLast,
  onNext,
}: {
  readonly sessionId: string;
  readonly cursor: string | null;
  readonly isLast: boolean;
  readonly onNext: (next: string | null) => void;
}) {
  // The page size is fixed by the server; `seq` is per speaker, so results keep
  // the order delivered (by start time) and are never keyed or sorted by it.
  const page = useQuery(api.transcription.listSegments, {
    sessionId: sessionId as Id<"transcriptionSessions">,
    ...(cursor !== null ? { cursor } : {}),
  });
  const turns = useMemo(
    () =>
      groupTranscriptTurns(
        (page?.page ?? []).map((segment) => ({
          id: segment.id,
          seq: segment.seq,
          speakerKey: segment.speakerKey,
          speakerName: segment.speakerName,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
        })),
      ),
    [page],
  );
  const nextCursor = page?.nextCursor ?? null;
  // Only the newest page tells the parent whether there is more to load.
  useEffect(() => {
    if (isLast) {
      onNext(nextCursor);
    }
  }, [isLast, nextCursor, onNext]);
  if (page === undefined) {
    return (
      <div className="flex justify-center py-6">
        <Spinner label="Loading transcript" />
      </div>
    );
  }
  if (turns.length === 0 && cursor === null) {
    return (
      <Text tone="muted" size="sm">
        Nothing was said yet, or nobody's speech was transcribed.
      </Text>
    );
  }
  return (
    <ol className="flex flex-col">
      {turns.map((turn) => (
        <li key={turn.key} className="grid grid-cols-[3.25rem_1fr] gap-x-3 py-2">
          <span className="pt-0.5 text-right text-[11.5px] tabular-nums text-text-muted">
            {formatTranscriptTime(turn.startMs)}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
              <span className="truncate">{turn.speakerName}</span>
              {turn.isGuest && <Badge size="sm">Guest</Badge>}
            </p>
            <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-text">{turn.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
