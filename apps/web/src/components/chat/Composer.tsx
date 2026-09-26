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

/**
 * Multiline composer with code blocks, a typing heartbeat and mention
 * autocomplete. Mentions are resolved to plaintext user ids on send; the text
 * itself is encrypted by the session.
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
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Clear the draft when switching channels.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId is the reset trigger
  useEffect(() => {
    setValue("");
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

  function send(): void {
    const text = value.trim();
    if (text.length === 0) {
      return;
    }
    const resolution = resolveMentions(text, members, roles);
    const mentionUserIds = expandBroadcast(resolution, memberIds);
    void onSend({ text, mentionUserIds });
    setValue("");
    setSuggestions([]);
  }

  return (
    <div className="relative px-4 pb-3">
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
      <div className="flex items-end gap-2 rounded-input border border-border bg-surface-2 p-2">
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
        <Button size="sm" onClick={send} disabled={value.trim().length === 0}>
          Send
        </Button>
      </div>
    </div>
  );
}
