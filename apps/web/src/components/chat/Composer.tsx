import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { MentionTarget, RoleMentionTarget } from "@aulora/core";
import { expandBroadcast, resolveMentions } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readDraft, writeDraft } from "../../lib/drafts";
import { EmojiPicker } from "./EmojiPicker";

export interface ComposerProps {
  readonly channelId: string;
  readonly members: readonly MentionTarget[];
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  /** Visible placeholder, e.g. "Message #general". */
  readonly placeholder?: string;
  /** Storage key for this composer's draft; omit to keep no draft. */
  readonly draftKey?: string;
  readonly onTyping: (channelId: string) => void;
  readonly onSend: (input: {
    text: string;
    mentionUserIds: readonly string[];
    files: readonly File[];
  }) => void | Promise<void>;
  /** Optional thread mode label, e.g. "Replying in thread". */
  readonly threadHint?: string;
  /** Extra controls rendered in the toolbar (e.g. "Also send to channel"). */
  readonly toolbarExtra?: ReactNode;
  readonly disabled?: boolean;
  /**
   * When true (default) this composer accepts a file dropped anywhere in the
   * window; when false it only accepts drops within its own bounds. Only the
   * primary (main chat) composer should own the app-wide drop target, so a
   * secondary composer (e.g. the thread reply box) passes `false`.
   */
  readonly windowDropEnabled?: boolean;
  /** The message being replied to inline; shows a dismissible quote banner. */
  readonly replyTo?: { readonly authorName: string; readonly preview: string } | null;
  /** Clears the inline reply (banner X or Escape). */
  readonly onCancelReply?: () => void;
}

interface Suggestion {
  readonly key: string;
  readonly label: string;
  readonly insert: string;
  readonly detail: string;
  readonly userId?: string;
}

const BROADCAST_SUGGESTIONS: Suggestion[] = [
  { key: "here", label: "here", insert: "@here", detail: "Notify everyone online" },
  { key: "everyone", label: "everyone", insert: "@everyone", detail: "Notify everyone" },
];

const MAX_TEXTAREA_PX = 220;
const MENTION_QUERY = /(^|\s)@([^\s@]*)$/;

function collectFiles(list: FileList | ArrayLike<File> | null): File[] {
  if (list === null) {
    return [];
  }
  return Array.from(list);
}

/**
 * True only when a drag carries files, so channel/sidebar reordering (which
 * uses `text/plain`) is left alone. Firefox advertises `application/x-moz-file`.
 */
function isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).some((type) => type === "Files" || type === "application/x-moz-file");
}

let fileRefSeq = 0;
const fileRefs = new WeakMap<File, string>();

/** Stable React key per picked file, since `File` has no reliable id. */
function fileReferenceKey(file: File): string {
  const existing = fileRefs.get(file);
  if (existing !== undefined) {
    return existing;
  }
  fileRefSeq += 1;
  const key = `file-${fileRefSeq}`;
  fileRefs.set(file, key);
  return key;
}

/**
 * The message composer: an auto-growing input with mention autocomplete, an
 * emoji picker, attachments (picker, drag-and-drop and paste) and per-device
 * drafts. Files are handed to the caller, which uploads them; the server seals
 * them at rest. Enter sends, Shift+Enter adds a line.
 */
export function Composer({
  channelId,
  members,
  roles,
  memberIds,
  placeholder = "Message",
  draftKey,
  onTyping,
  onSend,
  threadHint,
  toolbarExtra,
  disabled = false,
  windowDropEnabled = true,
  replyTo = null,
  onCancelReply,
}: ComposerProps) {
  const [value, setValue] = useState(() => (draftKey !== undefined ? readDraft(draftKey) : ""));
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [windowDragging, setWindowDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  /** Selection to restore right after the next value commit (mention/emoji inserts). */
  const pendingSelection = useRef<[number, number] | null>(null);
  /** Depth of nested dragenter/dragleave pairs, so child elements don't flicker. */
  const dragDepth = useRef(0);
  /** Safety timer that clears the overlay if no further drag event arrives. */
  const dragSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching conversations swaps in that conversation's draft.
  useEffect(() => {
    setValue(draftKey !== undefined ? readDraft(draftKey) : "");
    setFiles([]);
    setSuggestions([]);
    textareaRef.current?.focus();
  }, [draftKey]);

  useEffect(() => {
    if (draftKey === undefined) {
      return;
    }
    const timer = setTimeout(() => writeDraft(draftKey, value), 250);
    return () => clearTimeout(timer);
  }, [draftKey, value]);

  // Grow with the content up to a cap, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the value changes
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (node === null) {
      return;
    }
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_PX)}px`;
    const selection = pendingSelection.current;
    if (selection !== null) {
      pendingSelection.current = null;
      node.focus();
      node.setSelectionRange(selection[0], selection[1]);
    }
  }, [value]);

  const allSuggestions: Suggestion[] = [
    ...BROADCAST_SUGGESTIONS,
    ...members.map((member) => ({
      key: `user:${member.userId}`,
      label: member.displayName,
      insert: `@${member.displayName}`,
      detail: "Member",
      userId: member.userId,
    })),
    ...roles
      .filter((role) => role.mentionable)
      .map((role) => ({
        key: `role:${role.roleId}`,
        label: role.name,
        insert: `@${role.name}`,
        detail: "Role",
      })),
  ];

  function updateSuggestions(next: string, caret: number): void {
    const match = MENTION_QUERY.exec(next.slice(0, caret));
    if (match === null) {
      setSuggestions([]);
      return;
    }
    const query = (match[2] ?? "").toLowerCase();
    setSuggestions(
      allSuggestions
        .filter((suggestion) => suggestion.label.toLowerCase().includes(query))
        .slice(0, 6),
    );
    setActiveSuggestion(0);
  }

  function applySuggestion(suggestion: Suggestion): void {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? value.length;
    const before = value
      .slice(0, caret)
      .replace(MENTION_QUERY, (_all, lead: string) => `${lead}${suggestion.insert} `);
    const next = before + value.slice(caret);
    pendingSelection.current = [before.length, before.length];
    setValue(next);
    setSuggestions([]);
  }

  function insertAtCaret(snippet: string, selectOffset?: [number, number]): void {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    const [from, to] = selectOffset ?? [snippet.length, snippet.length];
    pendingSelection.current = [start + from, start + to];
    setValue(next);
  }

  const addFiles = useCallback((incoming: readonly File[]): void => {
    if (incoming.length > 0) {
      setFiles((current) => [...current, ...incoming]);
    }
  }, []);

  // A file drag can be dropped anywhere in the app, so watch the window rather
  // than the composer's own box. Non-file drags (e.g. channel reordering) fall
  // straight through: no preventDefault, no overlay.
  useEffect(() => {
    if (typeof window === "undefined" || !windowDropEnabled) {
      return;
    }

    const resetWindowDrag = (): void => {
      if (dragSafetyTimer.current !== null) {
        clearTimeout(dragSafetyTimer.current);
        dragSafetyTimer.current = null;
      }
      dragDepth.current = 0;
      setWindowDragging(false);
      setDragging(false);
    };

    // A file drag can stop emitting events (e.g. the pointer sits still) or
    // lose its `dragend`; clear the overlay if nothing arrives for a while.
    const armSafetyTimer = (): void => {
      if (dragSafetyTimer.current !== null) {
        clearTimeout(dragSafetyTimer.current);
      }
      dragSafetyTimer.current = setTimeout(resetWindowDrag, 2000);
    };

    const onDragEnter = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepth.current += 1;
      if (!disabled) {
        setWindowDragging(true);
        armSafetyTimer();
      }
    };

    const onDragOver = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      if (!disabled) {
        armSafetyTimer();
      }
    };

    const onDragLeave = (event: DragEvent): void => {
      // Some browsers report empty `types` on the dragleave that fires as the
      // pointer leaves the window, and never fire `dragend`, so a leave with no
      // related target always ends the drag whatever the event advertises.
      // (`== null` also covers environments that leave `relatedTarget` undefined.)
      if (event.relatedTarget == null) {
        resetWindowDrag();
        return;
      }
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        if (dragSafetyTimer.current !== null) {
          clearTimeout(dragSafetyTimer.current);
          dragSafetyTimer.current = null;
        }
        setWindowDragging(false);
      }
    };

    const onDrop = (event: DragEvent): void => {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      resetWindowDrag();
      if (!disabled) {
        addFiles(collectFiles(event.dataTransfer?.files ?? null));
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", resetWindowDrag);
    window.addEventListener("blur", resetWindowDrag);
    return () => {
      resetWindowDrag();
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", resetWindowDrag);
      window.removeEventListener("blur", resetWindowDrag);
    };
  }, [addFiles, disabled, windowDropEnabled]);

  function send(): void {
    const text = value.trim();
    if (disabled || (text.length === 0 && files.length === 0)) {
      return;
    }
    const resolution = resolveMentions(text, members, roles);
    const mentionUserIds = expandBroadcast(resolution, memberIds);
    void onSend({ text, mentionUserIds, files });
    setValue("");
    setFiles([]);
    setSuggestions([]);
    if (draftKey !== undefined) {
      writeDraft(draftKey, "");
    }
  }

  const canSend = !disabled && (value.trim().length > 0 || files.length > 0);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone wrapping the composer
    <div
      className="relative px-4 pb-3 pt-1 sm:px-6 sm:pb-4"
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        if (!windowDropEnabled) {
          addFiles(collectFiles(event.dataTransfer?.files ?? null));
          event.stopPropagation();
        }
      }}
    >
      {suggestions.length > 0 && (
        <ul
          aria-label="Mention suggestions"
          className="absolute bottom-full left-4 z-30 mb-1 w-72 animate-pop-in overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1 shadow-xl shadow-black/20"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.key}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px]",
                  index === activeSuggestion ? "bg-accent-soft text-text" : "text-text-muted",
                )}
                onMouseEnter={() => setActiveSuggestion(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(suggestion);
                }}
              >
                {suggestion.userId !== undefined ? (
                  <Avatar seed={userAvatarSeed(suggestion.userId)} size={24} />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-accent">
                    <Icon name="at" size={14} />
                  </span>
                )}
                <span className="flex-1 truncate font-medium text-text">{suggestion.label}</span>
                <span className="text-xs text-text-muted">{suggestion.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={cn(
          // A flat composer: a hairline top rule and a quiet rounded focus
          // surface behind the text, not a boxed card around every message.
          "rounded-[10px] border bg-surface-2/60 transition-colors",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border focus-within:border-accent/50 focus-within:bg-surface-2",
        )}
      >
        {replyTo !== null && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Icon name="reply" size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className="font-semibold text-text">{replyTo.authorName}</span>{" "}
              <span className="text-text-muted">{replyTo.preview}</span>
            </span>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => onCancelReply?.()}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted hover:bg-surface-3 hover:text-text"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
        {threadHint !== undefined && (
          <p className="px-4 pt-2.5 text-xs font-medium text-text-muted">{threadHint}</p>
        )}
        {files.length > 0 && (
          <ul
            className="flex max-h-[88px] flex-wrap gap-1.5 overflow-y-auto px-3 pt-3"
            data-testid="composer-attachments"
          >
            {files.map((file) => (
              <li
                key={fileReferenceKey(file)}
                className="flex items-center gap-2 rounded-[7px] border border-border bg-surface-3 py-1 pl-2 pr-1 text-xs text-text"
              >
                <Icon
                  name={file.type.startsWith("image/") ? "image" : "file"}
                  size={14}
                  className="text-accent"
                />
                <span className="max-w-[12rem] truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text"
                  onClick={() => setFiles((current) => current.filter((value) => value !== file))}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-1.5 px-2 pt-2">
          <span className="relative">
            <button
              type="button"
              aria-label="Insert emoji"
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text"
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <Icon name="smile" size={19} />
            </button>
            {emojiOpen && (
              <EmojiPicker
                className="absolute bottom-full left-0 mb-2"
                onPick={(emoji) => insertAtCaret(emoji)}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </span>
          <textarea
            ref={textareaRef}
            aria-label="Message"
            placeholder={placeholder}
            value={value}
            rows={1}
            disabled={disabled}
            className="max-h-[220px] min-h-[32px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-text placeholder:text-text-muted focus-visible:outline-none disabled:opacity-60"
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              if (next.length > 0) {
                onTyping(channelId);
              }
              updateSuggestions(next, event.target.selectionStart ?? next.length);
            }}
            onPaste={(event) => {
              const pasted = collectFiles(event.clipboardData?.files ?? null);
              if (pasted.length > 0) {
                event.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSuggestion((index) => (index + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSuggestion(
                    (index) => (index - 1 + suggestions.length) % suggestions.length,
                  );
                  return;
                }
                if (event.key === "Tab" || event.key === "Enter") {
                  event.preventDefault();
                  const suggestion = suggestions[activeSuggestion];
                  if (suggestion !== undefined) {
                    applySuggestion(suggestion);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSuggestions([]);
                  return;
                }
              }
              if (event.key === "Escape" && replyTo !== null) {
                event.preventDefault();
                onCancelReply?.();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={!canSend}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition",
              canSend
                ? "bg-accent text-on-accent hover:brightness-110 active:brightness-95"
                : "bg-surface-3 text-text-muted",
            )}
          >
            <Icon name="send" size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="flex items-center gap-0.5 px-2 pb-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Attach files"
            data-testid="file-input"
            onChange={(event) => {
              addFiles(collectFiles(event.target.files));
              event.target.value = "";
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            aria-label="Attach images"
            onChange={(event) => {
              addFiles(collectFiles(event.target.files));
              event.target.value = "";
            }}
          />
          <ToolButton
            label="Attach files"
            icon="paperclip"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolButton
            label="Attach images"
            icon="image"
            onClick={() => imageInputRef.current?.click()}
          />
          <ToolButton
            label="Code block"
            icon="code"
            onClick={() => insertAtCaret("```\n\n```", [4, 4])}
          />
          <ToolButton
            label="Mention someone"
            icon="at"
            onClick={() => {
              const lead = value.length > 0 && !/\s$/.test(value) ? " @" : "@";
              insertAtCaret(lead);
              const node = textareaRef.current;
              const next = value + lead;
              updateSuggestions(next, next.length);
              node?.focus();
            }}
          />
          {toolbarExtra}
        </div>
      </div>

      {windowDragging && !disabled && (
        <div
          data-testid="composer-drop-overlay"
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center border-2 border-dashed border-accent bg-accent-soft/80"
        >
          <span className="rounded-[10px] bg-surface-2 px-4 py-2 text-sm font-medium text-accent shadow-lg shadow-black/20">
            Drop files to attach
          </span>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
}: {
  readonly label: string;
  readonly icon: "paperclip" | "image" | "code" | "at";
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[7px] text-text-muted transition hover:bg-surface-3 hover:text-text"
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
