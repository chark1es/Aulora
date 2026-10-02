/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { PresenceRow } from "@aulora/core";
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

interface MemberFilterProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function MemberFilter({ value, onChange }: MemberFilterProps) {
  const palette = usePalette();
  return (
    <View className="mx-3 mb-2 min-h-11 flex-row items-center gap-2 rounded-pill bg-surface-2 px-4">
      <Icon name="search" size={18} color={palette["text-muted"]} />
      <TextInput
        accessibilityLabel="Filter members"
        placeholder="Filter by name"
        placeholderTextColor={palette["text-muted"]}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        className="min-h-11 flex-1 py-0 text-[17px] text-text"
      />
    </View>
  );
}

interface MemberRowProps {
  readonly member: MobileMemberEntry;
  readonly status: Status;
  readonly customStatus: string;
  readonly own: boolean;
  /** Present when the viewer may moderate this member. */
  readonly onActions?: (() => void) | undefined;
  readonly onPress: () => void;
}

function MemberRow({ member, status, customStatus, own, onActions, onPress }: MemberRowProps) {
  const palette = usePalette();
  return (
    <ListRow
      accessibilityLabel={`Profile of ${member.displayName}`}
      title={own ? `${member.displayName} (you)` : member.displayName}
      subtitle={
        customStatus.length > 0 ? customStatus : member.isOwner ? "Workspace owner" : undefined
      }
      leading={
        <PresenceAvatar
          userId={member.userId}
          status={status}
          roleColor={member.roleColor}
          size={36}
        />
      }
      trailing={
        onActions !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${member.displayName}`}
            hitSlop={8}
            onPress={onActions}
            className="h-9 w-9 items-center justify-center rounded-pill active:bg-surface-3"
          >
            <Icon name="more-horizontal" size={20} color={palette["text-muted"]} />
          </Pressable>
        ) : undefined
      }
      onPress={onPress}
    />
  );
}

function NoMembers({ query }: { readonly query: string }) {
  const palette = usePalette();
  return (
    <View className="items-center gap-2 px-6 py-12">
      <Icon name="users" size={28} color={palette["text-muted"]} />
      <Text tone="muted" className="text-center">
        {query.length > 0 ? `Nobody matches “${query}”.` : "No members yet."}
      </Text>
    </View>
  );
}

export interface MembersPaneProps {
  /**
   * The people in this conversation, for a private channel or direct message.
   * Omitted for an open channel, which lists the whole workspace.
   */
  readonly memberIds?: readonly string[] | undefined;
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

/** Members matching the filter, with their presence, sorted by name. */
function useMemberRows(props: MembersPaneProps, query: string) {
  const { memberIds, members, presence } = props;
  const scoped = useMemo(() => {
    if (memberIds === undefined) return members;
    const ids = new Set(memberIds);
    return members.filter((member) => ids.has(member.userId));
  }, [memberIds, members]);

  const rows = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    const byUser = new Map(presence.map((row) => [row.userId, row]));
    return scoped
      .filter((member) => member.displayName.toLocaleLowerCase().includes(needle))
      .map((member) => ({
        member,
        status: byUser.get(member.userId)?.status ?? "offline",
        customStatus: byUser.get(member.userId)?.customStatus ?? "",
      }))
      .sort((a, b) => a.member.displayName.localeCompare(b.member.displayName));
  }, [scoped, presence, query]);

  return { rows, total: scoped.length };
}

/**
 * The right-hand pane: who is in this conversation, grouped by presence. A
 * private channel or direct message lists its own people; open channels list
 * the whole workspace.
 */
export function MembersPane(props: MembersPaneProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const { rows, total } = useMemberRows(props, query.trim());
  const online = rows.filter((row) => row.status !== "offline").length;
  const scope = props.memberIds === undefined ? "Everyone in the workspace" : props.channelTitle;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <PaneHeader
        title="Members"
        subtitle={`${scope} · ${online} of ${total} online`}
        leading={
          <RoundButton icon="chevron-left" label="Back to conversation" onPress={props.onBack} />
        }
      />
      <MemberFilter value={query} onChange={setQuery} />
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
          const inGroup = rows.filter((row) => row.status === group.status);
          if (inGroup.length === 0) return null;
          return (
            <View key={group.status}>
              <ListHeader title={`${group.title} · ${inGroup.length}`} />
              <ListGroup>
                {inGroup.map(({ member, status, customStatus }) => {
                  const own = member.userId === props.ownUserId;
                  const moderate = props.canModerateMembers && !own && !member.isOwner;
                  return (
                    <MemberRow
                      key={member.userId}
                      member={member}
                      status={status}
                      customStatus={customStatus}
                      own={own}
                      onActions={
                        moderate
                          ? () => {
                              props.onMemberActions(member.userId);
                            }
                          : undefined
                      }
                      onPress={() => {
                        props.onMemberPress(member.userId);
                      }}
                    />
                  );
                })}
              </ListGroup>
            </View>
          );
        })}
        {rows.length === 0 && <NoMembers query={query.trim()} />}
        {props.onOpenBans !== undefined && (
          <ListGroup>
            <ListRow icon="ban" title="Banned members" chevron onPress={props.onOpenBans} />
          </ListGroup>
        )}
      </ScrollView>
    </View>
  );
}
