import type { ChannelView, PresenceRow } from "@aulora/core";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileMemberEntry } from "../../providers/ChatProvider";
import { PaneHeader, RoundButton } from "./HubPane";
import { ListGroup, ListHeader, ListRow } from "./List";
import { PresenceAvatar } from "./PresenceAvatar";

type Status = PresenceRow["status"];

const GROUPS: readonly { readonly status: Status; readonly title: string }[] = [
  { status: "online", title: "Online" },
  { status: "idle", title: "Idle" },
  { status: "dnd", title: "Do not disturb" },
  { status: "offline", title: "Offline" },
];

export interface MembersPaneProps {
  readonly channel: ChannelView | undefined;
  readonly channelTitle: string;
  readonly members: readonly MobileMemberEntry[];
  readonly presence: readonly PresenceRow[];
  readonly ownUserId: string;
  readonly canModerateMembers: boolean;
  readonly onBack: () => void;
  readonly onMemberPress: (userId: string) => void;
  readonly onMemberActions: (userId: string) => void;
  readonly onOpenBans?: (() => void) | undefined;
}

/**
 * The right-hand pane: who is in this conversation, grouped by presence. A
 * private channel or direct message lists its own people; open channels list
 * the whole workspace.
 */
export function MembersPane({
  channel,
  channelTitle,
  members,
  presence,
  ownUserId,
  canModerateMembers,
  onBack,
  onMemberPress,
  onMemberActions,
  onOpenBans,
}: MembersPaneProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const scoped = useMemo(() => {
    const restricted =
      channel !== undefined &&
      (channel.kind === "dm" || channel.kind === "group_dm" || channel.isPrivate === true);
    if (!restricted) return members;
    const ids = new Set(channel.memberIds ?? []);
    return members.filter((member) => ids.has(member.userId));
  }, [channel, members]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const byUser = new Map(presence.map((row) => [row.userId, row]));
    return scoped
      .filter((member) => member.displayName.toLocaleLowerCase().includes(needle))
      .map((member) => ({ member, presence: byUser.get(member.userId) }))
      .sort((a, b) => a.member.displayName.localeCompare(b.member.displayName));
  }, [scoped, presence, query]);

  const scopedToChannel = scoped !== members;
  const online = rows.filter((row) => (row.presence?.status ?? "offline") !== "offline").length;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <PaneHeader
        title="Members"
        subtitle={`${scopedToChannel ? channelTitle : "Everyone in the workspace"} · ${online} of ${scoped.length} online`}
        leading={<RoundButton icon="chevron-left" label="Back to conversation" onPress={onBack} />}
      />
      <View className="mx-3 mb-2 min-h-11 flex-row items-center gap-2 rounded-pill bg-surface-2 px-4">
        <Icon name="search" size={18} color={palette["text-muted"]} />
        <TextInput
          accessibilityLabel="Filter members"
          placeholder="Filter by name"
          placeholderTextColor={palette["text-muted"]}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          className="min-h-11 flex-1 py-0 text-[17px] text-text"
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
      >
        {GROUPS.map((group) => {
          const inGroup = rows.filter(
            (row) => (row.presence?.status ?? "offline") === group.status,
          );
          if (inGroup.length === 0) return null;
          return (
            <View key={group.status}>
              <ListHeader title={`${group.title} · ${inGroup.length}`} />
              <ListGroup>
                {inGroup.map(({ member, presence: row }) => {
                  const own = member.userId === ownUserId;
                  const custom = row?.customStatus ?? "";
                  return (
                    <ListRow
                      key={member.userId}
                      accessibilityLabel={`Profile of ${member.displayName}`}
                      title={own ? `${member.displayName} (you)` : member.displayName}
                      subtitle={
                        custom.length > 0 ? custom : member.isOwner ? "Workspace owner" : undefined
                      }
                      leading={
                        <PresenceAvatar
                          userId={member.userId}
                          status={group.status}
                          roleColor={member.roleColor}
                          size={36}
                        />
                      }
                      trailing={
                        canModerateMembers && !own && !member.isOwner ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Actions for ${member.displayName}`}
                            hitSlop={8}
                            onPress={() => onMemberActions(member.userId)}
                            className="h-9 w-9 items-center justify-center rounded-pill active:bg-surface-3"
                          >
                            <Icon name="more-horizontal" size={20} color={palette["text-muted"]} />
                          </Pressable>
                        ) : undefined
                      }
                      onPress={() => onMemberPress(member.userId)}
                    />
                  );
                })}
              </ListGroup>
            </View>
          );
        })}
        {rows.length === 0 && (
          <View className="items-center gap-2 px-6 py-12">
            <Icon name="users" size={28} color={palette["text-muted"]} />
            <Text tone="muted" className="text-center">
              {query.trim().length > 0 ? `Nobody matches “${query.trim()}”.` : "No members yet."}
            </Text>
          </View>
        )}
        {onOpenBans !== undefined && (
          <ListGroup>
            <ListRow icon="ban" title="Banned members" chevron onPress={onOpenBans} />
          </ListGroup>
        )}
      </ScrollView>
    </View>
  );
}
