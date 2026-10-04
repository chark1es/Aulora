/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { kanbanDuration } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import {
  type Board,
  type BoardMember,
  type Card,
  dueLabel,
  priorityInfo,
  shortDuration,
  trackedTime,
} from "../../lib/kanban";
import { AvatarStack, LabelChip, PriorityFlag, useNow, usePriorityColor } from "./parts";

interface MetaProps {
  readonly icon: IconName;
  readonly text: string;
  readonly color: string;
  readonly label: string;
}

function Meta({ icon, text, color, label }: MetaProps) {
  return (
    <View accessible accessibilityLabel={label} className="flex-row items-center gap-1">
      <Icon name={icon} size={14} color={color} />
      <Text size="xs" style={{ color, fontVariant: ["tabular-nums"] }}>
        {text}
      </Text>
    </View>
  );
}

function PriorityMeta({ card }: { readonly card: Card }) {
  const color = usePriorityColor(card.priority);
  if (card.priority === "none") return null;
  return (
    <View className="flex-row items-center gap-1">
      <PriorityFlag priority={card.priority} size={14} />
      <Text size="xs" style={{ color }}>
        {priorityInfo(card.priority).label}
      </Text>
    </View>
  );
}

/** The timer keeps its own clock, so only a running card re-renders each second. */
function TimerMeta({ card }: { readonly card: Card }) {
  const palette = usePalette();
  const running = card.timerStartedAt !== undefined;
  const tracked = trackedTime(card, useNow(running));
  if (tracked <= 0 && !running) return null;
  return (
    <Meta
      icon="timer"
      text={running ? kanbanDuration(tracked) : shortDuration(tracked)}
      label={running ? "Timer running" : "Time tracked"}
      color={running ? palette.accent : palette["text-muted"]}
    />
  );
}

function DueMeta({ card, now }: { readonly card: Card; readonly now: number }) {
  const palette = usePalette();
  if (card.dueAt === undefined) return null;
  const due = dueLabel(card.dueAt, now);
  return (
    <Meta
      icon="calendar"
      text={due.text}
      label={due.overdue ? `Overdue, due ${due.text}` : `Due ${due.text}`}
      color={due.overdue && !card.archived ? palette.danger : palette["text-muted"]}
    />
  );
}

/** The small facts under a card's title. */
function CardMeta({ card, now }: { readonly card: Card; readonly now: number }) {
  const palette = usePalette();
  const muted = palette["text-muted"];
  const total = card.checklist.length;
  const done = card.checklist.filter((item) => item.done).length;
  return (
    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
      <PriorityMeta card={card} />
      <DueMeta card={card} now={now} />
      {total > 0 && (
        <Meta
          icon="checklist"
          text={`${done}/${total}`}
          label={`${done} of ${total} checklist items done`}
          color={done === total ? palette.secondary : muted}
        />
      )}
      {card.fileIds.length > 0 && (
        <Meta
          icon="paperclip"
          text={String(card.fileIds.length)}
          label={`${card.fileIds.length} attachments`}
          color={muted}
        />
      )}
      {card.githubLinks.length > 0 && (
        <Meta
          icon="link"
          text={String(card.githubLinks.length)}
          label={`${card.githubLinks.length} GitHub links`}
          color={muted}
        />
      )}
      <TimerMeta card={card} />
    </View>
  );
}

function hasFooter(card: Card): boolean {
  return (
    card.priority !== "none" ||
    card.dueAt !== undefined ||
    card.checklist.length > 0 ||
    card.fileIds.length > 0 ||
    card.githubLinks.length > 0 ||
    card.trackedMs > 0 ||
    card.timerStartedAt !== undefined ||
    card.assigneeIds.length > 0
  );
}

export interface CardTileProps {
  readonly card: Card;
  readonly board: Board;
  readonly members: readonly BoardMember[];
  /** Coarse clock for due dates; a running timer keeps its own. */
  readonly now: number;
  readonly index: number;
  /** Cards stagger in when a board first shows, and simply fade in later. */
  readonly firstPaint: boolean;
  readonly onOpen: (card: Card) => void;
  readonly onMenu: (card: Card) => void;
}

/**
 * One card on the board. A tap opens it; a long press, or the trailing
 * button, offers everything a right-click does on the web.
 */
export const CardTile = memo(function CardTile(props: CardTileProps) {
  const { card, board, onOpen, onMenu } = props;
  const palette = usePalette();
  const labels = board.labels.filter((label) => card.labelIds.includes(label.id));
  const entering = props.firstPaint
    ? FadeInDown.duration(240).delay(Math.min(props.index * 24, 200))
    : FadeIn.duration(180);
  return (
    <Animated.View
      entering={entering}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(240)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open card ${card.title}`}
        accessibilityHint="Long press for card actions"
        delayLongPress={280}
        onPress={() => {
          onOpen(card);
        }}
        onLongPress={() => {
          onMenu(card);
        }}
        className="gap-2 rounded-input border border-border bg-surface-1 p-3 active:opacity-80"
      >
        {labels.length > 0 && (
          <View className="flex-row flex-wrap gap-1 pr-8">
            {labels.map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))}
          </View>
        )}
        <Text size="sm" className={`font-medium leading-5 ${labels.length > 0 ? "" : "pr-8"}`}>
          {card.title}
        </Text>
        {hasFooter(card) && (
          <View className="flex-row items-end gap-2">
            <CardMeta card={card} now={props.now} />
            <AvatarStack userIds={card.assigneeIds} members={props.members} />
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${card.title}`}
        hitSlop={8}
        onPress={() => {
          onMenu(card);
        }}
        className="absolute right-1 top-1 h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
      >
        <Icon name="more-horizontal" size={18} color={palette["text-muted"]} />
      </Pressable>
    </Animated.View>
  );
});
