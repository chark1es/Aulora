/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type ChannelView, dmPartnerId, type PresenceRow, partitionPinnedDms } from "@aulora/core";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import type { RowUnread } from "../../lib/conversation-row";
import { ChannelFlags } from "./ChannelList";
import { GroupAvatar } from "./GroupAvatar";
import { PaneHeader, RoundButton, useDockClearance } from "./HubPane";
import { ListGroup, ListRow } from "./List";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";

interface DirectAvatarProps {
  readonly channel: ChannelView;
  readonly ownUserId: string;
  readonly presence: readonly PresenceRow[];
}

/** The other person with their presence, two overlapped faces for a group, or yourself for notes. */
function DirectAvatar({ channel, ownUserId, presence }: DirectAvatarProps) {
  const partner = dmPartnerId(channel, ownUserId);
  const others = (channel.memberIds ?? []).filter((userId) => userId !== ownUserId);
  if (partner !== undefined) {
    const status = presence.find((row) => row.userId === partner)?.status ?? "offline";
    return <PresenceAvatar userId={partner} status={status} size={36} />;
  }
  if (others.length < 2) {
    return <MemberAvatar userId={ownUserId} size={36} />;
  }
  return <GroupAvatar userIds={others} size={36} />;
}

/** Group size for a group, otherwise the other person’s custom status when they set one. */
function directSubtitle(
  channel: ChannelView,
  ownUserId: string,
  presence: readonly PresenceRow[],
): string | undefined {
  if (channel.kind === "group_dm") {
    return `${(channel.memberIds ?? []).length} people`;
  }
  const partner = dmPartnerId(channel, ownUserId);
  const custom = presence.find((row) => row.userId === partner)?.customStatus;
  return custom !== null && custom !== undefined && custom.length > 0 ? custom : undefined;
}

function DirectEmpty() {
  return (
    <View className="gap-1 px-1 pt-12">
      <Heading level={3} accessibilityRole="header">
        No direct messages yet
      </Heading>
      <Text size="sm" tone="muted">
        Message a teammate directly, or start a group.
      </Text>
    </View>
  );
}

/** The trailing marks on a conversation row: a pin when pinned, then mute/hidden. */
function DirectTrailing({ channel }: { readonly channel: ChannelView }) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-1.5">
      {channel.pinned === true && <Icon name="pin" size={15} color={palette["text-muted"]} />}
      <ChannelFlags channel={channel} />
    </View>
  );
}

export interface DirectListProps {
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly activeChannelId: string | undefined;
  readonly unreadByChannel: ReadonlyMap<string, RowUnread>;
  readonly ownUserId: string;
  readonly presence: readonly PresenceRow[];
  readonly onOpenChannel: (channelId: string) => void;
  readonly onChannelActions: (channel: ChannelView) => void;
  readonly onNewMessage: () => void;
}

/** The hub’s DMs tab: one-to-one and group conversations, with who is around. */
export function DirectList(props: DirectListProps) {
  const clearance = useDockClearance();
  const { titles, ownUserId, presence } = props;
  const direct = props.channels.filter((entry) => entry.kind === "dm" || entry.kind === "group_dm");
  const { pinned, others } = partitionPinnedDms(direct);

  return (
    <ScrollView
      className="flex-1 min-w-0"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: clearance, gap: 12 }}
    >
      <View className="-mx-4">
        <PaneHeader
          title="Direct messages"
          trailing={
            <RoundButton
              icon="compose"
              label="New message"
              tone="accent"
              onPress={props.onNewMessage}
            />
          }
        />
      </View>
      {direct.length === 0 ? (
        <DirectEmpty />
      ) : (
        <ListGroup inset={60}>
          {[...pinned, ...others].map((entry) => (
            <ListRow
              key={entry.id}
              title={titles.get(entry.id) ?? entry.name}
              subtitle={directSubtitle(entry, ownUserId, presence)}
              selected={entry.id === props.activeChannelId}
              activeTick={entry.id === props.activeChannelId}
              muted={entry.muted === true}
              unread={props.unreadByChannel.get(entry.id)}
              trailing={<DirectTrailing channel={entry} />}
              leading={<DirectAvatar channel={entry} ownUserId={ownUserId} presence={presence} />}
              onPress={() => {
                props.onOpenChannel(entry.id);
              }}
              onLongPress={() => {
                props.onChannelActions(entry);
              }}
            />
          ))}
        </ListGroup>
      )}
    </ScrollView>
  );
}
