import type { IconName } from "@aulora/tokens";
import { Button, Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { type Board, NO_FILTERS } from "../../lib/kanban";
import { HorizontalScroll } from "../chat/SwipePanes";
import { AvatarStack } from "./parts";
import { SearchField } from "./sheets";
import type { BoardController, OpenSheet } from "./use-board";

interface FilterChipProps {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number;
  readonly onPress: () => void;
}

function FilterChip({ icon, label, count, onPress }: FilterChipProps) {
  const palette = usePalette();
  const active = count > 0;
  const hint = active ? `, ${count} selected` : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label.toLowerCase()}${hint}`}
      onPress={onPress}
      className={`min-h-9 flex-row items-center gap-1.5 rounded-pill border px-3 active:opacity-70 ${
        active ? "border-accent bg-accent-soft" : "border-border bg-surface-2"
      }`}
    >
      <Icon name={icon} size={16} color={active ? palette.text : palette["text-muted"]} />
      <Text size="sm" tone={active ? "default" : "muted"}>
        {label}
      </Text>
      {active && (
        <Animated.View
          entering={FadeIn.duration(160)}
          className="h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1"
        >
          <Text className="text-[11px] font-bold" style={{ color: palette["on-accent"] }}>
            {count}
          </Text>
        </Animated.View>
      )}
      <Icon name="chevron-down" size={14} color={palette["text-muted"]} />
    </Pressable>
  );
}

function cardCount(ctl: BoardController): string {
  const total = ctl.inView.length;
  const shown = ctl.filtering ? `${ctl.filtered.length} of ${total}` : String(total);
  if (ctl.archivedCards) return `${shown} archived`;
  return `${shown} ${total === 1 ? "card" : "cards"}`;
}

/** The search field and the three checklist filters, as on the web toolbar. */
export function BoardFilters({
  ctl,
  board,
}: {
  readonly ctl: BoardController;
  readonly board: Board;
}) {
  const { filters } = ctl;
  const openSheet = (kind: OpenSheet["kind"] & ("assignees" | "labels" | "priorities")) => {
    ctl.setOpen({ kind });
  };
  return (
    <>
      {ctl.searching && (
        <Animated.View entering={FadeInDown.duration(180)} className="pt-2">
          <SearchField
            label="Search cards"
            value={filters.search}
            onChange={(search) => {
              ctl.setFilters({ ...filters, search });
            }}
          />
        </Animated.View>
      )}
      <View className="border-b border-border">
        <HorizontalScroll
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
            alignItems: "center",
          }}
        >
          <FilterChip
            icon="users"
            label="Assignee"
            count={filters.assignees.length}
            onPress={() => {
              openSheet("assignees");
            }}
          />
          <FilterChip
            icon="label"
            label="Label"
            count={filters.labels.length}
            onPress={() => {
              openSheet("labels");
            }}
          />
          <FilterChip
            icon="flag"
            label="Priority"
            count={filters.priorities.length}
            onPress={() => {
              openSheet("priorities");
            }}
          />
          {ctl.filtering && (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
              <Pressable
                accessibilityRole="button"
                className="min-h-9 justify-center px-2 active:opacity-60"
                onPress={() => {
                  ctl.setFilters(NO_FILTERS);
                }}
              >
                <Text size="sm" tone="accent">
                  Clear
                </Text>
              </Pressable>
            </Animated.View>
          )}
          <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
            {cardCount(ctl)}
          </Text>
          {board.private && <AvatarStack userIds={board.memberIds} members={ctl.members} max={4} />}
        </HorizontalScroll>
      </View>
    </>
  );
}

/** Says why the board cannot be changed, with the way back. */
export function ArchivedBanner({
  ctl,
  board,
}: {
  readonly ctl: BoardController;
  readonly board: Board;
}) {
  const palette = usePalette();
  if (!board.archived && !ctl.archivedCards) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      className="flex-row items-center gap-3 border-b border-border bg-surface-2 px-4 py-2"
    >
      <Icon name="archive" size={16} color={palette["text-muted"]} />
      <Text size="sm" tone="muted" className="flex-1">
        {board.archived
          ? "This board is archived. Restore it to make changes."
          : "Showing archived cards. Open or long-press a card to restore it."}
      </Text>
      {board.archived && ctl.canManage && (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            void ctl.run(() => ctl.mutations.archiveBoard({ boardId: board.id, archived: false }));
          }}
        >
          Restore
        </Button>
      )}
      {!board.archived && (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            ctl.setArchivedCards(false);
          }}
        >
          Active
        </Button>
      )}
    </Animated.View>
  );
}
