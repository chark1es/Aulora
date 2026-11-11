/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ChannelView } from "@aulora/core";
import { badgeCount, dmPartnerId } from "@aulora/core";
import { CapText, cn, Icon } from "@aulora/ui-web";
import { ActiveBar } from "./ActiveBar";
import type { ChannelUnread } from "./channel-sidebar-model";
import { GroupAvatar, PresenceAvatar, type PresenceStatus, presenceLabel } from "./PresenceAvatar";

/**
 * The trailing unread marker. Mentions get a compact count pill; plain unread
 * gets a dot centred in the same 16px slot so both sit on one vertical line.
 */
function UnreadBadge({
  unread,
  muted,
}: {
  readonly unread: ChannelUnread | undefined;
  readonly muted: boolean;
}) {
  const count = badgeCount(unread?.mentionCount ?? 0);
  if (count !== null) {
    return (
      <span
        role="img"
        aria-label={`${count} ${count === "1" ? "mention" : "mentions"}`}
        className={cn(
          "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums",
          // White on dark Ember is 3.7:1; the near-black background token
          // clears 4.5:1 for the 11px count. Light theme keeps white.
          muted ? "bg-surface-3 text-text-muted" : "bg-accent text-on-accent dark:text-bg",
        )}
      >
        <CapText>{count}</CapText>
      </span>
    );
  }
  if (unread?.unread === true) {
    return (
      <span className="flex h-4 w-4 items-center justify-center">
        <span className={cn("h-2 w-2 rounded-full", muted ? "bg-text-muted" : "bg-accent")}>
          <span className="sr-only">Unread</span>
        </span>
      </span>
    );
  }
  return null;
}

export function DropLine() {
  return (
    <li aria-hidden="true" className="h-0.5 px-1">
      <span className="block h-0.5 rounded-full bg-accent" />
    </li>
  );
}

/** The insertion indicator shown above or below a category header. */
export function CategoryDropLine() {
  return (
    <div aria-hidden="true" className="h-0.5 px-1.5">
      <span className="block h-0.5 rounded-full bg-accent" />
    </div>
  );
}

export function ChannelRow({
  channel,
  title,
  active,
  unread,
  onSelect,
  onContextMenu,
  drag,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly active: boolean;
  readonly unread: ChannelUnread | undefined;
  readonly onSelect: (_channelId: string) => void;
  readonly onContextMenu: (_event: React.MouseEvent) => void;
  readonly drag?: {
    readonly dragIndex: number;
    readonly dragging: boolean;
    readonly onDragStart: () => void;
    readonly onDragEnd: () => void;
  };
}) {
  const isUnread = unread?.unread === true && !active;
  const isMuted = channel.muted === true;
  const isPrivate = channel.isPrivate === true;
  return (
    <button
      type="button"
      data-testid={`channel-row-${channel.id}`}
      title={title}
      onClick={() => {
        onSelect(channel.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event);
      }}
      aria-current={active ? "page" : undefined}
      {...(drag !== undefined ? { "data-drag-index": drag.dragIndex, draggable: true } : {})}
      {...(drag !== undefined
        ? {
            onDragStart: (event: React.DragEvent) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", channel.id);
              drag.onDragStart();
            },
          }
        : {})}
      {...(drag !== undefined ? { onDragEnd: drag.onDragEnd } : {})}
      className={cn(
        "relative flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        active
          ? "bg-accent-soft font-medium text-text"
          : isMuted
            ? "text-text-muted hover:bg-surface-2"
            : isUnread
              ? "font-medium text-text hover:bg-surface-2"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
        drag?.dragging === true && "opacity-40",
      )}
    >
      <ActiveBar active={active} />
      <Icon
        name={channel.kind === "announcement" ? "announce" : isPrivate ? "lock" : "hash"}
        size={16}
        className={cn(
          "shrink-0 transition-colors",
          active ? "text-accent-text" : "text-text-muted",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {isMuted && (
        <span className="flex shrink-0 items-center">
          <Icon name="bell-off" size={14} className="text-text-muted" />
          <span className="sr-only">Muted</span>
        </span>
      )}
      {!active && <UnreadBadge unread={unread} muted={isMuted} />}
    </button>
  );
}

export function DmRow({
  channel,
  title,
  viewer,
  active,
  unread,
  onSelect,
  onContextMenu,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  /** The signed-in viewer, needed to resolve the DM partner and its presence. */
  readonly viewer: {
    readonly ownUserId: string;
    readonly presenceOf: (userId: string) => PresenceStatus;
  };
  readonly active: boolean;
  readonly unread: ChannelUnread | undefined;
  readonly onSelect: (channelId: string) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
}) {
  const partner = dmPartnerId(channel, viewer.ownUserId);
  const others = (channel.memberIds ?? []).filter((id) => id !== viewer.ownUserId);
  const status = partner !== undefined ? viewer.presenceOf(partner) : undefined;
  const isUnread = unread?.unread === true && !active;
  const isMuted = channel.muted === true;
  const subtitle =
    channel.kind === "group_dm"
      ? `${others.length + 1} members`
      : status !== undefined
        ? presenceLabel(status)
        : "Direct message";
  return (
    <button
      type="button"
      data-testid={`channel-row-${channel.id}`}
      title={title}
      onClick={() => {
        onSelect(channel.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event);
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-12 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        active ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <ActiveBar active={active} />
      {channel.kind === "group_dm" ? (
        <GroupAvatar
          userIds={others}
          size={32}
          padClassName={active ? "bg-surface-2" : "bg-surface-1 group-hover:bg-surface-2"}
        />
      ) : (
        <PresenceAvatar
          userId={partner ?? viewer.ownUserId}
          size={32}
          status={status}
          ringClassName={active ? "ring-surface-2" : "ring-surface-1 group-hover:ring-surface-2"}
        />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] leading-4",
            active
              ? "font-medium text-text"
              : isMuted
                ? "font-normal text-text-muted"
                : isUnread
                  ? "font-medium text-text"
                  : "font-normal text-text-muted group-hover:text-text",
          )}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs leading-4 text-text-muted">{subtitle}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {isMuted && (
          <span className="flex items-center">
            <Icon name="bell-off" size={14} className="text-text-muted" />
            <span className="sr-only">Muted</span>
          </span>
        )}
        {channel.pinned === true && (
          <Icon name="pin" size={12} className="shrink-0 text-text-muted" />
        )}
        {!active && <UnreadBadge unread={unread} muted={isMuted} />}
      </span>
    </button>
  );
}
