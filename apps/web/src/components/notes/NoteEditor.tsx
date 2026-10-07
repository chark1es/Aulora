import { Button, cn, Icon, Select, type SelectOption } from "@aulora/ui-web";
import { useLayoutEffect, useRef, useState } from "react";
import { NotePreview } from "./NotePreview";
import { flattenFolders, type NoteFolder, relativeTime } from "./types";
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
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 min-w-7 items-center justify-center rounded-[7px] px-1.5 text-[13px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-1 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The Markdown editor: title, formatting toolbar, live preview, tags and folder. */
export function NoteEditor({ ctl }: { ctl: NotesController }) {
  const { draft, detail } = ctl;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);
  const now = Date.now();

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

  const dirty =
    current.title !== detail.title ||
    current.body !== detail.body ||
    current.folderId !== detail.folderId ||
    current.tagIds.join("\u0000") !== detail.tagIds.join("\u0000");

  const options: readonly SelectOption<string>[] = [
    { value: "", label: "No folder" },
    ...flattenFolders(ctl.folders).map(({ folder, depth }) => ({
      value: folder.id,
      label: `${"— ".repeat(depth)}${folder.name}`,
    })),
  ];

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

      <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
        {!preview && (
          <>
            <ToolButton
              label="Bold"
              disabled={!ctl.canEdit}
              onClick={() => wrap("**", "**", "bold")}
            >
              <span className="font-bold">B</span>
            </ToolButton>
            <ToolButton
              label="Italic"
              disabled={!ctl.canEdit}
              onClick={() => wrap("*", "*", "italic")}
            >
              <span className="italic">I</span>
            </ToolButton>
            <ToolButton
              label="Heading"
              disabled={!ctl.canEdit}
              onClick={() => prefixLines("# ", false)}
            >
              <span className="font-semibold">H</span>
            </ToolButton>
            <ToolButton
              label="Bullet list"
              disabled={!ctl.canEdit}
              onClick={() => prefixLines("- ", false)}
            >
              <span className="font-semibold">•</span>
            </ToolButton>
            <ToolButton
              label="Ordered list"
              disabled={!ctl.canEdit}
              onClick={() => prefixLines("1. ", true)}
            >
              <span className="font-semibold">1.</span>
            </ToolButton>
            <ToolButton label="Code" disabled={!ctl.canEdit} onClick={() => wrap("`", "`", "code")}>
              <Icon name="code" size={15} />
            </ToolButton>
            <ToolButton label="Link" disabled={!ctl.canEdit} onClick={insertLink}>
              <Icon name="link" size={15} />
            </ToolButton>
          </>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={preview}
          leading={<Icon name={preview ? "pencil" : "eye"} size={14} />}
          onClick={() => {
            setPreview((value) => !value);
          }}
        >
          {preview ? "Write" : "Preview"}
        </Button>
      </div>

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

      <div className="flex flex-col gap-2">
        <Select
          label="Folder"
          value={current.folderId ?? ""}
          options={options}
          onChange={(value) => {
            ctl.setDraft({
              ...current,
              folderId: value === "" ? null : (value as NoteFolder["id"]),
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-text-muted">Tags</span>
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
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition disabled:opacity-60",
                  active
                    ? "border-accent/50 bg-accent-soft text-text"
                    : "border-border bg-surface-2 text-text-muted hover:text-text",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            );
          })}
          {ctl.tags.length === 0 && (
            <span className="text-[12px] text-text-muted">No tags yet.</span>
          )}
          {ctl.canEdit && (
            <button
              type="button"
              onClick={() => {
                ctl.setTagDialog({ mode: "new" });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] text-text-muted transition hover:border-accent hover:text-text"
            >
              <Icon name="plus" size={12} />
              New tag
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-text-muted">
        Updated {relativeTime(detail.updatedAt, now)} · revision {detail.revision}
      </p>

      {ctl.error !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {ctl.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          onClick={() => void ctl.saveNote()}
          disabled={!ctl.canEdit || !dirty || ctl.busy}
          loading={ctl.busy}
          leading={<Icon name="check" size={14} />}
        >
          Save
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || ctl.busy}
          leading={<Icon name="history" size={14} />}
          onClick={() => {
            ctl.reloadDraft();
          }}
        >
          Reload
        </Button>
        <span className="flex-1" />
        <Button
          variant="secondary"
          disabled={!ctl.canEdit || ctl.busy}
          leading={<Icon name={detail.archived ? "unarchive" : "archive"} size={14} />}
          onClick={() => void ctl.archiveNote(detail, !detail.archived)}
        >
          {detail.archived ? "Restore" : "Archive"}
        </Button>
        <Button
          variant="danger"
          disabled={!ctl.canDelete || ctl.busy}
          leading={<Icon name="trash" size={14} />}
          onClick={() => {
            ctl.requestDeleteNote(detail);
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
