import { Button, Icon, IconButton, Input } from "@aulora/ui-web";
import { type Dispatch, useState } from "react";

export const SESSION_TITLE_MAX_CHARS = 120;

/**
 * The detail header's title with an inline rename. Saving an empty title
 * returns to the automatic one; the "Reset to automatic" button does the same
 * for a title someone set by hand. The parent owns whether the form is open,
 * and closes it once a rename succeeds.
 */
export function SessionTitle({
  title,
  editValue,
  subtitle,
  canEdit,
  editing,
  onEdit,
  ...form
}: {
  readonly title: string;
  /** What the rename field starts with: the stored title, or empty when automatic. */
  readonly editValue: string;
  /** The channel name, shown under an AI or user title. */
  readonly subtitle: string | null;
  readonly canEdit: boolean;
  readonly editing: boolean;
  readonly isUserTitle: boolean;
  readonly saving: boolean;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onRename: Dispatch<string>;
}) {
  if (editing) {
    return <RenameForm initial={editValue} {...form} />;
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
        {canEdit && (
          <IconButton label="Rename transcript" size="sm" onClick={onEdit}>
            <Icon name="pencil" size={14} />
          </IconButton>
        )}
      </div>
      {subtitle !== null && <p className="truncate text-[12.5px] text-text-muted">{subtitle}</p>}
    </div>
  );
}

function RenameForm({
  initial,
  isUserTitle,
  saving,
  onCancel,
  onRename,
}: {
  readonly initial: string;
  readonly isUserTitle: boolean;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onRename: Dispatch<string>;
}) {
  const [draft, setDraft] = useState(initial);
  const tooLong = draft.trim().length > SESSION_TITLE_MAX_CHARS;
  return (
    <form
      className="flex flex-col gap-2"
      aria-label="Rename transcript"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooLong && !saving) {
          onRename(draft.trim());
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
            onCancel();
          }
        }}
      />
      <RenameActions
        saving={saving}
        disabled={saving || tooLong}
        isUserTitle={isUserTitle}
        onCancel={onCancel}
        onReset={() => {
          onRename("");
        }}
      />
    </form>
  );
}

function RenameActions({
  saving,
  disabled,
  isUserTitle,
  onCancel,
  onReset,
}: {
  readonly saving: boolean;
  readonly disabled: boolean;
  readonly isUserTitle: boolean;
  readonly onCancel: () => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" loading={saving} disabled={disabled}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
        Cancel
      </Button>
      {isUserTitle && (
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onReset}>
          Reset to automatic
        </Button>
      )}
    </div>
  );
}
