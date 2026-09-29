import { Avatar, userAvatarSeed } from "@aulora/avatars";
import type { ChannelView } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";

/**
 * A voice channel in the sidebar: its name, how many people are connected, and
 * the live participant list rendered underneath, Discord-style.
 */
export function VoiceChannelRow({
  channel,
  title,
  active,
  onSelect,
  onContextMenu,
  nameOf,
}: {
  readonly channel: ChannelView;
  readonly title: string;
  readonly active: boolean;
  readonly onSelect: (channelId: string) => void;
  readonly onContextMenu: (event: React.MouseEvent) => void;
  readonly nameOf: (userId: string) => string;
}) {
  const voice = useVoice();
  const call = voice.activeCalls.find((entry) => entry.channelId === channel.id) ?? null;
  const participants = call?.participants ?? [];

  return (
    <div>
      <button
        type="button"
        data-testid={`voice-channel-row-${channel.id}`}
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(channel.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event);
        }}
        className={cn(
          "relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition",
          active
            ? "bg-surface-3 font-semibold text-text"
            : "text-text-muted hover:bg-surface-3 hover:text-text",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-text transition-opacity",
            active ? "opacity-100" : "opacity-0",
          )}
        />
        <Icon name="volume" size={16} className={cn(active && "text-accent")} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {participants.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-1 px-1 text-[10px] font-semibold text-text-muted">
            {participants.length}
          </span>
        )}
      </button>

      {participants.length > 0 && (
        <ul className="ml-7 mt-0.5 flex flex-col gap-0.5 pb-1">
          {participants.map((participant) => (
            <li key={participant.userId} className="flex items-center gap-2 px-2 py-0.5">
              <Avatar seed={userAvatarSeed(participant.userId)} size={18} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
                {nameOf(participant.userId)}
              </span>
              {participant.muted && (
                <Icon name="mic-off" size={12} className="shrink-0 text-danger" />
              )}
              {participant.sharingScreen && (
                <Icon name="monitor" size={12} className="shrink-0 text-accent" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
