import { type ChannelView, joinedElsewhere } from "@aulora/core";
import { cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";
import type { Callback } from "../admin/callbacks";
import { ActiveBar } from "../chat/ActiveBar";
import { PersonAvatar } from "../chat/member-avatars";

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
  readonly onSelect: Callback<[channelId: string]>;
  readonly onContextMenu: Callback<[event: React.MouseEvent]>;
  readonly nameOf: Callback<[userId: string], string>;
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
        onClick={() => {
          onSelect(channel.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event);
        }}
        className={cn(
          "relative flex h-8 w-full items-center gap-2.5 rounded-[8px] pl-3 pr-2 text-left text-[13px] transition",
          channel.muted === true && !active && "opacity-60",
          active
            ? "bg-surface-3 font-semibold text-text"
            : "text-text-muted hover:bg-surface-3 hover:text-text",
        )}
      >
        <ActiveBar active={active} />
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Icon name="volume" size={16} className={cn(active && "text-accent")} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {channel.muted === true && (
          <Icon name="bell-off" size={13} className="shrink-0 text-text-muted" />
        )}
        {participants.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-1 px-1 text-[10px] font-semibold text-text-muted">
            {participants.length}
          </span>
        )}
      </button>

      {participants.length > 0 && (
        <ul className="ml-7 mt-0.5 flex flex-col gap-0.5 pb-1">
          {participants.map((participant) => {
            const selfElsewhere =
              participant.userId === voice.selfUserId &&
              joinedElsewhere(call, voice.selfUserId, voice.clientId, voice.callId);
            const speaking = selfElsewhere
              ? false
              : participant.userId === voice.selfUserId
                ? voice.localSpeaking
                : voice.remoteSpeaking.has(participant.userId);
            return (
              <li key={participant.userId} className="flex items-center gap-2 px-2 py-0.5">
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
                    speaking && "ring-2 ring-secondary",
                  )}
                >
                  <PersonAvatar userId={participant.userId} size={18} />
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12px]",
                    speaking ? "font-medium text-text" : "text-text-muted",
                  )}
                >
                  {nameOf(participant.userId)}
                  {selfElsewhere ? " · other device" : ""}
                </span>
                {participant.muted && (
                  <Icon name="mic-off" size={12} className="shrink-0 text-danger" />
                )}
                {participant.sharingScreen && (
                  <Icon name="monitor" size={12} className="shrink-0 text-accent" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
