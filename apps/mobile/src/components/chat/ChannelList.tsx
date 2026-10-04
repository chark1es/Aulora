/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { activityLabel, type CallView, type ChannelView, type PresenceRow } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import type { CategoryView, MobileMemberEntry } from "../../providers/ChatProvider";
import { VoiceChannelSection } from "../voice/VoiceChannelSection";
import { RoundButton, useDockClearance } from "./HubPane";
import { ListGroup, ListHeader, ListRow } from "./List";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";
import { HorizontalScroll } from "./SwipePanes";
import type { ThreadInboxItem } from "./ThreadsInbox";

/** How many recent threads the Channels tab previews before "See all". */
const THREAD_PREVIEW_COUNT = 3;

/** Most available first. */
const PRESENCE_ORDER = { online: 0, idle: 1, dnd: 2, offline: 3 } as const;

function channelIcon(channel: ChannelView): IconName {
  if (channel.isPrivate === true) return "lock";
  return channel.kind === "announcement" ? "megaphone" : "hash";
}

function statusIn(presence: readonly PresenceRow[], userId: string): PresenceRow["status"] {
  return presence.find((row) => row.userId === userId)?.status ?? "offline";
}

/** The muted and hidden markers at the trailing edge of a conversation row. */
export function ChannelFlags({ channel }: { readonly channel: ChannelView }) {
  const palette = usePalette();
  if (channel.muted !== true && channel.hidden !== true) return null;
  return (
    <View className="flex-row gap-1.5">
      {channel.muted === true && <Icon name="bell-off" size={15} color={palette["text-muted"]} />}
      {channel.hidden === true && <Icon name="eye-off" size={15} color={palette["text-muted"]} />}
    </View>
  );
}

interface HereNowProps {
  readonly members: readonly MobileMemberEntry[];
  readonly presence: readonly PresenceRow[];
  readonly ownUserId: string;
  readonly onMemberPress: (userId: string) => void;
}

/** Everyone else who is around right now, as a strip of faces. */
function HereNow({ members, presence, ownUserId, onMemberPress }: HereNowProps) {
  const palette = usePalette();
  const here = members
    .filter(
      (member) => member.userId !== ownUserId && statusIn(presence, member.userId) !== "offline",
    )
    .sort(
      (a, b) =>
        PRESENCE_ORDER[statusIn(presence, a.userId)] - PRESENCE_ORDER[statusIn(presence, b.userId)],
    );
  if (here.length === 0) {
    return (
      <Text size="sm" tone="muted" className="px-1">
        {members.length > 1
          ? "Nobody else is around right now."
          : "You're the first one here. Invite your team from the web app."}
      </Text>
    );
  }
  return (
    <HorizontalScroll
      accessibilityLabel={`Here now, ${here.length} ${here.length === 1 ? "person" : "people"}`}
      className="-mx-3"
      contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
    >
      {here.map((member) => (
        <Pressable
          key={member.userId}
          accessibilityRole="button"
          accessibilityLabel={`${member.displayName}, ${statusIn(presence, member.userId)}`}
          onPress={() => {
            onMemberPress(member.userId);
          }}
          className="w-16 items-center gap-1 py-1 active:opacity-70"
        >
          <PresenceAvatar
            userId={member.userId}
            status={statusIn(presence, member.userId)}
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
  );
}

interface ThreadPreviewRowProps {
  readonly thread: ThreadInboxItem;
  /** Display name of the thread's author, or "You". */
  readonly author: string;
  /** Where the thread lives, such as `#general` or a person's name. */
  readonly place: string;
  readonly onOpen: () => void;
}

function ThreadPreviewRow({ thread, author, place, onOpen }: ThreadPreviewRowProps) {
  const palette = usePalette();
  const replies = `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Thread by ${author} in ${place}, ${replies}${
        thread.viewerMentioned ? ", mentions you" : ""
      }`}
      onPress={onOpen}
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
            {replies}
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
}

interface ThreadPreviewsProps {
  readonly threads: readonly ThreadInboxItem[];
  readonly channels: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly ownUserId: string;
  readonly onOpenThread: (thread: ThreadInboxItem) => void;
  readonly onOpenThreads: () => void;
}

/** The most recently active threads the viewer is part of, with a way to the full list. */
function ThreadPreviews(props: ThreadPreviewsProps) {
  const palette = usePalette();
  const { threads, channels, titles, memberNames, ownUserId } = props;
  return (
    <View>
      <ListHeader
        title="Threads"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all threads"
            hitSlop={8}
            onPress={props.onOpenThreads}
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
          return (
            <ThreadPreviewRow
              key={thread.id}
              thread={thread}
              author={
                thread.authorId === ownUserId
                  ? "You"
                  : (memberNames.get(thread.authorId) ?? "Member")
              }
              place={`${direct ? "" : "#"}${titles.get(thread.channelId) ?? "conversation"}`}
              onOpen={() => {
                props.onOpenThread(thread);
              }}
            />
          );
        })}
      </ListGroup>
    </View>
  );
}

interface ChannelSectionProps {
  readonly title: string;
  readonly rows: readonly ChannelView[];
  readonly titles: ReadonlyMap<string, string>;
  readonly activeChannelId: string | undefined;
  /** Present on the first section when the viewer may create channels. */
  readonly onCreateChannel?: (() => void) | undefined;
  readonly onOpenChannel: (channelId: string) => void;
  readonly onChannelActions: (channel: ChannelView) => void;
}

/** One category of text channels. */
function ChannelSection(props: ChannelSectionProps) {
  const { title, rows, titles, activeChannelId, onCreateChannel } = props;
  return (
    <View>
      <ListHeader
        title={title}
        action={
          onCreateChannel !== undefined ? (
            <RoundButton icon="plus" label="Create channel" onPress={onCreateChannel} />
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <Text size="sm" tone="muted" className="px-4 py-2">
          No channels yet. Create the first one.
        </Text>
      ) : (
        <ListGroup>
          {rows.map((entry) => (
            <ListRow
              key={entry.id}
              icon={channelIcon(entry)}
              title={titles.get(entry.id) ?? entry.name}
              subtitle={entry.topic ?? undefined}
              selected={entry.id === activeChannelId}
              trailing={<ChannelFlags channel={entry} />}
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
    </View>
  );
}

/** Text channels grouped the way the team organised them, uncategorised first. */
function channelSections(
  channels: readonly ChannelView[],
  categories: readonly CategoryView[],
  keepEmptyFirst: boolean,
) {
  const text = channels.filter((entry) => entry.kind === "text" || entry.kind === "announcement");
  const known = new Set(categories.map((category) => category.id));
  return [
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
  ].filter((section, index) => section.rows.length > 0 || (index === 0 && keepEmptyFirst));
}

interface HiddenToggleProps {
  readonly hiddenCount: number;
  readonly showHidden: boolean;
  readonly onToggle: () => void;
}

function HiddenToggle({ hiddenCount, showHidden, onToggle }: HiddenToggleProps) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onToggle}
      className="min-h-12 flex-row items-center justify-center gap-2 active:opacity-70"
    >
      <Icon name={showHidden ? "eye-off" : "eye"} size={16} color={palette["text-muted"]} />
      <Text size="sm" tone="muted">
        {showHidden
          ? "Hide hidden conversations"
          : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? "conversation" : "conversations"}`}
      </Text>
    </Pressable>
  );
}

interface WorkspaceHeadingProps extends HereNowProps {
  readonly name: string;
  /** The server's host, shown under the workspace name. */
  readonly host: string;
}

/** The workspace's name and server, then who is around. */
function WorkspaceHeading(props: WorkspaceHeadingProps) {
  const { name, host } = props;
  return (
    <View className="gap-3 pt-2">
      <View className="px-1">
        <Heading level={2} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {name}
        </Heading>
        <Text size="xs" tone="muted" mono numberOfLines={1}>
          {host}
        </Text>
      </View>
      <HereNow
        members={props.members}
        presence={props.presence}
        ownUserId={props.ownUserId}
        onMemberPress={props.onMemberPress}
      />
    </View>
  );
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

/** The hub's home tab: every channel in the workspace, grouped the way the team organised it. */
export function ChannelList(props: ChannelListProps) {
  const clearance = useDockClearance();
  const { channels, titles, ownUserId, presence, members, memberNames, threads } = props;
  const sections = channelSections(channels, props.categories, props.canManageChannels);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: clearance, gap: 18 }}
    >
      <WorkspaceHeading
        name={props.workspaceName}
        host={props.workspaceHost}
        members={members}
        presence={presence}
        ownUserId={ownUserId}
        onMemberPress={props.onMemberPress}
      />

      {threads !== undefined && threads.length > 0 && (
        <ThreadPreviews
          threads={threads}
          channels={channels}
          titles={titles}
          memberNames={memberNames}
          ownUserId={ownUserId}
          onOpenThread={props.onOpenThread}
          onOpenThreads={props.onOpenThreads}
        />
      )}

      {sections.map((section, index) => (
        <ChannelSection
          key={section.key}
          title={section.title}
          rows={section.rows}
          titles={titles}
          activeChannelId={props.activeChannelId}
          onCreateChannel={
            index === 0 && props.canManageChannels ? props.onCreateChannel : undefined
          }
          onOpenChannel={props.onOpenChannel}
          onChannelActions={props.onChannelActions}
        />
      ))}

      <VoiceChannelSection
        channels={channels}
        activeCalls={props.activeCalls}
        memberNames={memberNames}
        selfUserId={ownUserId}
        clientId={props.clientId}
        localCallId={props.localCallId}
        {...(props.remoteLevels !== undefined ? { remoteLevels: props.remoteLevels } : {})}
        onJoin={props.onJoinVoice}
      />

      {props.hiddenCount > 0 && (
        <HiddenToggle
          hiddenCount={props.hiddenCount}
          showHidden={props.showHidden}
          onToggle={props.onToggleHidden}
        />
      )}
    </ScrollView>
  );
}
