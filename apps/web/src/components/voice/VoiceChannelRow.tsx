import { type ChannelView, joinedElsewhere } from "@aulora/core";
import { Badge, cn, Icon } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";
import type { Callback } from "../admin/callbacks";
import { ActiveBar } from "../chat/ActiveBar";
import { PersonAvatar } from "../chat/member-avatars";
import { participantName } from "./identity";

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
        title={title}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          onSelect(channel.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(event);
        }}
        className={cn(
          "relative flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          active
            ? "bg-accent-soft font-medium text-text"
            : channel.muted === true
              ? "text-text-muted hover:bg-surface-2"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
        )}
      >
        <ActiveBar active={active} />
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Icon
            name="volume"
            size={16}
            className={cn("transition-colors", active ? "text-accent-text" : "text-text-muted")}
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {channel.muted === true && (
          <span className="flex shrink-0 items-center">
            <Icon name="bell-off" size={14} className="text-text-muted" />
            <span className="sr-only">Muted</span>
          </span>
        )}
        {participants.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-3 px-1 text-[11px] font-semibold leading-none tabular-nums text-text-muted">
            {participants.length}
          </span>
        )}
      </button>

      {participants.length > 0 && (
        <ul className="ml-6 mt-0.5 flex flex-col gap-0.5 pb-1">
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
                  {participantName(participant, { nameOf })}
                  {selfElsewhere ? " · other device" : ""}
                </span>
                {participant.isGuest === true && <Badge size="sm">Guest</Badge>}
                {participant.muted && (
                  <Icon name="mic-off" size={12} className="shrink-0 text-danger-text" />
                )}
                {participant.sharingScreen && (
                  <Icon name="monitor" size={12} className="shrink-0 text-accent-text" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
