/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { KanbanBoardContent } from "@aulora/core";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { type Column, newItemId } from "../../lib/kanban";
import { cell, Group, RowButton } from "./settings-parts";
import { BottomSheet, useSheetClose } from "./sheets";

const LABEL_COLORS = [
  "#E5484D",
  "#E4571C",
  "#E8A33B",
  "#46A758",
  "#12A594",
  "#3E63DD",
  "#8E4EC6",
  "#D6409F",
  "#8B8D98",
];

interface EditorProps {
  readonly draft: KanbanBoardContent;
  readonly onChange: (draft: KanbanBoardContent) => void;
}

/** The list with the items at two places exchanged. */
function swapped<T>(items: readonly T[], index: number, other: number): T[] {
  const first = items.at(index);
  const second = items.at(other);
  if (first === undefined || second === undefined) return [...items];
  return items.map((item, place) => {
    if (place === index) return second;
    return place === other ? first : item;
  });
}

function withLimit(column: Column, text: string): Column {
  const limit = Number(text.replace(/\D/g, ""));
  const base = { id: column.id, name: column.name };
  return limit > 0 ? { ...base, wipLimit: Math.min(limit, 500) } : base;
}

interface ColumnRowProps extends EditorProps {
  readonly column: Column;
  readonly index: number;
}

function ColumnRow({ draft, onChange, column, index }: ColumnRowProps) {
  const replace = (next: Column) => {
    onChange({
      ...draft,
      columns: draft.columns.map((entry) => (entry.id === column.id ? next : entry)),
    });
  };
  const move = (by: number) => {
    onChange({ ...draft, columns: swapped(draft.columns, index, index + by) });
  };
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(220)}
      className="flex-row items-center gap-1.5"
    >
      <TextInput
        accessibilityLabel={`Column ${index + 1} name`}
        maxLength={80}
        value={column.name}
        onChangeText={(name) => {
          replace({ ...column, name });
        }}
        className={`flex-1 ${cell}`}
      />
      <TextInput
        accessibilityLabel={`Limit for ${column.name}`}
        keyboardType="number-pad"
        placeholder="Limit"
        maxLength={3}
        value={column.wipLimit === undefined ? "" : String(column.wipLimit)}
        onChangeText={(text) => {
          replace(withLimit(column, text));
        }}
        className={`w-[68px] text-center ${cell}`}
      />
      <RowButton
        label={`Move ${column.name} column up`}
        icon="arrow-up"
        disabled={index === 0}
        onPress={() => {
          move(-1);
        }}
      />
      <RowButton
        label={`Move ${column.name} column down`}
        icon="arrow-down"
        disabled={index === draft.columns.length - 1}
        onPress={() => {
          move(1);
        }}
      />
      <RowButton
        label={`Remove ${column.name} column`}
        icon="trash"
        disabled={draft.columns.length === 1}
        onPress={() => {
          onChange({ ...draft, columns: draft.columns.filter((entry) => entry.id !== column.id) });
        }}
      />
    </Animated.View>
  );
}

/** Rename, reorder, limit, add and remove the board's columns. */
export function ColumnsEditor({ draft, onChange }: EditorProps) {
  return (
    <Group title="Columns and limits">
      <Text size="xs" tone="muted">
        A limit caps how many active cards a column takes. Move every card out of a column before
        removing it.
      </Text>
      {draft.columns.map((column, index) => (
        <ColumnRow
          key={column.id}
          draft={draft}
          onChange={onChange}
          column={column}
          index={index}
        />
      ))}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={draft.columns.length >= 20}
        onPress={() => {
          onChange({
            ...draft,
            columns: [...draft.columns, { id: newItemId(), name: "New column" }],
          });
        }}
      >
        Add column
      </Button>
    </Group>
  );
}

type Label = KanbanBoardContent["labels"][number];

interface LabelRowProps extends EditorProps {
  readonly label: Label;
  readonly onPickColor: () => void;
}

function LabelRow({ draft, onChange, label, onPickColor }: LabelRowProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(220)}
      className="flex-row items-center gap-1.5"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Color for ${label.name}`}
        className="h-11 w-11 items-center justify-center rounded-input border border-border bg-surface-3 active:opacity-70"
        onPress={onPickColor}
      >
        <View className="h-5 w-5 rounded-pill" style={{ backgroundColor: label.color }} />
      </Pressable>
      <TextInput
        accessibilityLabel="Label name"
        maxLength={50}
        value={label.name}
        onChangeText={(name) => {
          onChange({
            ...draft,
            labels: draft.labels.map((entry) =>
              entry.id === label.id ? { ...entry, name } : entry,
            ),
          });
        }}
        className={`flex-1 ${cell}`}
      />
      <RowButton
        label={`Remove ${label.name} label`}
        icon="trash"
        onPress={() => {
          onChange({ ...draft, labels: draft.labels.filter((entry) => entry.id !== label.id) });
        }}
      />
    </Animated.View>
  );
}

/** Rename, recolour, add and remove the board's labels. */
export function LabelsEditor({ draft, onChange }: EditorProps) {
  const [coloring, setColoring] = useState<string | undefined>();
  const target = draft.labels.find((label) => label.id === coloring);
  return (
    <Group title="Labels">
      {draft.labels.map((label) => (
        <LabelRow
          key={label.id}
          draft={draft}
          onChange={onChange}
          label={label}
          onPickColor={() => {
            setColoring(label.id);
          }}
        />
      ))}
      {draft.labels.length === 0 && (
        <Text size="sm" tone="muted">
          No labels yet.
        </Text>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={draft.labels.length >= 50}
        onPress={() => {
          const color = LABEL_COLORS.at(draft.labels.length % LABEL_COLORS.length) ?? "#E4571C";
          onChange({
            ...draft,
            labels: [...draft.labels, { id: newItemId(), name: "New label", color }],
          });
        }}
      >
        Add label
      </Button>
      {target !== undefined && (
        <ColorSheet
          current={target.color}
          onClose={() => {
            setColoring(undefined);
          }}
          onPick={(color) => {
            onChange({
              ...draft,
              labels: draft.labels.map((entry) =>
                entry.id === target.id ? { ...entry, color } : entry,
              ),
            });
          }}
        />
      )}
    </Group>
  );
}

interface ColorSheetProps {
  readonly current: string;
  readonly onPick: (color: string) => void;
  readonly onClose: () => void;
}

function ColorSheet({ current, onPick, onClose }: ColorSheetProps) {
  return (
    <BottomSheet title="Label color" onClose={onClose}>
      <View className="flex-row flex-wrap gap-3 px-5 pb-3">
        {LABEL_COLORS.map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            selected={current.toLowerCase() === color.toLowerCase()}
            onPick={onPick}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

interface ColorSwatchProps {
  readonly color: string;
  readonly selected: boolean;
  readonly onPick: (color: string) => void;
}

function ColorSwatch({ color, selected, onPick }: ColorSwatchProps) {
  const palette = usePalette();
  const close = useSheetClose();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Color ${color}`}
      accessibilityState={{ checked: selected }}
      className="h-12 w-12 items-center justify-center rounded-pill active:opacity-70"
      style={{ backgroundColor: color }}
      onPress={() => {
        close(() => {
          onPick(color);
        });
      }}
    >
      {selected && <Icon name="check" size={22} color={palette["on-accent"]} />}
    </Pressable>
  );
}
