import { cn, Icon, Select, type SelectAction, type SelectOption } from "@aulora/ui-web";
import type { NoteDraft, NotesController } from "./use-notes";

/** The folder picker and the note's tags, above the body. */
export function EditorMeta({
  ctl,
  current,
  options,
  action,
}: {
  ctl: NotesController;
  current: NoteDraft;
  options: readonly SelectOption<string>[];
  action: SelectAction | undefined;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
        <Icon name="folder" size={14} className="shrink-0 text-text-muted" />
        <Select
          variant="bare"
          value={current.folderId ?? ""}
          options={options}
          triggerClassName="max-w-[20rem]"
          popupClassName="min-w-[18rem] max-w-[28rem]"
          {...(action !== undefined ? { action } : {})}
          onChange={(value: string) => {
            ctl.setDraft({
              ...current,
              folderId: value === "" ? null : (value as NoteDraft["folderId"]),
            });
          }}
        />
      </div>
      <span className="hidden h-3.5 w-px bg-border sm:block" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {ctl.tags.map((tag) => (
          <TagChip
            key={tag.id}
            label={tag.name}
            color={tag.color}
            active={current.tagIds.includes(tag.id)}
            disabled={!ctl.canEdit}
            onToggle={() => {
              const tagIds = current.tagIds.includes(tag.id)
                ? current.tagIds.filter((id) => id !== tag.id)
                : [...current.tagIds, tag.id];
              ctl.setDraft({ ...current, tagIds });
            }}
          />
        ))}
        {ctl.canEdit && (
          <button
            type="button"
            aria-label="New tag"
            title="New tag"
            onClick={() => {
              ctl.setTagDialog({ mode: "new" });
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
    </>
  );
}

/** One tag chip that toggles itself on the note. */
function TagChip({
  label,
  color,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  color: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] transition disabled:opacity-60",
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </button>
  );
}
