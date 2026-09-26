import type { MentionTarget, RoleMentionTarget } from "@aulora/core";
import { expandBroadcast, resolveMentions } from "@aulora/core";
import { Button, cn, Text } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";

export interface ComposerProps {
  readonly channelId: string;
  readonly members: readonly MentionTarget[];
  readonly roles: readonly RoleMentionTarget[];
  readonly memberIds: readonly string[];
  readonly placeholder?: string;
  readonly onTyping: (channelId: string) => void;
  readonly onSend: (input: {
    text: string;
    mentionUserIds: readonly string[];
    files: readonly File[];
  }) => void | Promise<void>;
  /** Optional thread mode label, e.g. "Replying in thread". */
  readonly threadHint?: string;
}

interface Suggestion {
  readonly label: string;
  readonly insert: string;
}

const BROADCAST_SUGGESTIONS: Suggestion[] = [
  { label: "@here", insert: "@here" },
  { label: "@everyone", insert: "@everyone" },
];

function collectFiles(list: FileList | null): File[] {
  if (list === null) {
    return [];
  }
  return Array.from(list);
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
 * Multiline composer with code blocks, a typing heartbeat, mention
 * autocomplete and attachments (file picker, drag-and-drop and paste). Files
 * are handed to the caller, which encrypts them before upload; the composer
 * never sees ciphertext.
 */
export function Composer({
  channelId,
  members,
  roles,
  memberIds,
  placeholder = "Message",
  onTyping,
  onSend,
  threadHint,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clear the draft when switching channels.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is the reset trigger
  useEffect(() => {
    setValue("");
    setFiles([]);
    setSuggestions([]);
  }, [channelId]);

  const allSuggestions: Suggestion[] = [
    ...BROADCAST_SUGGESTIONS,
    ...members.map((member) => ({
      label: `@${member.displayName}`,
      insert: `@${member.displayName}`,
    })),
    ...roles
      .filter((role) => role.mentionable)
      .map((role) => ({ label: `@${role.name}`, insert: `@${role.name}` })),
  ];

  function updateSuggestions(next: string): void {
    const match = /@([A-Za-z0-9_.-]*)$/.exec(next);
    if (match === null) {
      setSuggestions([]);
      return;
    }
    const query = (match[1] ?? "").toLowerCase();
    const filtered = allSuggestions
      .filter((suggestion) => suggestion.label.slice(1).toLowerCase().includes(query))
      .slice(0, 6);
    setSuggestions(filtered);
    setActiveSuggestion(0);
  }

  function applySuggestion(suggestion: Suggestion): void {
    setValue((current) => current.replace(/@([A-Za-z0-9_.-]*)$/, `${suggestion.insert} `));
    setSuggestions([]);
    textareaRef.current?.focus();
  }

  function addFiles(incoming: readonly File[]): void {
    if (incoming.length === 0) {
      return;
    }
    setFiles((current) => [...current, ...incoming]);
  }

  function send(): void {
    const text = value.trim();
    if (text.length === 0 && files.length === 0) {
      return;
    }
    const resolution = resolveMentions(text, members, roles);
    const mentionUserIds = expandBroadcast(resolution, memberIds);
    void onSend({ text, mentionUserIds, files });
    setValue("");
    setFiles([]);
    setSuggestions([]);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone wrapping the composer
    <div
      className={cn("relative px-4 pb-3", dragging && "rounded-input ring-2 ring-accent")}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(collectFiles(event.dataTransfer?.files ?? null));
      }}
    >
      {threadHint !== undefined && (
        <Text size="xs" tone="muted" className="px-1 pb-1">
          {threadHint}
        </Text>
      )}
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-4 mb-1 w-64 overflow-hidden rounded-input border border-border bg-surface-2 shadow-sm">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.label}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-left text-sm",
                  index === activeSuggestion ? "bg-surface-3 text-text" : "text-text-muted",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(suggestion);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-1" data-testid="composer-attachments">
          {files.map((file) => (
            <li
              key={fileReferenceKey(file)}
              className="flex items-center gap-2 rounded-pill border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
            >
              <span className="max-w-[12rem] truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="text-text-muted hover:text-text"
                onClick={() => setFiles((current) => current.filter((value) => value !== file))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 rounded-input border border-border bg-surface-2 p-2">
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
        <button
          type="button"
          aria-label="Attach files"
          className="rounded-pill px-2 py-1 text-text-muted hover:text-text"
          onClick={() => fileInputRef.current?.click()}
        >
          <span aria-hidden="true">📎</span>
        </button>
        <textarea
          ref={textareaRef}
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          rows={1}
          className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            if (next.length > 0) {
              onTyping(channelId);
            }
            updateSuggestions(next);
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
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <Button size="sm" onClick={send} disabled={value.trim().length === 0 && files.length === 0}>
          Send
        </Button>
      </div>
    </div>
  );
}
