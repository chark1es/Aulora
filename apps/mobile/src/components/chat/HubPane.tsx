import { NativeAvatar } from "@aulora/avatars/native";
import {
  activityLabel,
  type CallView,
  type ChannelView,
  dmPartnerId,
  type PresenceRow,
} from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionFeedback } from "../../lib/haptics";
import type { CategoryView, MobileMemberEntry } from "../../providers/ChatProvider";
import { VoiceChannelSection } from "../voice/VoiceChannelSection";
import { ListGroup, ListHeader, ListRow } from "./List";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";
import { HorizontalScroll } from "./SwipePanes";
import type { ThreadInboxItem } from "./ThreadsInbox";

/** `threads` is the full thread list, opened from the Channels tab rather than the dock. */
export type HubTab = "chats" | "dms" | "threads" | "search" | "you";

/** Height of the floating dock, used to pad scrolling content clear of it. */
export const DOCK_HEIGHT = 64;

/** Space a hub tab must leave at its bottom edge so nothing hides under the dock. */
export function useDockClearance(): number {
  const insets = useSafeAreaInsets();
  return DOCK_HEIGHT + Math.max(insets.bottom, 12) + 16;
}

/** Large left-aligned title shared by every full-screen pane. */
export function PaneHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
      {leading}
      <View className="min-w-0 flex-1">
        <Heading level={2} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {title}
        </Heading>
        {subtitle !== undefined && subtitle.length > 0 && (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}

/** Round 36pt button for a header or section action. */
export function RoundButton({
  icon,
  label,
  onPress,
  tone = "default",
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "default" | "accent";
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-pill active:opacity-70 ${
        tone === "accent" ? "bg-accent" : "bg-surface-2"
      }`}
    >
      <Icon name={icon} size={18} color={tone === "accent" ? palette["on-accent"] : palette.text} />
    </Pressable>
  );
}

const TABS: readonly { readonly key: HubTab; readonly label: string; readonly icon: IconName }[] = [
  { key: "chats", label: "Channels", icon: "hash" },
  { key: "dms", label: "DMs", icon: "message" },
];

const FLOAT_SHADOW = {
  shadowColor: "#000",
  shadowOpacity: 0.16,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
} as const;

/**
 * The hub's floating controls, all at thumb height: the tab bar in the middle,
 * the workspace switcher on its own at the leading end (it opens a sheet, so it
 * is not a tab) and search on its own at the trailing end.
 */
export function HubDock({
  tab,
  onTab,
  workspaceName,
  workspaceSeed,
  onSwitchWorkspace,
  ownUserId,
  ownStatus,
  threadBadge,
}: {
  readonly tab: HubTab;
  readonly onTab: (tab: HubTab) => void;
  readonly workspaceName: string;
  readonly workspaceSeed: string;
  readonly onSwitchWorkspace: () => void;
  readonly ownUserId: string;
  readonly ownStatus: string;
  readonly threadBadge: number;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  function select(next: HubTab) {
    if (next !== tab) selectionFeedback();
    onTab(next);
  }
  const label = (active: boolean) =>
    ({ fontSize: 11, lineHeight: 14, fontWeight: active ? "600" : "400" }) as const;
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 flex-row items-center justify-center gap-2.5 px-4"
      style={{ bottom: Math.max(insets.bottom, 12) }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch workspace, current ${workspaceName}`}
        onPress={onSwitchWorkspace}
        className="items-center justify-center rounded-[20px] border border-border bg-surface-2 active:opacity-70"
        style={[{ width: DOCK_HEIGHT, height: DOCK_HEIGHT }, FLOAT_SHADOW]}
      >
        <NativeAvatar seed={workspaceSeed} size={38} shape="squircle" />
        <View
          className="absolute bottom-1 right-1 h-[18px] w-[18px] items-center justify-center rounded-pill bg-surface-3"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name="chevron-down" size={14} color={palette["text-muted"]} />
        </View>
      </Pressable>

      <View
        accessibilityRole="tablist"
        className="max-w-xs flex-1 flex-row items-center rounded-pill border border-border bg-surface-2 px-1.5"
        style={[{ height: DOCK_HEIGHT }, FLOAT_SHADOW]}
      >
        {TABS.map((entry) => {
          const active = entry.key === tab || (entry.key === "chats" && tab === "threads");
          const badge = entry.key === "chats" ? threadBadge : 0;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="tab"
              accessibilityLabel={
                badge > 0 ? `${entry.label}, ${badge} thread mentions` : entry.label
              }
              accessibilityState={{ selected: active }}
              onPress={() => select(entry.key)}
              className={`h-[52px] flex-1 items-center justify-center gap-0.5 rounded-pill ${
                active ? "bg-accent-soft" : ""
              }`}
            >
              <View>
                <Icon
                  name={entry.icon}
                  size={22}
                  color={active ? palette.accent : palette["text-muted"]}
                />
                {badge > 0 && (
                  <View className="absolute -right-3 -top-1 min-w-[18px] items-center rounded-pill bg-accent px-1">
                    <Text
                      className="font-bold"
                      style={{ color: palette["on-accent"], fontSize: 11, lineHeight: 16 }}
                      maxFontSizeMultiplier={1.2}
                    >
                      {badge > 9 ? "9+" : String(badge)}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={label(active)}
                tone={active ? "accent" : "muted"}
                maxFontSizeMultiplier={1.3}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="You"
          accessibilityState={{ selected: tab === "you" }}
          onPress={() => select("you")}
          className={`h-[52px] flex-1 items-center justify-center gap-0.5 rounded-pill ${
            tab === "you" ? "bg-accent-soft" : ""
          }`}
        >
          <PresenceAvatar userId={ownUserId} status={ownStatus} size={22} />
          <Text
            style={label(tab === "you")}
            tone={tab === "you" ? "accent" : "muted"}
            maxFontSizeMultiplier={1.3}
          >
            You
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="tab"
        accessibilityLabel="Search"
        accessibilityState={{ selected: tab === "search" }}
        onPress={() => select("search")}
        className={`items-center justify-center rounded-pill border border-border active:opacity-70 ${
          tab === "search" ? "bg-accent" : "bg-surface-2"
        }`}
        style={[{ width: DOCK_HEIGHT, height: DOCK_HEIGHT }, FLOAT_SHADOW]}
      >
        <Icon
          name="search"
          size={24}
          color={tab === "search" ? palette["on-accent"] : palette.text}
        />
      </Pressable>
    </View>
  );
}

/** How many recent threads the Channels tab previews before "See all". */
const THREAD_PREVIEW_COUNT = 3;

function channelIcon(channel: ChannelView): IconName {
  if (channel.isPrivate === true) return "lock";
  return channel.kind === "announcement" ? "megaphone" : "hash";
}

export interface ChannelListProps {
  readonly workspaceName: string;
  readonly channels: readonly ChannelView[];
  readonly categories: readonly CategoryView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly activeChannelId: string | undefined;
  readonly ownUserId: string;
  readonly presence: readonly PresenceRow[];
  readonly members: readonly MobileMemberEntry[];
  /** The server's host, shown under the workspace name. */
  readonly workspaceHost: string;
  readonly hiddenCount: number;
  readonly showHidden: boolean;
  readonly canManageChannels: boolean;
  readonly activeCalls: readonly CallView[];
  readonly memberNames: ReadonlyMap<string, string>;
  readonly clientId: string | null;
  readonly localCallId: string | null;
  readonly remoteLevels?: ReadonlyMap<string, number>;
  readonly onOpenChannel: (channelId: string) => void;
  readonly onMemberPress: (userId: string) => void;
  readonly onChannelActions: (channel: ChannelView) => void;
  readonly onJoinVoice: (channelId: string) => void;
  /** Threads the viewer is part of, most recently active first; `undefined` while loading. */
  readonly threads: readonly ThreadInboxItem[] | undefined;
  readonly onOpenThread: (thread: ThreadInboxItem) => void;
  readonly onOpenThreads: () => void;
  readonly onCreateChannel: () => void;
  readonly onToggleHidden: () => void;
}

/** The hub's home tab: every conversation in the workspace, grouped the way the team organised it. */
export function ChannelList({
  workspaceName,
  channels,
  categories,
  titles,
  activeChannelId,
  ownUserId,
  presence,
  members,
  workspaceHost,
  hiddenCount,
  showHidden,
  canManageChannels,
  activeCalls,
  memberNames,
  clientId,
  localCallId,
  remoteLevels,
  onOpenChannel,
  onMemberPress,
  onChannelActions,
  onJoinVoice,
  threads,
  onOpenThread,
  onOpenThreads,
  onCreateChannel,
  onToggleHidden,
}: ChannelListProps) {
  const palette = usePalette();
  const clearance = useDockClearance();
  const statusOf = (userId: string) =>
    presence.find((row) => row.userId === userId)?.status ?? "offline";
  // Everyone else who is around right now, most available first.
  const order = { online: 0, idle: 1, dnd: 2, offline: 3 } as const;
  const here = members
    .filter((member) => member.userId !== ownUserId && statusOf(member.userId) !== "offline")
    .sort((a, b) => order[statusOf(a.userId)] - order[statusOf(b.userId)]);

  const text = channels.filter((entry) => entry.kind === "text" || entry.kind === "announcement");
  const known = new Set(categories.map((category) => category.id));
  const sections = [
    {
      key: "none",
      title: "Channels",
      rows: text.filter((entry) => entry.categoryId === null || !known.has(entry.categoryId)),
    },
    ...[...categories]
      .sort((a, b) => a.position - b.position)
      .map((category) => ({
        key: category.id,
        title: category.name,
        rows: text.filter((entry) => entry.categoryId === category.id),
      })),
  ].filter((section, index) => section.rows.length > 0 || (index === 0 && canManageChannels));

  function accessories(entry: ChannelView) {
    if (entry.muted !== true && entry.hidden !== true) return undefined;
    return (
      <View className="flex-row gap-1.5">
        {entry.muted === true && <Icon name="bell-off" size={15} color={palette["text-muted"]} />}
        {entry.hidden === true && <Icon name="eye-off" size={15} color={palette["text-muted"]} />}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 18 }}
    >
      <View className="gap-3 pt-2">
        <View className="px-1">
          <Heading
            level={2}
            numberOfLines={1}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.4}
          >
            {workspaceName}
          </Heading>
          <Text size="xs" tone="muted" mono numberOfLines={1}>
            {workspaceHost}
          </Text>
        </View>
        {here.length === 0 ? (
          <Text size="sm" tone="muted" className="px-1">
            {members.length > 1
              ? "Nobody else is around right now."
              : "You're the first one here. Invite your team from the web app."}
          </Text>
        ) : (
          <HorizontalScroll
            accessibilityLabel={`Here now, ${here.length} ${here.length === 1 ? "person" : "people"}`}
            className="-mx-3"
            contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
          >
            {here.map((member) => (
              <Pressable
                key={member.userId}
                accessibilityRole="button"
                accessibilityLabel={`${member.displayName}, ${statusOf(member.userId)}`}
                onPress={() => onMemberPress(member.userId)}
                className="w-16 items-center gap-1 py-1 active:opacity-70"
              >
                <PresenceAvatar
                  userId={member.userId}
                  status={statusOf(member.userId)}
                  roleColor={member.roleColor}
                  size={48}
                  surface={palette.bg}
                />
                <Text size="xs" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {member.displayName.split(" ")[0]}
                </Text>
              </Pressable>
            ))}
          </HorizontalScroll>
        )}
      </View>

      {threads !== undefined && threads.length > 0 && (
        <View>
          <ListHeader
            title="Threads"
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="See all threads"
                hitSlop={8}
                onPress={onOpenThreads}
                className="min-h-9 flex-row items-center gap-0.5 px-2 active:opacity-70"
              >
                <Text size="sm" tone="accent">
                  See all
                </Text>
                <Icon name="chevron-right" size={16} color={palette.accent} />
              </Pressable>
            }
          />
          <ListGroup inset={56}>
            {threads.slice(0, THREAD_PREVIEW_COUNT).map((thread) => {
              const channel = channels.find((entry) => entry.id === thread.channelId);
              const direct = channel?.kind === "dm" || channel?.kind === "group_dm";
              const place = `${direct ? "" : "#"}${titles.get(thread.channelId) ?? "conversation"}`;
              const author =
                thread.authorId === ownUserId
                  ? "You"
                  : (memberNames.get(thread.authorId) ?? "Member");
              return (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Thread by ${author} in ${place}, ${thread.replyCount} ${
                    thread.replyCount === 1 ? "reply" : "replies"
                  }${thread.viewerMentioned ? ", mentions you" : ""}`}
                  onPress={() => onOpenThread(thread)}
                  className="flex-row gap-3 px-3 py-2.5 active:bg-surface-3"
                >
                  <MemberAvatar userId={thread.authorId} size={32} />
                  <View className="min-w-0 flex-1 gap-0.5">
                    <View className="flex-row items-baseline gap-2">
                      <Text size="sm" className="shrink font-semibold" numberOfLines={1}>
                        {author}
                      </Text>
                      <Text size="xs" tone="muted" className="flex-1" numberOfLines={1}>
                        {place}
                      </Text>
                      <Text size="xs" tone="muted">
                        {activityLabel(thread.lastReplyAt ?? thread.createdAt)}
                      </Text>
                    </View>
                    <Text size="sm" tone="muted" numberOfLines={1}>
                      {thread.body}
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <Text size="xs" tone="accent" className="font-semibold">
                        {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
                      </Text>
                      {thread.viewerMentioned && (
                        <View className="flex-row items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5">
                          <Icon name="at" size={12} color={palette.accent} />
                          <Text size="xs" tone="accent">
                            Mentioned you
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ListGroup>
        </View>
      )}

      {sections.map((section, index) => (
        <View key={section.key}>
          <ListHeader
            title={section.title}
            action={
              index === 0 && canManageChannels ? (
                <RoundButton icon="plus" label="Create channel" onPress={onCreateChannel} />
              ) : undefined
            }
          />
          {section.rows.length === 0 ? (
            <Text size="sm" tone="muted" className="px-4 py-2">
              No channels yet. Create the first one.
            </Text>
          ) : (
            <ListGroup>
              {section.rows.map((entry) => (
                <ListRow
                  key={entry.id}
                  icon={channelIcon(entry)}
                  title={titles.get(entry.id) ?? entry.name}
                  subtitle={entry.topic ?? undefined}
                  selected={entry.id === activeChannelId}
                  trailing={accessories(entry)}
                  onPress={() => onOpenChannel(entry.id)}
                  onLongPress={() => onChannelActions(entry)}
                />
              ))}
            </ListGroup>
          )}
        </View>
      ))}

      <VoiceChannelSection
        channels={channels}
        activeCalls={activeCalls}
        memberNames={memberNames}
        selfUserId={ownUserId}
        clientId={clientId}
        localCallId={localCallId}
        {...(remoteLevels !== undefined ? { remoteLevels } : {})}
        onJoin={onJoinVoice}
      />

      {hiddenCount > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={onToggleHidden}
          className="min-h-12 flex-row items-center justify-center gap-2 active:opacity-70"
        >
          <Icon name={showHidden ? "eye-off" : "eye"} size={16} color={palette["text-muted"]} />
          <Text size="sm" tone="muted">
            {showHidden
              ? "Hide hidden conversations"
              : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? "conversation" : "conversations"}`}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

/** The hub's DMs tab: one-to-one and group conversations, with who is around. */
export function DirectList({
  channels,
  titles,
  activeChannelId,
  ownUserId,
  presence,
  onOpenChannel,
  onChannelActions,
  onNewMessage,
}: {
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly activeChannelId: string | undefined;
  readonly ownUserId: string;
  readonly presence: readonly PresenceRow[];
  readonly onOpenChannel: (channelId: string) => void;
  readonly onChannelActions: (channel: ChannelView) => void;
  readonly onNewMessage: () => void;
}) {
  const palette = usePalette();
  const clearance = useDockClearance();
  const statusOf = (userId: string) =>
    presence.find((row) => row.userId === userId)?.status ?? "offline";
  const direct = channels.filter((entry) => entry.kind === "dm" || entry.kind === "group_dm");

  function accessories(entry: ChannelView) {
    if (entry.muted !== true && entry.hidden !== true) return undefined;
    return (
      <View className="flex-row gap-1.5">
        {entry.muted === true && <Icon name="bell-off" size={15} color={palette["text-muted"]} />}
        {entry.hidden === true && <Icon name="eye-off" size={15} color={palette["text-muted"]} />}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 12 }}
    >
      <View className="-mx-3">
        <PaneHeader
          title="Direct messages"
          trailing={
            <RoundButton icon="compose" label="New message" tone="accent" onPress={onNewMessage} />
          }
        />
      </View>
      {direct.length === 0 ? (
        <View className="items-center gap-3 px-8 pt-16">
          <View className="h-14 w-14 items-center justify-center rounded-pill bg-surface-2">
            <Icon name="message" size={24} color={palette["text-muted"]} />
          </View>
          <Text tone="muted" className="text-center">
            Message a teammate directly, or start a group.
          </Text>
        </View>
      ) : (
        <ListGroup inset={60}>
          {direct.map((entry) => {
            const partner = dmPartnerId(entry, ownUserId);
            const others = (entry.memberIds ?? []).filter((userId) => userId !== ownUserId);
            const status = partner === undefined ? "offline" : statusOf(partner);
            const custom = presence.find((row) => row.userId === partner)?.customStatus;
            return (
              <ListRow
                key={entry.id}
                title={titles.get(entry.id) ?? entry.name}
                subtitle={
                  entry.kind === "group_dm"
                    ? `${others.length + 1} people`
                    : custom !== null && custom !== undefined && custom.length > 0
                      ? custom
                      : undefined
                }
                selected={entry.id === activeChannelId}
                trailing={accessories(entry)}
                leading={
                  partner !== undefined ? (
                    <PresenceAvatar userId={partner} status={status} size={36} />
                  ) : others.length > 1 ? (
                    <View style={{ width: 36, height: 36 }}>
                      <MemberAvatar userId={others[0] ?? ownUserId} size={24} />
                      <View
                        className="absolute bottom-0 right-0 rounded-pill border-2 border-surface-2"
                        style={{ borderColor: palette["surface-2"] }}
                      >
                        <MemberAvatar userId={others[1] ?? ownUserId} size={22} />
                      </View>
                    </View>
                  ) : (
                    <MemberAvatar userId={ownUserId} size={36} />
                  )
                }
                onPress={() => onOpenChannel(entry.id)}
                onLongPress={() => onChannelActions(entry)}
              />
            );
          })}
        </ListGroup>
      )}
    </ScrollView>
  );
}
