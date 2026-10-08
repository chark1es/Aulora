import { cn, Icon, Select, type SelectOption } from "@aulora/ui-web";
import { useLayoutEffect, useRef, useState } from "react";
import { NotePreview } from "./NotePreview";
import { flattenFolders, type NoteFolder } from "./types";
import type { NotesController } from "./use-notes";

interface Edit {
  text: string;
  start: number;
  end: number;
}

function ToolButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The Markdown editor: title, folder and tags, a formatting toolbar and the body. */
export function NoteEditor({ ctl }: { ctl: NotesController }) {
  const { draft, detail } = ctl;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const element = bodyRef.current;
    if (selection === null || element === null) return;
    element.focus();
    element.setSelectionRange(selection[0], selection[1]);
    pendingSelection.current = null;
  });

  if (draft === undefined || detail === undefined) return null;
  const current = draft;

  const options: readonly SelectOption<string>[] = [
    { value: "", label: "No folder" },
    ...flattenFolders(ctl.folders).map(({ folder, depth }) => ({
      value: folder.id,
      label: `${"— ".repeat(depth)}${folder.name}`,
    })),
  ];

  if (!ctl.editing) {
    const folderLabel = options.find((option) => option.value === (current.folderId ?? ""))?.label;
    const selectedTags = ctl.tags.filter((tag) => current.tagIds.includes(tag.id));
    return (
      <div className="flex min-h-0 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <Icon name="grid" size={14} />
            {folderLabel ?? "No folder"}
          </span>
          {selectedTags.length > 0 && (
            <>
              <span className="h-3.5 w-px bg-border" />
              <span className="flex flex-wrap items-center gap-1.5">
                <Icon name="label" size={14} />
                {selectedTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[12px]"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NotePreview title={current.title} body={current.body} />
        </div>
        {ctl.error !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {ctl.error}
          </p>
        )}
      </div>
    );
  }

  // eslint-disable-next-line no-unused-vars -- base rule treats TypeScript callback parameters as variables
  const applyEdit = (transform: (value: string, start: number, end: number) => Edit) => {
    const element = bodyRef.current;
    if (element === null) return;
    const result = transform(current.body, element.selectionStart, element.selectionEnd);
    pendingSelection.current = [result.start, result.end];
    ctl.setDraft({ ...current, body: result.text });
  };

  const wrap = (before: string, after: string, placeholder: string) => {
    applyEdit((value, start, end) => {
      const selected = value.slice(start, end);
      const inner = selected.length > 0 ? selected : placeholder;
      const text = `${value.slice(0, start)}${before}${inner}${after}${value.slice(end)}`;
      const offset = start + before.length;
      return { text, start: offset, end: offset + inner.length };
    });
  };

  const prefixLines = (prefix: string, ordered: boolean) => {
    applyEdit((value, start, end) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const found = value.indexOf("\n", end);
      const lineEnd = found === -1 ? value.length : found;
      const replaced = value
        .slice(lineStart, lineEnd)
        .split("\n")
        .map((line, index) => `${ordered ? `${index + 1}. ` : prefix}${line}`)
        .join("\n");
      const text = `${value.slice(0, lineStart)}${replaced}${value.slice(lineEnd)}`;
      return { text, start: lineStart, end: lineStart + replaced.length };
    });
  };

  const insertLink = () => {
    applyEdit((value, start, end) => {
      const selected = value.slice(start, end);
      const label = selected.length > 0 ? selected : "text";
      const text = `${value.slice(0, start)}[${label}](url)${value.slice(end)}`;
      const urlStart = start + label.length + 3;
      return { text, start: urlStart, end: urlStart + 3 };
    });
  };

  const toggleTag = (tagId: string) => {
    ctl.setDraft({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((id) => id !== tagId)
        : [...current.tagIds, tagId],
    });
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <input
        aria-label="Note title"
        placeholder="Untitled note"
        maxLength={200}
        value={current.title}
        disabled={!ctl.canEdit}
        onChange={(event) => {
          ctl.setDraft({ ...current, title: event.target.value });
        }}
        className="w-full border-none bg-transparent text-2xl font-semibold tracking-tight text-text placeholder:text-text-muted focus-visible:outline-none disabled:opacity-60"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Icon name="grid" size={14} className="shrink-0 text-text-muted" />
          <Select
            variant="bare"
            value={current.folderId ?? ""}
            options={options}
            onChange={(value) => {
              ctl.setDraft({
                ...current,
                folderId: value === "" ? null : (value as NoteFolder["id"]),
              });
            }}
          />
        </div>
        <span className="hidden h-3.5 w-px bg-border sm:block" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {ctl.tags.map((tag) => {
            const active = current.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                disabled={!ctl.canEdit}
                onClick={() => {
                  toggleTag(tag.id);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] transition disabled:opacity-60",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-text-muted hover:bg-surface-3 hover:text-text",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            );
          })}
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
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => {
            setPreview((value) => !value);
          }}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            preview
              ? "border-accent/40 bg-accent-soft text-accent"
              : "border-border bg-surface-2 text-text-muted hover:text-text",
          )}
        >
          <Icon name={preview ? "pencil" : "eye"} size={14} />
          {preview ? "Write" : "Preview"}
        </button>
      </div>

      {!preview && (
        <div className="inline-flex items-center gap-0.5 self-start rounded-[11px] border border-border bg-surface-2 p-0.5">
          <ToolButton
            label="Bold"
            disabled={!ctl.canEdit}
            onClick={() => {
              wrap("**", "**", "bold");
            }}
          >
            <Icon name="bold" size={18} />
          </ToolButton>
          <ToolButton
            label="Italic"
            disabled={!ctl.canEdit}
            onClick={() => {
              wrap("*", "*", "italic");
            }}
          >
            <Icon name="italic" size={18} />
          </ToolButton>
          <ToolButton
            label="Heading"
            disabled={!ctl.canEdit}
            onClick={() => {
              prefixLines("# ", false);
            }}
          >
            <Icon name="heading" size={18} />
          </ToolButton>
          <ToolButton
            label="Bullet list"
            disabled={!ctl.canEdit}
            onClick={() => {
              prefixLines("- ", false);
            }}
          >
            <Icon name="list-bulleted" size={18} />
          </ToolButton>
          <ToolButton
            label="Ordered list"
            disabled={!ctl.canEdit}
            onClick={() => {
              prefixLines("1. ", true);
            }}
          >
            <Icon name="list-numbered" size={18} />
          </ToolButton>
          <ToolButton
            label="Code"
            disabled={!ctl.canEdit}
            onClick={() => {
              wrap("`", "`", "code");
            }}
          >
            <Icon name="code" size={18} />
          </ToolButton>
          <ToolButton label="Link" disabled={!ctl.canEdit} onClick={insertLink}>
            <Icon name="link" size={18} />
          </ToolButton>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {preview ? (
          <NotePreview title={current.title} body={current.body} />
        ) : (
          <textarea
            ref={bodyRef}
            aria-label="Note body"
            placeholder="Write in Markdown…"
            value={current.body}
            disabled={!ctl.canEdit}
            onChange={(event) => {
              ctl.setDraft({ ...current, body: event.target.value });
            }}
            className="h-full min-h-[280px] w-full resize-none rounded-input border border-border bg-surface-3 p-3 font-mono text-[13px] leading-relaxed text-text placeholder:text-text-muted transition focus-visible:border-accent focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
          />
        )}
      </div>

      {ctl.error !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {ctl.error}
        </p>
      )}
    </div>
  );
}
