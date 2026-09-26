import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { ChannelView } from "@aulora/core";
import { Button, cn, Input, Text } from "@aulora/ui-web";
import { useState } from "react";

export interface ChannelSidebarProps {
  readonly workspaceName: string;
  readonly channels: readonly ChannelView[];
  readonly activeChannelId: string | undefined;
  readonly unreadByChannel: ReadonlyMap<string, { mentions: number; unread: boolean }>;
  readonly members: readonly { userId: string; displayName: string }[];
  readonly onSelect: (channelId: string) => void;
  readonly onCreateChannel: (input: { name: string; kind: "text" | "announcement" }) => void;
  readonly onCreateDm: (userId: string) => void;
}

const KIND_GLYPH: Record<ChannelView["kind"], string> = {
  text: "#",
  announcement: "!",
  dm: "@",
  group_dm: "◇",
};

/** Categorised channel + DM sidebar with unread and mention badges. */
export function ChannelSidebar({
  workspaceName,
  channels,
  activeChannelId,
  unreadByChannel,
  members,
  onSelect,
  onCreateChannel,
  onCreateDm,
}: ChannelSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dmOpen, setDmOpen] = useState(false);

  const chatChannels = channels.filter(
    (channel) => channel.kind === "text" || channel.kind === "announcement",
  );
  const dmChannels = channels.filter(
    (channel) => channel.kind === "dm" || channel.kind === "group_dm",
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-border bg-surface-1 p-3">
      <div className="flex items-center gap-2 px-1 py-1">
        <Avatar seed={`aulora:server:${workspaceName}`} size={28} />
        <Text size="sm" className="truncate font-medium">
          {workspaceName}
        </Text>
      </div>

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1">
          <Text size="xs" tone="muted" mono>
            CHANNELS
          </Text>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Create channel"
            onClick={() => setCreating((v) => !v)}
          >
            +
          </Button>
        </div>
        {creating && (
          <form
            className="flex flex-col gap-2 rounded-input border border-border bg-surface-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = newName.trim();
              if (value.length === 0) {
                return;
              }
              onCreateChannel({ name: value, kind: "text" });
              setNewName("");
              setCreating(false);
            }}
          >
            <Input
              label="Channel name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button size="sm" type="submit">
              Create
            </Button>
          </form>
        )}
        <ul className="flex flex-col gap-0.5">
          {chatChannels.map((channel) => (
            <li key={channel.id}>
              <ChannelRow
                channel={channel}
                active={channel.id === activeChannelId}
                unread={unreadByChannel.get(channel.id)}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between px-1">
          <Text size="xs" tone="muted" mono>
            DIRECT MESSAGES
          </Text>
          <Button
            size="sm"
            variant="ghost"
            aria-label="New direct message"
            onClick={() => setDmOpen((v) => !v)}
          >
            +
          </Button>
        </div>
        {dmOpen && (
          <ul className="flex flex-col gap-1 rounded-input border border-border bg-surface-2 p-2">
            {members.map((member) => (
              <li key={member.userId}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-pill px-2 py-1 text-left hover:bg-surface-3"
                  onClick={() => {
                    onCreateDm(member.userId);
                    setDmOpen(false);
                  }}
                >
                  <Avatar seed={userAvatarSeed(member.userId)} size={20} />
                  <Text size="sm">{member.displayName}</Text>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="flex flex-col gap-0.5">
          {dmChannels.map((channel) => (
            <li key={channel.id}>
              <ChannelRow
                channel={channel}
                active={channel.id === activeChannelId}
                unread={unreadByChannel.get(channel.id)}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function ChannelRow({
  channel,
  active,
  unread,
  onSelect,
}: {
  channel: ChannelView;
  active: boolean;
  unread: { mentions: number; unread: boolean } | undefined;
  onSelect(channelId: string): void;
}) {
  const mentions = unread?.mentions ?? 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(channel.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-pill px-2 py-1.5 text-left transition",
        active ? "bg-surface-3 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <span aria-hidden="true" className="w-4 text-center font-mono text-sm">
        {KIND_GLYPH[channel.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{channel.name}</span>
      {mentions > 0 ? (
        <span className="rounded-pill bg-accent px-1.5 text-xs font-semibold text-bg">
          {mentions}
        </span>
      ) : unread?.unread ? (
        <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-accent" />
      ) : null}
    </button>
  );
}
