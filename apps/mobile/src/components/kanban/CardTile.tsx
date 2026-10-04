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
  PRIORITY,
  shortDuration,
  trackedTime,
} from "../../lib/kanban";
import { AvatarStack, LabelChip, PriorityFlag, useNow, usePriorityColor } from "./parts";

function Meta({
  icon,
  text,
  color,
  label,
}: {
  readonly icon: IconName;
  readonly text: string;
  readonly color: string;
  readonly label: string;
}) {
  return (
    <View accessible accessibilityLabel={label} className="flex-row items-center gap-1">
      <Icon name={icon} size={14} color={color} />
      <Text size="xs" style={{ color, fontVariant: ["tabular-nums"] }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * One card on the board. A tap opens it; a long press, or the trailing
 * button, offers everything a right-click does on the web.
 */
export const CardTile = memo(function CardTile({
  card,
  board,
  members,
  now,
  index,
  firstPaint,
  onOpen,
  onMenu,
}: {
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
}) {
  const palette = usePalette();
  const muted = palette["text-muted"];
  const running = card.timerStartedAt !== undefined;
  const tracked = trackedTime(card, useNow(running));
  const done = card.checklist.filter((item) => item.done).length;
  const due = card.dueAt === undefined ? null : dueLabel(card.dueAt, now);
  const priorityColor = usePriorityColor(card.priority);
  const labels = board.labels.filter((label) => card.labelIds.includes(label.id));
  const hasMeta =
    card.priority !== "none" ||
    due !== null ||
    card.checklist.length > 0 ||
    card.fileIds.length > 0 ||
    card.githubLinks.length > 0 ||
    tracked > 0 ||
    running;
  return (
    <Animated.View
      entering={
        firstPaint
          ? FadeInDown.duration(240).delay(Math.min(index * 24, 200))
          : FadeIn.duration(180)
      }
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(240)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open card ${card.title}`}
        accessibilityHint="Long press for card actions"
        delayLongPress={280}
        onPress={() => onOpen(card)}
        onLongPress={() => onMenu(card)}
        className="gap-2 rounded-input border border-border bg-surface-1 p-3 active:opacity-80"
      >
        {labels.length > 0 && (
          <View className="flex-row flex-wrap gap-1 pr-8">
            {labels.map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))}
          </View>
        )}
        <Text size="sm" className={`font-medium leading-5 ${labels.length ? "" : "pr-8"}`}>
          {card.title}
        </Text>
        {(hasMeta || card.assigneeIds.length > 0) && (
          <View className="flex-row items-end gap-2">
            <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {card.priority !== "none" && (
                <View className="flex-row items-center gap-1">
                  <PriorityFlag priority={card.priority} size={14} />
                  <Text size="xs" style={{ color: priorityColor }}>
                    {PRIORITY[card.priority].label}
                  </Text>
                </View>
              )}
              {due !== null && (
                <Meta
                  icon="calendar"
                  text={due.text}
                  label={due.overdue ? `Overdue, due ${due.text}` : `Due ${due.text}`}
                  color={due.overdue && !card.archived ? palette.danger : muted}
                />
              )}
              {card.checklist.length > 0 && (
                <Meta
                  icon="checklist"
                  text={`${done}/${card.checklist.length}`}
                  label={`${done} of ${card.checklist.length} checklist items done`}
                  color={done === card.checklist.length ? palette.secondary : muted}
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
              {(tracked > 0 || running) && (
                <Meta
                  icon="timer"
                  text={running ? kanbanDuration(tracked) : shortDuration(tracked)}
                  label={running ? "Timer running" : "Time tracked"}
                  color={running ? palette.accent : muted}
                />
              )}
            </View>
            <AvatarStack userIds={card.assigneeIds} members={members} />
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${card.title}`}
        hitSlop={8}
        onPress={() => onMenu(card)}
        className="absolute right-1 top-1 h-9 w-9 items-center justify-center rounded-input active:bg-surface-3"
      >
        <Icon name="more-horizontal" size={18} color={muted} />
      </Pressable>
    </Animated.View>
  );
});
