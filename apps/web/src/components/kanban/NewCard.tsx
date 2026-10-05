/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon } from "@aulora/ui-web";
import { useRef, useState } from "react";

export interface NewCardProps {
  full: boolean;
  columnName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCreate: (title: string) => Promise<boolean>;
}

/** The closed composer: a row that opens it, or says the column is full. */
function AddCardRow({ full, onOpen }: Pick<NewCardProps, "full" | "onOpen">) {
  return (
    <button
      type="button"
      disabled={full}
      onClick={onOpen}
      className="flex h-8 w-full shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-60"
    >
      {!full && <Icon name="plus" size={14} />}
      {full ? "Column limit reached" : "Add card"}
    </button>
  );
}

/** A card-shaped form at the foot of a column. It stays open after a save so several cards can be added in a row. */
export function NewCard(props: NewCardProps) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  if (!props.open || props.full) return <AddCardRow full={props.full} onOpen={props.onOpen} />;
  const submit = () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    void props.onCreate(title).then((saved) => {
      setSaving(false);
      if (saved) setTitle("");
      field.current?.focus();
    });
  };
  return (
    <form
      className="flex shrink-0 origin-top animate-pop-in flex-col gap-2 rounded-[10px] border border-accent/60 bg-surface-1 p-2.5 shadow-md shadow-black/10"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={field}
        // biome-ignore lint/a11y/noAutofocus: the composer opens on request and is ready to type in
        autoFocus
        rows={2}
        maxLength={200}
        aria-label={`New card in ${props.columnName}`}
        placeholder="What needs to be done?"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value.replace(/\n/g, " "));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            props.onClose();
          }
        }}
        className="w-full resize-none bg-transparent text-[13px] font-medium leading-snug text-text placeholder:font-normal placeholder:text-text-muted focus-visible:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" type="submit" disabled={!title.trim()} loading={saving}>
          Add card
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-text-muted">Enter to add</span>
      </div>
    </form>
  );
}
