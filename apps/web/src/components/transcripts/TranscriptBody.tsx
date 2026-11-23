import { formatTranscriptTime, TRANSCRIPTION_MAX_SEGMENT_CHARS } from "@aulora/core";
import { Badge, Button, Icon, IconButton, Spinner, Text, Textarea } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import { type EditableTurn, groupEditableTurns } from "./transcript-turns";

/**
 * The speaker-labelled transcript, one bounded page at a time. Each page is its
 * own reactive query keyed by the previous page’s opaque `nextCursor`, so a live
 * session keeps filling in and a long one is never loaded in a single read.
 */
export function TranscriptBody({
  sessionId,
  canEdit = false,
}: {
  readonly sessionId: string;
  /** Lets the viewer correct line text; the server enforces the permission. */
  readonly canEdit?: boolean;
}) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [lastNext, setLastNext] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1" data-testid="transcript-body">
      {cursors.map((cursor, index) => (
        <TranscriptPage
          key={cursor ?? "first"}
          sessionId={sessionId}
          cursor={cursor}
          canEdit={canEdit}
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
  canEdit,
  isLast,
  onNext,
}: {
  readonly sessionId: string;
  readonly cursor: string | null;
  readonly canEdit: boolean;
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
      groupEditableTurns(
        (page?.page ?? []).map((segment) => ({
          id: segment.id,
          seq: segment.seq,
          speakerKey: segment.speakerKey,
          speakerName: segment.speakerName,
          text: segment.text,
          startMs: segment.startMs,
          endMs: segment.endMs,
          edited: segment.edited === true,
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
        Nothing was said yet, or nobody’s speech was transcribed.
      </Text>
    );
  }
  return (
    <ol className="flex flex-col">
      {turns.map((turn) => (
        <TurnRow key={turn.key} turn={turn} canEdit={canEdit} />
      ))}
    </ol>
  );
}

function TurnRow({ turn, canEdit }: { readonly turn: EditableTurn; readonly canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="group grid grid-cols-[3.25rem_1fr] gap-x-3 py-2">
      <span className="pt-0.5 text-right text-[11.5px] tabular-nums text-text-muted">
        {formatTranscriptTime(turn.startMs)}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
          <span className="truncate">{turn.speakerName}</span>
          {turn.isGuest && <Badge size="sm">Guest</Badge>}
          {turn.edited && (
            <span className="text-[11px] font-normal text-text-muted" title="Corrected by hand">
              edited
            </span>
          )}
          {canEdit && !editing && (
            <IconButton
              label={`Edit ${turn.speakerName}'s lines at ${formatTranscriptTime(turn.startMs)}`}
              size="sm"
              className="ml-auto opacity-0 transition focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              onClick={() => {
                setEditing(true);
              }}
            >
              <Icon name="pencil" size={13} />
            </IconButton>
          )}
        </p>
        {editing ? (
          <TurnEditor
            turn={turn}
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-text">{turn.text}</p>
        )}
      </div>
    </li>
  );
}

function TurnEditor({
  turn,
  onDone,
}: {
  readonly turn: EditableTurn;
  readonly onDone: () => void;
}) {
  const updateSegment = useMutation(api.transcription.updateSegment);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(turn.lines.map((line) => [line.id, line.text.trim()])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = turn.lines.filter((line) => (drafts[line.id] ?? "").trim() !== line.text.trim());
  const invalid = changed.some((line) => {
    const length = (drafts[line.id] ?? "").trim().length;
    return length === 0 || length > TRANSCRIPTION_MAX_SEGMENT_CHARS;
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const line of changed) {
        await updateSegment({
          segmentId: line.id as Id<"transcriptSegments">,
          text: (drafts[line.id] ?? "").trim(),
        });
      }
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Could not save the correction. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex max-w-[68ch] flex-col gap-2 pt-1"
      aria-label={`Edit ${turn.speakerName}'s lines`}
      onSubmit={(event) => {
        event.preventDefault();
        if (changed.length === 0) {
          onDone();
        } else if (!invalid && !saving) {
          void save();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      {turn.lines.map((line, index) => (
        <Textarea
          key={line.id}
          label={`Line ${index + 1} of ${turn.lines.length}`}
          hideLabel={turn.lines.length === 1}
          rows={2}
          autoFocus={index === 0}
          value={drafts[line.id] ?? ""}
          disabled={saving}
          onChange={(event) => {
            setDrafts((current) => ({ ...current, [line.id]: event.target.value }));
          }}
        />
      ))}
      {invalid && (
        <Text tone="danger" size="sm" role="alert">
          Each line needs text, up to {TRANSCRIPTION_MAX_SEGMENT_CHARS} characters.
        </Text>
      )}
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={saving} disabled={saving || invalid}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
