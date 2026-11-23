import { Button, Icon, IconButton, Input } from "@aulora/ui-web";
import { useState } from "react";

export const SESSION_TITLE_MAX_CHARS = 120;

/**
 * The detail header's title with an inline rename. Saving an empty title
 * returns to the automatic one; the "Reset to automatic" button does the same
 * for a title someone set by hand.
 */
export function SessionTitle({
  title,
  editValue,
  subtitle,
  canEdit,
  isUserTitle,
  saving,
  onRename,
}: {
  readonly title: string;
  /** What the rename field starts with: the stored title, or empty when automatic. */
  readonly editValue: string;
  /** The channel name, shown under an AI or user title. */
  readonly subtitle: string | null;
  readonly canEdit: boolean;
  readonly isUserTitle: boolean;
  readonly saving: boolean;
  readonly onRename: (title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const tooLong = draft.trim().length > SESSION_TITLE_MAX_CHARS;

  const save = async (value: string) => {
    if (await onRename(value.trim())) {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <form
        className="flex flex-col gap-2"
        aria-label="Rename transcript"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooLong && !saving) {
            void save(draft);
          }
        }}
      >
        <Input
          label="Transcript title"
          value={draft}
          autoFocus
          placeholder="Leave empty for the automatic title"
          {...(tooLong ? { error: `At most ${SESSION_TITLE_MAX_CHARS} characters.` } : {})}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={saving} disabled={saving || tooLong}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          {isUserTitle && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                void save("");
              }}
            >
              Reset to automatic
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
        {canEdit && (
          <IconButton
            label="Rename transcript"
            size="sm"
            onClick={() => {
              setDraft(editValue);
              setEditing(true);
            }}
          >
            <Icon name="pencil" size={14} />
          </IconButton>
        )}
      </div>
      {subtitle !== null && <p className="truncate text-[12.5px] text-text-muted">{subtitle}</p>}
    </div>
  );
}
