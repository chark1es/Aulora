/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon, type SelectOption } from "@aulora/ui-web";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { actionLabel, detectMac, EDITOR_ACTIONS, type EditorActionId } from "./editor-actions";
import { NotePreview } from "./NotePreview";
import { useEditorCommands } from "./note-editor-commands";
import { EditorMeta } from "./note-editor-meta";
import { flattenFolders, folderPath } from "./types";
import type { NoteDraft, NotesController } from "./use-notes";
import { useUndoHistory } from "./use-undo-history";

/** One icon button in the formatting bar. */
function ToolButton({
  label,
  title,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The formatting bar: undo/redo, then one button per Markdown action. */
export function EditorToolbar({
  canEdit,
  canUndo,
  canRedo,
  mac,
  runAction,
  undo,
  redo,
}: {
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  mac: boolean;
  runAction: (id: EditorActionId) => void;
  undo: () => void;
  redo: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 self-start rounded-[11px] border border-border bg-surface-2 p-0.5">
      <ToolButton
        label="Undo"
        title={actionLabel(UNDO, mac)}
        disabled={!canEdit || !canUndo}
        onClick={undo}
      >
        <Icon name="undo" size={18} />
      </ToolButton>
      <ToolButton
        label="Redo"
        title={actionLabel(REDO, mac)}
        disabled={!canEdit || !canRedo}
        onClick={redo}
      >
        <Icon name="redo" size={18} />
      </ToolButton>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      {EDITOR_ACTIONS.map((spec) => (
        <ToolButton
          key={spec.id}
          label={spec.label}
          title={actionLabel(spec, mac)}
          disabled={!canEdit}
          onClick={() => {
            runAction(spec.id);
          }}
        >
          <Icon name={spec.icon} size={18} />
        </ToolButton>
      ))}
    </div>
  );
}

/** The Preview/Write switch. */
export function PreviewToggle({ preview, onToggle }: { preview: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={preview}
      onClick={onToggle}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        preview
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-border bg-surface-2 text-text-muted hover:text-text"
      }`}
    >
      <Icon name={preview ? "pencil" : "eye"} size={14} />
      {preview ? "Write" : "Preview"}
    </button>
  );
}

/** The title field, shared by the writer and the read-only view. */
function TitleField({ ctl, current }: { ctl: NotesController; current: NoteDraft }) {
  return (
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
  );
}

/** The read-only note: its metadata row and the rendered Markdown. */
function NoteReader({
  ctl,
  current,
  options,
}: {
  ctl: NotesController;
  current: NoteDraft;
  options: readonly SelectOption<string>[];
}) {
  const selectedFolder = options.find((option) => option.value === (current.folderId ?? ""));
  const folderLabel = selectedFolder?.title ?? selectedFolder?.label;
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

const UNDO = { label: "Undo", shortcut: ["Mod", "Z"] as const };
const REDO = { label: "Redo", shortcut: ["Mod", "Shift", "Z"] as const };

const EMPTY_DRAFT: NoteDraft = { title: "", body: "", folderId: null, tagIds: [] };

/** The Markdown editor: title, folder and tags, a formatting toolbar and the body. */
export function NoteEditor({ ctl }: { ctl: NotesController }) {
  const { draft, detail } = ctl;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);
  const mac = useMemo(detectMac, []);
  const history = useUndoHistory(`${detail?.id ?? "new"}:${detail?.revision ?? 0}`);
  const handlers = useRef<{ undo: () => void; redo: () => void }>({
    undo: () => undefined,
    redo: () => undefined,
  });

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const element = bodyRef.current;
    if (selection === null || element === null) return;
    element.focus();
    element.setSelectionRange(selection[0], selection[1]);
    pendingSelection.current = null;
  });

  // The native Edit menu (Electron) sends historyUndo/historyRedo, which React
  // does not surface, so the textarea is wired up directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the textarea mounts or unmounts
  useEffect(() => {
    const element = bodyRef.current;
    if (element === null) return;
    const onBeforeInput = (event: Event) => {
      const input = event as InputEvent;
      if (input.inputType === "historyUndo") {
        event.preventDefault();
        handlers.current.undo();
      } else if (input.inputType === "historyRedo") {
        event.preventDefault();
        handlers.current.redo();
      }
    };
    element.addEventListener("beforeinput", onBeforeInput);
    return () => {
      element.removeEventListener("beforeinput", onBeforeInput);
    };
  }, [ctl.editing]);

  const options: readonly SelectOption<string>[] = useMemo(
    () => [
      { value: "", label: "No folder", leading: <Icon name="folder" size={14} /> },
      ...flattenFolders(ctl.folders).map(({ folder, depth }) => ({
        value: folder.id,
        label: folder.name,
        indent: depth,
        title: folderPath(ctl.folders, folder.id)
          .map((node) => node.name)
          .join(" / "),
        leading: <Icon name="folder" size={14} />,
      })),
    ],
    [ctl.folders],
  );

  const current: NoteDraft = draft ?? EMPTY_DRAFT;
  const commands = useEditorCommands({ ctl, current, history, bodyRef, pendingSelection });
  handlers.current = { undo: commands.undo, redo: commands.redo };

  if (draft === undefined || detail === undefined) return null;
  if (!ctl.editing) return <NoteReader ctl={ctl} current={current} options={options} />;

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <TitleField ctl={ctl} current={current} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <EditorMeta ctl={ctl} current={current} options={options} />
        <PreviewToggle
          preview={preview}
          onToggle={() => {
            setPreview((value) => !value);
          }}
        />
      </div>

      {!preview && (
        <EditorToolbar
          canEdit={ctl.canEdit}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          mac={mac}
          runAction={commands.runAction}
          undo={commands.undo}
          redo={commands.redo}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {preview ? (
          <NotePreview body={current.body} />
        ) : (
          <textarea
            ref={bodyRef}
            aria-label="Note body"
            placeholder="Write in Markdown…"
            value={current.body}
            disabled={!ctl.canEdit}
            onChange={(event) => {
              commands.onBodyChange(event.target.value, event.target);
            }}
            onKeyDown={commands.onKeyDown}
            onSelect={(event) => {
              commands.trackSelection(event.currentTarget);
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
