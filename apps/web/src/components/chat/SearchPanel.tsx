import type { ChannelView } from "@aulora/core";
import { activityLabel, dmPartnerId } from "@aulora/core";
import { cn, Icon, Spinner } from "@aulora/ui-web";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSearchHit } from "../../providers/ChatProvider";
import { GroupAvatar, PresenceAvatar } from "./PresenceAvatar";

/** Progress of reading older server history into the device-local index. */
export type SearchArchiveState = "loading" | "complete" | "failed";

export interface SearchPanelProps {
  readonly query: string;
  readonly results: readonly ChatSearchHit[];
  readonly searching: boolean;
  /** Defaults to `complete`, for hosts whose whole history is already local. */
  readonly archive?: SearchArchiveState;
  readonly conversations: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectConversation: (channelId: string) => void;
  readonly onSelect: (hit: ChatSearchHit) => void;
  readonly onClose: () => void;
}

type Entry =
  | { readonly kind: "conversation"; readonly channel: ChannelView }
  | { readonly kind: "message"; readonly hit: ChatSearchHit };

/**
 * Cmd/Ctrl+K palette: jump to a conversation by name, or search messages in the
 * device-local index. The index holds content the server decrypted for this
 * device, including older history paged in while a search runs; nothing typed
 * here leaves the device.
 */
export function SearchPanel({
  query,
  results,
  searching,
  archive = "complete",
  conversations,
  titles,
  ownUserId,
  memberNames,
  onQueryChange,
  onSelectConversation,
  onSelect,
  onClose,
}: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState(0);
  const trimmed = query.trim().toLowerCase();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const list = conversations.filter((channel) => !channel.archived);
    if (trimmed.length === 0) {
      return list.slice(0, 6);
    }
    return list
      .filter((channel) => (titles.get(channel.id) ?? channel.name).toLowerCase().includes(trimmed))
      .slice(0, 6);
  }, [conversations, titles, trimmed]);

  const entries = useMemo<Entry[]>(
    () => [
      ...matches.map((channel) => ({ kind: "conversation" as const, channel })),
      ...(trimmed.length > 0 ? results.map((hit) => ({ kind: "message" as const, hit })) : []),
    ],
    [matches, results, trimmed],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the cursor when the query changes
  useEffect(() => setActive(0), [query]);

  const choose = (entry: Entry | undefined) => {
    if (entry?.kind === "conversation") {
      onSelectConversation(entry.channel.id);
    } else if (entry?.kind === "message") {
      onSelect(entry.hit);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop dismisses the palette
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the input
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        data-testid="search-panel"
        role="dialog"
        aria-label="Search"
        className="w-full max-w-[600px] animate-pop-in overflow-hidden rounded-[12px] border border-border bg-surface-2 shadow-2xl shadow-black/25"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" size={20} className="text-text-muted" />
          <input
            ref={inputRef}
            aria-label="Search messages"
            placeholder="Jump to a conversation or search messages"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, Math.max(entries.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(entries[active]);
              }
            }}
            className="h-12 flex-1 bg-transparent text-[15px] text-text placeholder:text-text-muted focus-visible:outline-none"
          />
          {searching && <Spinner size={18} label="Searching" />}
          <kbd className="rounded-[6px] border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            esc
          </kbd>
        </div>

        <div className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
          {matches.length > 0 && (
            <SectionTitle>
              {trimmed.length === 0 ? "Recent conversations" : "Conversations"}
            </SectionTitle>
          )}
          <ul>
            {matches.map((channel, index) => {
              const partner = dmPartnerId(channel, ownUserId);
              const others = (channel.memberIds ?? []).filter((id) => id !== ownUserId);
              return (
                <li key={channel.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onSelectConversation(channel.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left",
                      active === index ? "bg-accent-soft" : "hover:bg-surface-3",
                    )}
                  >
                    {channel.kind === "dm" ? (
                      <PresenceAvatar userId={partner ?? ownUserId} size={28} />
                    ) : channel.kind === "group_dm" ? (
                      <GroupAvatar userIds={others} size={28} />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-surface-3 text-text-muted">
                        <Icon
                          name={channel.kind === "announcement" ? "announce" : "hash"}
                          size={15}
                        />
                      </span>
                    )}
                    <span className="flex-1 truncate text-sm font-medium text-text">
                      {titles.get(channel.id) ?? channel.name}
                    </span>
                    {active === index && (
                      <Icon name="chevron-right" size={16} className="text-accent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {trimmed.length === 0 ? (
            <p className="flex items-center gap-2 px-3 pb-2 pt-3 text-xs text-text-muted">
              <Icon name="lock" size={12} className="text-secondary" />
              Search runs on this device over content the server decrypted for it. Nothing is sent
              to the server.
            </p>
          ) : (
            <>
              <SectionTitle>Messages</SectionTitle>
              {results.length === 0 && !searching && archive !== "loading" ? (
                <p data-testid="search-empty" className="px-3 py-3 text-sm text-text-muted">
                  No messages match “{query.trim()}”.
                </p>
              ) : (
                <ul>
                  {results.map((hit, offset) => {
                    const index = matches.length + offset;
                    return (
                      <li key={hit.messageId}>
                        <button
                          type="button"
                          data-testid="search-result"
                          onMouseEnter={() => setActive(index)}
                          onClick={() => onSelect(hit)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-[8px] px-2.5 py-2 text-left",
                            active === index ? "bg-accent-soft" : "hover:bg-surface-3",
                          )}
                        >
                          <PresenceAvatar userId={hit.authorId} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2 text-xs">
                              <span className="font-semibold text-text">
                                {hit.authorId === ownUserId
                                  ? "You"
                                  : (memberNames.get(hit.authorId) ?? "Member")}
                              </span>
                              <span className="text-text-muted">in {hit.channelName}</span>
                              <span className="ml-auto text-text-muted">
                                {activityLabel(hit.createdAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-sm text-text">
                              {hit.snippet}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!searching && archive === "loading" && (
                <p
                  data-testid="search-archive-loading"
                  className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"
                >
                  <Spinner size={14} label="Searching earlier messages" />
                  Searching earlier messages…
                </p>
              )}
              {archive === "failed" && (
                <p role="alert" className="px-3 py-2 text-xs text-text-muted">
                  Couldn't reach earlier messages. These results cover history already on this
                  device.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { readonly children: string }) {
  return (
    <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
      {children}
    </h3>
  );
}
