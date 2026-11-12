import type { ChannelSummary } from "@aulora/core";
import { channelOpening, conversationOpening } from "@aulora/core";
import { Heading, Icon, Text, usePalette } from "@aulora/ui-native";
import { Animated, Pressable, View } from "react-native";
import { useEntrance, useReduceMotion } from "../../lib/use-entrance";
import { GroupAvatar } from "./GroupAvatar";
import { MemberAvatar } from "./MemberAvatar";
import { PresenceAvatar } from "./PresenceAvatar";

export interface ConversationOpeningProps {
  readonly channel: Pick<ChannelSummary, "kind" | "memberIds">;
  readonly title: string;
  readonly ownUserId: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly partnerStatus?: string | undefined;
  /** Whether the viewer may post here. */
  readonly canSend: boolean;
  /** Whether the viewer may start a voice call here. */
  readonly canStartCall: boolean;
  /** Places a first-message suggestion in the composer. */
  readonly onSayHi: (text: string) => void;
  readonly onStartCall: () => void;
}

const AVATAR_SIZE = 64;

/** One quiet quick action under the opening copy. */
function OpeningAction({
  icon,
  label,
  onPress,
}: {
  readonly icon: "message" | "phone";
  readonly label: string;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-1.5 rounded-pill border border-border bg-surface-2 px-4 active:bg-surface-3"
    >
      <Icon name={icon} size={16} color={palette.accent} />
      <Text size="sm" className="font-medium">
        {label}
      </Text>
    </Pressable>
  );
}

/** The opening of a channel nobody has posted in yet. */
function ChannelOpening({
  kind,
  title,
}: {
  readonly kind: ChannelSummary["kind"];
  readonly title: string;
}) {
  const palette = usePalette();
  const announcement = kind === "announcement";
  const voice = kind === "voice";
  const icon = voice ? "volume" : announcement ? "megaphone" : "hash";
  const opening = channelOpening(kind, title);
  return (
    <>
      <Icon name={icon} size={22} color={palette["text-muted"]} />
      <Heading level={2} className="mt-2" accessibilityRole="header">
        {opening.heading}
      </Heading>
      <Text size="sm" tone="muted" className="mt-1 leading-6">
        {opening.body}
      </Text>
    </>
  );
}

/** The shared avatar for a direct, group or notes-to-self opening. */
function OpeningAvatar({
  partnerId,
  partnerStatus,
  otherIds,
  ownUserId,
}: {
  readonly partnerId: string | undefined;
  readonly partnerStatus: string | undefined;
  readonly otherIds: readonly string[];
  readonly ownUserId: string;
}) {
  const palette = usePalette();
  if (otherIds.length > 0) {
    return <GroupAvatar userIds={otherIds} size={AVATAR_SIZE} surface={palette.bg} />;
  }
  if (partnerId !== undefined && partnerStatus !== undefined) {
    return (
      <PresenceAvatar
        userId={partnerId}
        status={partnerStatus}
        size={AVATAR_SIZE}
        surface={palette.bg}
      />
    );
  }
  return <MemberAvatar userId={partnerId ?? ownUserId} size={AVATAR_SIZE} />;
}

/** The opening of a direct, group or notes-to-self conversation. */
function DirectOpening(props: ConversationOpeningProps) {
  const opening = conversationOpening({
    channel: props.channel,
    title: props.title,
    ownUserId: props.ownUserId,
    memberNames: props.memberNames,
    partnerStatus: props.partnerStatus,
    canSend: props.canSend,
    canStartCall: props.canStartCall,
  });
  const sayHi = opening.sayHi;

  return (
    <>
      <View className="flex-row items-start gap-4">
        <OpeningAvatar
          partnerId={opening.partnerId}
          partnerStatus={props.partnerStatus}
          otherIds={opening.isGroup ? opening.otherIds : []}
          ownUserId={props.ownUserId}
        />
        <View className="min-w-0 flex-1 pt-1">
          <Heading
            level={2}
            numberOfLines={3}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.4}
          >
            {props.title}
          </Heading>
        </View>
      </View>
      <Text size="sm" tone="muted" className="mt-5 leading-6" maxFontSizeMultiplier={1.6}>
        {opening.body}
      </Text>
      {opening.showActions && (
        <View className="mt-5 flex-row flex-wrap items-center gap-2">
          {sayHi !== null && (
            <OpeningAction
              icon="message"
              label="Say hi"
              onPress={() => {
                props.onSayHi(sayHi);
              }}
            />
          )}
          {sayHi === null && props.canStartCall && (
            <OpeningAction icon="phone" label="Start a call" onPress={props.onStartCall} />
          )}
        </View>
      )}
    </>
  );
}

/**
 * The first thing a fresh conversation shows: the people in it, how they relate
 * to the viewer, and a helpful first action — never a generic "nothing here"
 * line. The copy and actions follow web; the layout keeps its reading edge.
 */
export function ConversationOpening(props: ConversationOpeningProps) {
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  const isConversation = props.channel.kind === "dm" || props.channel.kind === "group_dm";
  return (
    <View className="flex-1 justify-center px-6 py-10 min-w-0">
      <Animated.View style={animatedStyle}>
        <View className="w-full max-w-[520px]">
          {isConversation ? (
            <DirectOpening {...props} />
          ) : (
            <ChannelOpening kind={props.channel.kind} title={props.title} />
          )}
        </View>
      </Animated.View>
    </View>
  );
}
