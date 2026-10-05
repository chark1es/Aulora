import { Button, cn, Icon } from "@aulora/ui-web";
import { useLayoutEffect, useRef, useState } from "react";
import { field, rowAction, Section } from "./card-parts";
import { CheckMark } from "./controls";
import { control, newItemId } from "./types";
import type { CardDraft, CardEditor } from "./use-card-editor";

interface Props {
  editor: CardEditor;
}

/** Why the card cannot be edited as it stands, with the way out. */
export function CardBanners({ editor }: Props) {
  return (
    <>
      {editor.card.archived && (
        <p className="flex items-center gap-2 rounded-[8px] bg-surface-3 px-3 py-2 text-[13px] text-text-muted">
          <Icon name="archive" size={14} />
          This card is archived. Restore it to make changes.
        </p>
      )}
      {editor.stale && (
        <div className="flex animate-slide-up items-center gap-3 rounded-[8px] border border-idle/40 bg-idle/10 px-3 py-2 text-[13px]">
          <span className="flex-1">This card changed while you were editing.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (editor.dirty) editor.setConfirm("reload");
              else editor.reload();
            }}
          >
            Reload card
          </Button>
        </div>
      )}
    </>
  );
}

/** The title wraps instead of scrolling sideways, so the field grows with it. */
export function CardTitle({ editor }: Props) {
  const titleField = useRef<HTMLTextAreaElement | null>(null);
  const { title } = editor.draft;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the title changes
  useLayoutEffect(() => {
    const node = titleField.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight + 2}px`;
  }, [title]);
  return (
    <textarea
      ref={titleField}
      aria-label="Title"
      placeholder="Card title"
      rows={1}
      maxLength={200}
      value={title}
      onChange={(event) => {
        editor.setDraft({ ...editor.draft, title: event.target.value.replace(/\n/g, " ") });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      className="-mx-2 w-[calc(100%+1rem)] resize-none overflow-hidden rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-text placeholder:text-text-muted enabled:hover:bg-surface-3 focus-visible:border-accent focus-visible:bg-surface-3 focus-visible:outline-none"
    />
  );
}

export function CardNotes({ editor }: Props) {
  return (
    <Section icon="note" title="Notes">
      <textarea
        aria-label="Notes"
        rows={5}
        maxLength={30000}
        placeholder={editor.canEdit ? "Add details, context or links…" : "No notes"}
        className={cn(control, "resize-y leading-relaxed placeholder:text-text-muted")}
        value={editor.draft.notes}
        onChange={(event) => {
          editor.setDraft({ ...editor.draft, notes: event.target.value });
        }}
      />
    </Section>
  );
}

type Item = CardDraft["checklist"][number];

function ItemRow({ editor, item }: Props & { item: Item }) {
  const { draft } = editor;
  const toggle = () => {
    editor.setDraft({
      ...draft,
      checklist: draft.checklist.map((entry) =>
        entry.id === item.id ? { ...entry, done: !entry.done } : entry,
      ),
    });
  };
  const remove = () => {
    editor.setDraft({
      ...draft,
      checklist: draft.checklist.filter((entry) => entry.id !== item.id),
    });
  };
  const items = editor.canEdit
    ? [
        {
          id: "toggle",
          label: item.done ? "Mark as not done" : "Mark as done",
          icon: <Icon name="check" size={14} />,
          onSelect: toggle,
        },
        {
          id: "remove",
          label: "Remove item",
          icon: <Icon name="trash" size={14} />,
          danger: true,
          onSelect: remove,
        },
      ]
    : [];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's own controls
    <div
      className="group -mx-1.5 flex animate-message-in items-start gap-1 rounded-[7px] px-1.5 transition-colors hover:bg-surface-3"
      onContextMenu={(event) => {
        editor.menu(event, "Checklist item actions", items);
      }}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 py-1.5 text-[13px]">
        <input type="checkbox" className="peer sr-only" checked={item.done} onChange={toggle} />
        <CheckMark className="mt-px" />
        <span
          className={cn(
            "min-w-0 break-words transition-colors",
            item.done && "text-text-muted line-through",
          )}
        >
          {item.text}
        </span>
      </label>
      {editor.canEdit && (
        <button
          type="button"
          aria-label={`Remove checklist item ${item.text}`}
          className={cn(rowAction, "mt-1")}
          onClick={remove}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

function AddItem({ editor }: Props) {
  const [text, setText] = useState("");
  const { draft } = editor;
  const full = draft.checklist.length >= 100;
  const add = () => {
    if (!text.trim() || full) return;
    const item = { id: newItemId(), text: text.trim(), done: false };
    editor.setDraft({ ...draft, checklist: [...draft.checklist, item] });
    setText("");
  };
  return (
    <div className="flex gap-2">
      <input
        aria-label="New checklist item"
        placeholder="Add an item"
        maxLength={500}
        className={cn(field, "h-9 px-3")}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add();
        }}
      />
      <Button variant="secondary" disabled={!text.trim() || full} onClick={add}>
        Add
      </Button>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-3">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300 ease-out",
          done === total ? "bg-secondary" : "bg-accent",
        )}
        style={{ width: `${(done / total) * 100}%` }}
      />
    </div>
  );
}

export function CardChecklist({ editor }: Props) {
  const items = editor.draft.checklist;
  const done = items.filter((item) => item.done).length;
  return (
    <Section
      icon="checklist"
      title="Checklist"
      aside={
        items.length > 0 && (
          <span className="text-xs tabular-nums text-text-muted">
            {done} of {items.length} done
          </span>
        )
      }
    >
      {items.length > 0 && <Progress done={done} total={items.length} />}
      <div className="flex flex-col">
        {items.map((item) => (
          <ItemRow key={item.id} editor={editor} item={item} />
        ))}
      </div>
      {items.length === 0 && !editor.canEdit && (
        <p className="text-xs text-text-muted">No checklist items.</p>
      )}
      {editor.canEdit && <AddItem editor={editor} />}
    </Section>
  );
}
