import { Icon, Text } from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { ActionButton } from "./MemberActions";

export function MemberNote({ userId }: { readonly userId: string }) {
  const note = useQuery(api.notes.get, { targetUserId: userId });
  const upsert = useMutation(api.notes.upsert);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(note?.body ?? "");
  }, [note?.body]);

  const dirty = body !== (note?.body ?? "");

  return (
    <section
      className="flex flex-col gap-2 border-t border-border pt-4"
      data-testid={`member-note-${userId}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon name="note" size={14} className="text-text-muted" />
        <Text as="h4" size="xs" tone="muted" className="font-semibold uppercase tracking-[0.06em]">
          Private note
        </Text>
        {(note?.body ?? "").trim().length > 0 && (
          <span className="flex h-1.5 w-1.5 rounded-full bg-accent" title="Note saved" />
        )}
      </div>
      <textarea
        aria-label="Private note"
        rows={3}
        value={body}
        maxLength={1000}
        placeholder="Only you can see this note about this member."
        onChange={(event) => {
          setBody(event.currentTarget.value);
          setSaved(false);
        }}
        className="resize-none rounded-[8px] border border-border bg-surface-1 px-2.5 py-2 text-[13px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <NoteActions
        busy={busy}
        dirty={dirty}
        saved={saved}
        error={error}
        onSave={() => {
          setError(null);
          setBusy(true);
          void upsert({ targetUserId: userId, body: body.trim() })
            .then(() => {
              setSaved(true);
            })
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Could not save the note.");
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
    </section>
  );
}

function NoteActions({
  busy,
  dirty,
  saved,
  error,
  onSave,
}: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly saved: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ActionButton disabled={busy || !dirty} onClick={onSave}>
        Save note
      </ActionButton>
      {saved && !dirty && (
        <Text size="xs" tone="secondary">
          Saved
        </Text>
      )}
      {error !== null && (
        <Text size="xs" tone="danger" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
