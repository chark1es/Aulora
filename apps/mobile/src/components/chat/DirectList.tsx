/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { type ChannelView, dmPartnerId, type PresenceRow } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { ChannelFlags } from "./ChannelList";
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
  const palette = usePalette();
  const partner = dmPartnerId(channel, ownUserId);
  const others = (channel.memberIds ?? []).filter((userId) => userId !== ownUserId);
  if (partner !== undefined) {
    const status = presence.find((row) => row.userId === partner)?.status ?? "offline";
    return <PresenceAvatar userId={partner} status={status} size={36} />;
  }
  if (others.length < 2) {
    return <MemberAvatar userId={ownUserId} size={36} />;
  }
  return (
    <View style={{ width: 36, height: 36 }}>
      <MemberAvatar userId={others[0] ?? ownUserId} size={24} />
      <View
        className="absolute bottom-0 right-0 rounded-pill border-2"
        style={{ borderColor: palette["surface-2"] }}
      >
        <MemberAvatar userId={others[1] ?? ownUserId} size={22} />
      </View>
    </View>
  );
}

/** Group size for a group, otherwise the other person's custom status when they set one. */
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
  const palette = usePalette();
  return (
    <View className="items-center gap-3 px-8 pt-16">
      <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
        <Icon name="message" size={24} color={palette["text-muted"]} />
      </View>
      <Text tone="muted" className="text-center">
        Message a teammate directly, or start a group.
      </Text>
    </View>
  );
}

export interface DirectListProps {
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly activeChannelId: string | undefined;
  readonly ownUserId: string;
  readonly presence: readonly PresenceRow[];
  readonly onOpenChannel: (channelId: string) => void;
  readonly onChannelActions: (channel: ChannelView) => void;
  readonly onNewMessage: () => void;
}

/** The hub's DMs tab: one-to-one and group conversations, with who is around. */
export function DirectList(props: DirectListProps) {
  const clearance = useDockClearance();
  const { titles, ownUserId, presence } = props;
  const direct = props.channels.filter((entry) => entry.kind === "dm" || entry.kind === "group_dm");

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 12 }}
    >
      <View className="-mx-3">
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
          {direct.map((entry) => (
            <ListRow
              key={entry.id}
              title={titles.get(entry.id) ?? entry.name}
              subtitle={directSubtitle(entry, ownUserId, presence)}
              selected={entry.id === props.activeChannelId}
              trailing={<ChannelFlags channel={entry} />}
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
