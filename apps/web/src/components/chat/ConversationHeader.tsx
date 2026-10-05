import type { ChannelView } from "@aulora/core";
import { dmPartnerId } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import type { ReactNode } from "react";
import { GroupAvatar, PresenceAvatar, type PresenceStatus, presenceLabel } from "./PresenceAvatar";

export interface ConversationHeaderProps {
  readonly channel: ChannelView;
  readonly title: string;
  readonly ownUserId: string;
  readonly memberCount: number;
  readonly presenceOf: (userId: string) => PresenceStatus;
  readonly membersOpen: boolean;
  readonly onToggleMembers: () => void;
  readonly onOpenSearch: () => void;
  readonly pinsOpen?: boolean;
  readonly onTogglePins?: () => void;
  /** Narrow layouts: returns to the conversation list. */
  readonly onBack?: () => void;
  /** Whether the viewer may start a call in this conversation. */
  readonly canStartCall?: boolean;
  /** Whether a video call is permitted (voice allowed implies audio). */
  readonly canStartVideoCall?: boolean;
  /** Starts a call in this conversation. */
  readonly onStartCall?: (kind: "voice" | "video") => void;
}

/**
 * The conversation title bar: who or what this is, and the search /
 * member-list controls.
 */
export function ConversationHeader({
  channel,
  title,
  ownUserId,
  memberCount,
  presenceOf,
  membersOpen,
  onToggleMembers,
  onOpenSearch,
  pinsOpen = false,
  onTogglePins,
  onBack,
  canStartCall = false,
  canStartVideoCall = false,
  onStartCall,
}: ConversationHeaderProps) {
  const isDm = channel.kind === "dm";
  const isConversation = channel.kind === "dm" || channel.kind === "group_dm";
  const partner = dmPartnerId(channel, ownUserId);
  const others = (channel.memberIds ?? []).filter((id) => id !== ownUserId);
  const status = partner !== undefined ? presenceOf(partner) : undefined;

  let subtitle: ReactNode;
  if (isDm && status !== undefined) {
    subtitle = presenceLabel(status);
  } else if (channel.kind === "group_dm") {
    subtitle = `${others.length + 1} members`;
  } else {
    subtitle = `${memberCount} ${memberCount === 1 ? "member" : "members"}${
      channel.kind === "announcement" ? " · Announcements" : ""
    }${channel.isPrivate === true ? " · Private" : ""}`;
  }

  return (
    <header className="desktop-drag material-chrome flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border px-3 sm:px-4">
      {onBack !== undefined && (
        <span className="md:hidden">
          <HeaderAction label="Back to conversations" onClick={onBack}>
            <Icon name="chevron-left" size={19} />
          </HeaderAction>
        </span>
      )}
      {isDm ? (
        <PresenceAvatar
          userId={partner ?? ownUserId}
          size={30}
          status={status}
          ringClassName="ring-surface-1"
        />
      ) : channel.kind === "group_dm" ? (
        <GroupAvatar userIds={others} size={30} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-accent-soft text-accent">
          <Icon
            name={
              channel.kind === "announcement" ? "announce" : channel.isPrivate ? "lock" : "hash"
            }
            size={16}
          />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
        <p className="truncate text-[11px] text-text-muted">{subtitle}</p>
      </div>
      <div className="flex items-center gap-0.5">
        {onTogglePins !== undefined && (
          <HeaderAction
            label={pinsOpen ? "Hide pinned messages" : "View pinned messages"}
            pressed={pinsOpen}
            onClick={onTogglePins}
          >
            <Icon name="pin" size={18} />
          </HeaderAction>
        )}
        {isConversation && canStartCall && onStartCall !== undefined && (
          <HeaderAction
            label="Start voice call"
            onClick={() => {
              onStartCall("voice");
            }}
          >
            <Icon name="phone" size={18} />
          </HeaderAction>
        )}
        {isConversation && canStartVideoCall && onStartCall !== undefined && (
          <HeaderAction
            label="Start video call"
            onClick={() => {
              onStartCall("video");
            }}
          >
            <Icon name="video" size={18} />
          </HeaderAction>
        )}
        <HeaderAction label="Search messages" onClick={onOpenSearch}>
          <Icon name="search" size={18} />
        </HeaderAction>
        <HeaderAction
          label={membersOpen ? "Hide members" : "Show members"}
          pressed={membersOpen}
          onClick={onToggleMembers}
        >
          <Icon name="users" size={18} />
        </HeaderAction>
      </div>
    </header>
  );
}

function HeaderAction({
  label,
  onClick,
  children,
  pressed,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-[7px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        pressed === true
          ? "bg-surface-3 text-accent"
          : "text-text-muted hover:bg-surface-3 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
