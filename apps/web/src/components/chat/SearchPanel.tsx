import { Button, Text } from "@aulora/ui-web";
import { useEffect, useRef } from "react";
import type { ChatSearchHit } from "../../providers/ChatProvider";

export interface SearchPanelProps {
  readonly query: string;
  readonly results: readonly ChatSearchHit[];
  readonly searching: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (hit: ChatSearchHit) => void;
  readonly onClose: () => void;
}

/**
 * Cmd/Ctrl+K search over the device-local index. Results show the channel name
 * and a plaintext snippet; selecting one jumps to the message.
 */
export function SearchPanel({
  query,
  results,
  searching,
  onQueryChange,
  onSelect,
  onClose,
}: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div
      data-testid="search-panel"
      className="absolute inset-x-0 top-0 z-40 mx-auto mt-16 w-[min(36rem,calc(100%-2rem))] overflow-hidden rounded-card border border-border bg-surface-2 shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <input
          ref={inputRef}
          aria-label="Search messages"
          placeholder="Search messages"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }
          }}
          className="flex-1 bg-transparent px-2 py-1 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
        />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto p-1">
        {query.trim().length === 0 ? (
          <Text size="sm" tone="muted" className="block px-2 py-3">
            Search decrypted messages on this device. Nothing is sent to the server.
          </Text>
        ) : searching ? (
          <Text size="sm" tone="muted" className="block px-2 py-3">
            Searching…
          </Text>
        ) : results.length === 0 ? (
          <Text size="sm" tone="muted" data-testid="search-empty" className="block px-2 py-3">
            No matches for “{query.trim()}”.
          </Text>
        ) : (
          <ul>
            {results.map((hit) => (
              <li key={hit.messageId}>
                <button
                  type="button"
                  data-testid="search-result"
                  onClick={() => onSelect(hit)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-input px-2 py-2 text-left hover:bg-surface-3"
                >
                  <Text size="xs" tone="accent" mono>
                    #{hit.channelName}
                  </Text>
                  <Text size="sm" className="line-clamp-2">
                    {hit.snippet}
                  </Text>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
