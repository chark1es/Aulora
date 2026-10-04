/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon, Text, usePalette } from "@aulora/ui-native";
import { memo, useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { formatDay, localDay, monthGrid, monthName } from "../../lib/kanban";
import { BottomSheet, useSheetClose } from "./sheets";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORTCUTS = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "In a week", offset: 7 },
];

/** Picks a calendar day: shortcuts for the common answers, a month for the rest. */
export function DateSheet({
  title,
  value,
  now,
  onChange,
  onClose,
}: {
  readonly title: string;
  /** `YYYY-MM-DD`, or empty when no day is set. */
  readonly value: string;
  readonly now: number;
  readonly onChange: (day: string) => void;
  readonly onClose: () => void;
}) {
  const today = localDay(now);
  const [shown, setShown] = useState(() => (value || today).slice(0, 7));
  const latest = useRef(onChange);
  latest.current = onChange;
  const pick = useCallback((day: string) => {
    latest.current(day);
  }, []);
  return (
    <BottomSheet title={title} onClose={onClose}>
      <View className="gap-3 px-4 pb-2">
        <View className="flex-row flex-wrap gap-2">
          {SHORTCUTS.map((entry) => (
            <DayShortcut
              key={entry.label}
              label={entry.label}
              day={localDay(now, entry.offset)}
              onPick={pick}
            />
          ))}
          {value !== "" && <DayShortcut label="No date" day="" onPick={pick} />}
        </View>
        <MonthHeader shown={shown} onShow={setShown} />
        <View className="flex-row">
          {WEEKDAYS.map((day) => (
            <Text key={day} size="xs" tone="muted" className="flex-1 text-center">
              {day.slice(0, 1)}
            </Text>
          ))}
        </View>
        <View className="flex-row flex-wrap">
          {monthGrid(Number(shown.slice(0, 4)), Number(shown.slice(5, 7)) - 1).map((day) => (
            <DayCell
              key={day}
              day={day}
              outside={day.slice(0, 7) !== shown}
              today={day === today}
              selected={day === value}
              onPick={pick}
            />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

/** The month's name between buttons that step to the months around it. */
function MonthHeader({
  shown,
  onShow,
}: {
  /** `YYYY-MM`. */
  readonly shown: string;
  readonly onShow: (month: string) => void;
}) {
  const year = Number(shown.slice(0, 4));
  const month = Number(shown.slice(5, 7)) - 1;
  const step = (by: number) => {
    onShow(new Date(Date.UTC(year, month + by, 1)).toISOString().slice(0, 7));
  };
  return (
    <View className="flex-row items-center">
      <MonthStep
        label="Previous month"
        icon="chevron-left"
        onPress={() => {
          step(-1);
        }}
      />
      <Text className="flex-1 text-center font-semibold">
        {monthName(month)} {year}
      </Text>
      <MonthStep
        label="Next month"
        icon="chevron-right"
        onPress={() => {
          step(1);
        }}
      />
    </View>
  );
}

function MonthStep({
  label,
  icon,
  onPress,
}: {
  readonly label: string;
  readonly icon: "chevron-left" | "chevron-right";
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-input active:bg-surface-3"
      onPress={onPress}
    >
      <Icon name={icon} size={20} color={palette.text} />
    </Pressable>
  );
}

function DayShortcut({
  label,
  day,
  onPick,
}: {
  readonly label: string;
  readonly day: string;
  readonly onPick: (day: string) => void;
}) {
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-10 justify-center rounded-pill border border-border bg-surface-3 px-4 active:opacity-70"
      onPress={() => {
        close(() => {
          onPick(day);
        });
      }}
    >
      <Text size="sm">{label}</Text>
    </Pressable>
  );
}

const DayCell = memo(function DayCell({
  day,
  outside,
  today,
  selected,
  onPick,
}: {
  readonly day: string;
  readonly outside: boolean;
  readonly today: boolean;
  readonly selected: boolean;
  readonly onPick: (day: string) => void;
}) {
  const palette = usePalette();
  const close = useSheetClose();
  const ring = selected ? "bg-accent" : today ? "border border-accent" : "";
  const color = selected ? palette["on-accent"] : outside ? palette["text-muted"] : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatDay(day)}
      accessibilityState={{ selected }}
      className="h-11 w-[14.28%] items-center justify-center"
      onPress={() => {
        close(() => {
          onPick(day);
        });
      }}
    >
      <View className={`h-9 w-9 items-center justify-center rounded-pill ${ring}`}>
        <Text size="sm" style={{ color, opacity: outside && !selected ? 0.5 : 1 }}>
          {Number(day.slice(8))}
        </Text>
      </View>
    </Pressable>
  );
});
