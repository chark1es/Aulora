/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, IconButton, Text, usePalette } from "@aulora/ui-native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated";
import { type Board, type Card, type Column, cardsInColumn, isColumnFull } from "../../lib/kanban";
import { CardTile } from "./CardTile";
import type { BoardController } from "./use-board";

function emptyText(ctl: BoardController): string {
  if (ctl.filtering) return "No matching cards";
  if (ctl.archivedCards) return "No archived cards";
  return ctl.canArrange ? "No cards yet. Add the first one below." : "No cards yet";
}

interface ColumnHeaderProps {
  readonly column: Column;
  readonly count: number;
  readonly full: boolean;
  /** Absent when the viewer cannot add cards. */
  readonly onAdd?: (() => void) | undefined;
}

function ColumnHeader({ column, count, full, onAdd }: ColumnHeaderProps) {
  const palette = usePalette();
  const limit = column.wipLimit === undefined ? "" : ` / ${column.wipLimit}`;
  return (
    <View className="min-h-12 flex-row items-center gap-2 pl-4 pr-1">
      <Text className="shrink font-semibold" numberOfLines={1}>
        {column.name}
      </Text>
      <View
        className="rounded-pill px-2 py-0.5"
        style={{ backgroundColor: full ? `${palette.danger}26` : palette["surface-3"] }}
      >
        <Text
          size="xs"
          className="font-medium"
          style={{
            color: full ? palette.danger : palette["text-muted"],
            fontVariant: ["tabular-nums"],
          }}
        >
          {count}
          {limit}
        </Text>
      </View>
      <View className="flex-1" />
      {onAdd !== undefined && (
        <IconButton label={`Add card to ${column.name}`} size="sm" disabled={full} onPress={onAdd}>
          <Icon name="plus" size={20} color={palette["text-muted"]} />
        </IconButton>
      )}
    </View>
  );
}

export interface BoardColumnProps {
  readonly ctl: BoardController;
  readonly board: Board;
  readonly column: Column;
  readonly width: number;
  readonly now: number;
  readonly onOpen: (card: Card) => void;
  readonly onMenu: (card: Card) => void;
}

/** One column: its cards in order, and the composer for a new one. */
export function BoardColumn(props: BoardColumnProps) {
  const { ctl, board, column } = props;
  const list = useRef<ScrollView | null>(null);
  const cards = cardsInColumn(ctl.filtered, column.id);
  const full = isColumnFull(column, ctl.cards ?? []);
  const composing = ctl.composing === column.id;
  const compose = () => {
    ctl.setComposing(column.id);
  };
  const create = async (title: string) => {
    const saved = await ctl.run(() =>
      ctl.mutations.createCard({ boardId: board.id, columnId: column.id, title }),
    );
    if (saved) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 120);
    return saved;
  };
  return (
    <View
      accessibilityLabel={`${column.name} column`}
      className="rounded-card bg-surface-2"
      style={{ width: props.width }}
    >
      <ColumnHeader
        column={column}
        count={cards.length}
        full={full}
        onAdd={ctl.canArrange ? compose : undefined}
      />
      <ScrollView
        ref={list}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 8, paddingBottom: 8 }}
      >
        {cards.map((card, index) => (
          <CardTile
            key={card._id}
            card={card}
            board={board}
            members={ctl.members}
            now={props.now}
            index={index}
            firstPaint={ctl.firstPaint}
            onOpen={props.onOpen}
            onMenu={props.onMenu}
          />
        ))}
        {cards.length === 0 && !composing && (
          <Animated.View
            entering={FadeIn.duration(200)}
            layout={LinearTransition.duration(240)}
            className="rounded-input border border-dashed border-border px-3 py-6"
          >
            <Text size="sm" tone="muted" className="text-center">
              {emptyText(ctl)}
            </Text>
          </Animated.View>
        )}
      </ScrollView>
      {ctl.canArrange && (
        <NewCard
          columnName={column.name}
          full={full}
          open={composing}
          onOpen={compose}
          onClose={() => {
            ctl.setComposing(undefined);
          }}
          onCreate={create}
        />
      )}
    </View>
  );
}

interface NewCardProps {
  readonly columnName: string;
  readonly full: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onCreate: (title: string) => Promise<boolean>;
}

/** The closed composer: a row that opens it, or says the column is full. */
function AddCardRow({ full, onOpen }: Pick<NewCardProps, "full" | "onOpen">) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: full }}
      disabled={full}
      onPress={onOpen}
      className={`mx-2 mb-2 min-h-11 flex-row items-center gap-2 rounded-input px-2 active:bg-surface-3 ${
        full ? "opacity-60" : ""
      }`}
    >
      {!full && <Icon name="plus" size={18} color={palette["text-muted"]} />}
      <Text size="sm" tone="muted">
        {full ? "Column limit reached" : "Add card"}
      </Text>
    </Pressable>
  );
}

/** Stays open after a save so several cards can be added in a row. */
function NewCard(props: NewCardProps) {
  const palette = usePalette();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  if (!props.open || props.full) return <AddCardRow full={props.full} onOpen={props.onOpen} />;
  const submit = () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    void props.onCreate(title).then((saved) => {
      setSaving(false);
      if (saved) setTitle("");
    });
  };
  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      className="mx-2 mb-2 gap-2 rounded-input border border-accent bg-surface-1 p-2.5"
    >
      <TextInput
        autoFocus
        accessibilityLabel={`New card in ${props.columnName}`}
        placeholder="What needs to be done?"
        placeholderTextColor={palette["text-muted"]}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={submit}
        className="min-h-10 text-[15px] font-medium text-text"
      />
      <View className="flex-row items-center gap-2">
        <Button size="sm" disabled={!title.trim()} loading={saving} onPress={submit}>
          Add card
        </Button>
        <Button size="sm" variant="ghost" onPress={props.onClose}>
          Cancel
        </Button>
      </View>
    </Animated.View>
  );
}
