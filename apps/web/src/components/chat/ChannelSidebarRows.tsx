/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { ChannelView } from "@aulora/core";
import { activityLabel, badgeCount, dmPartnerId } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { ActiveBar } from "./ActiveBar";
import type { ChannelUnread } from "./channel-sidebar-model";
import { GroupAvatar, PresenceAvatar, type PresenceStatus, presenceLabel } from "./PresenceAvatar";

function UnreadBadge({ unread }: { readonly unread: ChannelUnread | undefined }) {
  const count = badgeCount(unread?.mentionCount ?? 0);
  if (count !== null) {
    return (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">
        {count}
      </span>
    );
  }
  if (unread?.unread === true) {
    return (
      <span className="h-2 w-2 rounded-full bg-accent">
        <span className="sr-only">Unread</span>
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
  const isPrivate = channel.isPrivate === true;
  return (
    <button
      type="button"
      data-testid={`channel-row-${channel.id}`}
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
        "relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition",
        active
          ? "bg-surface-3 font-semibold text-text"
          : isUnread
            ? "font-semibold text-text hover:bg-surface-3"
            : "text-text-muted hover:bg-surface-3 hover:text-text",
        channel.muted === true && !active && !isUnread && "opacity-60",
        drag?.dragging === true && "opacity-40",
      )}
    >
      <ActiveBar active={active} />
      <Icon
        name={channel.kind === "announcement" ? "announce" : isPrivate ? "lock" : "hash"}
        size={16}
        className={cn("shrink-0", active && "text-accent")}
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {channel.muted === true && (
        <Icon name="bell-off" size={13} className="shrink-0 text-text-muted" />
      )}
      {!active && <UnreadBadge unread={unread} />}
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
      onClick={() => {
        onSelect(channel.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event);
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-[8px] py-1.5 pl-3 pr-2 text-left transition",
        active ? "bg-surface-3" : "hover:bg-surface-3",
      )}
    >
      <ActiveBar active={active} />
      {channel.kind === "group_dm" ? (
        <GroupAvatar userIds={others} size={32} />
      ) : (
        <PresenceAvatar
          userId={partner ?? viewer.ownUserId}
          size={32}
          status={status}
          ringClassName={active ? "ring-surface-3" : "ring-surface-1"}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              active
                ? "font-semibold text-text"
                : isUnread
                  ? "font-semibold text-text"
                  : "font-medium text-text",
            )}
          >
            {title}
          </span>
          {unread?.lastActivityAt != null && (
            <span className="shrink-0 text-[11px] text-text-muted">
              {activityLabel(unread.lastActivityAt)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-muted">{subtitle}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {channel.pinned === true && (
              <Icon name="pin" size={12} className="shrink-0 text-text-muted" />
            )}
            {!active && <UnreadBadge unread={unread} />}
          </span>
        </span>
      </span>
    </button>
  );
}
