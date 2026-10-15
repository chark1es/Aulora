import { hasPermission, Permission } from "@aulora/core";
import { Button, Icon } from "@aulora/ui-web";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../packages/convex/convex/_generated/api";

export function PinnedMessagesPanel({
  channelId,
  memberNames,
  permissions,
  onClose,
}: {
  readonly channelId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly permissions: bigint;
  readonly onClose: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listPins,
    { channelId: channelId as never },
    { initialNumItems: 30 },
  );
  const unpin = useMutation(api.messages.unpin);
  const canPin = hasPermission(permissions, Permission.PinMessages);

  return (
    <aside
      className="absolute right-3 top-[58px] z-30 flex max-h-[min(70vh,600px)] w-[min(360px,calc(100%-24px))] flex-col overflow-hidden rounded-[12px] border border-border bg-surface-2 shadow-xl shadow-black/20"
      aria-label="Pinned messages"
      data-testid="pinned-messages-panel"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <Icon name="pin" size={16} /> Pinned messages
        </h3>
        <button
          type="button"
          aria-label="Close pinned messages"
          title="Close pinned messages"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-2">
        {status === "LoadingFirstPage" && (
          <p className="px-2 py-3 text-xs text-text-muted">Loading pins…</p>
        )}
        {status !== "LoadingFirstPage" && results.length === 0 && (
          <p className="px-2 py-3 text-xs text-text-muted">No pinned messages in this channel.</p>
        )}
        {results.map((message) => (
          <div key={message.id} className="group rounded-[8px] px-2 py-2.5 hover:bg-surface-3">
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span className="font-semibold text-text">
                {memberNames.get(message.authorId) ?? "Member"}
              </span>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {new Date(message.createdAt).toLocaleDateString()}
              </time>
              {canPin && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => void unpin({ messageId: message.id })}
                >
                  Unpin
                </Button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
              {message.body}
            </p>
          </div>
        ))}
        {status === "CanLoadMore" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => {
              loadMore(30);
            }}
          >
            Load more pins
          </Button>
        )}
      </div>
    </aside>
  );
}
