import { Button, Heading, Icon, IconButton, Spinner, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import type { BoardController } from "./use-board";

/** The board's name, which opens the switcher, with search and the board menu. */
export function BoardHeader({ ctl }: { readonly ctl: BoardController }) {
  const palette = usePalette();
  const { board, searching, filters } = ctl;
  const title = board?.name ?? (ctl.archivedBoards ? "Archived boards" : "Kanban");
  return (
    <View className="flex-row items-center gap-1 border-b border-border px-3 py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={board ? `${board.name}, switch board` : "Switch board"}
        className="min-h-12 min-w-0 flex-1 flex-row items-center gap-2 rounded-input px-2 active:bg-surface-3"
        onPress={() => {
          ctl.setOpen({ kind: "boards" });
        }}
      >
        <Icon name="kanban" size={20} color={palette.accent} />
        <Heading level={3} className="shrink" numberOfLines={1} maxFontSizeMultiplier={1.5}>
          {title}
        </Heading>
        {board?.private === true && <Icon name="lock" size={14} color={palette["text-muted"]} />}
        <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
      </Pressable>
      {board !== undefined && (
        <>
          <IconButton
            label={searching ? "Close search" : "Search cards"}
            size="sm"
            onPress={() => {
              if (searching) ctl.setFilters({ ...filters, search: "" });
              ctl.setSearching(!searching);
            }}
          >
            <Icon
              name={searching ? "x" : "search"}
              size={20}
              color={filters.search.trim() ? palette.accent : palette.text}
            />
          </IconButton>
          <IconButton
            label="Board actions"
            size="sm"
            onPress={() => {
              ctl.setOpen({ kind: "board" });
            }}
          >
            <Icon name="more-horizontal" size={20} color={palette.text} />
          </IconButton>
        </>
      )}
    </View>
  );
}

/** A failed write, shown until it is dismissed or the next write starts. */
export function BoardError({ ctl }: { readonly ctl: BoardController }) {
  const palette = usePalette();
  if (ctl.error === undefined) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(120)}
      accessibilityRole="alert"
      className="flex-row items-center gap-2 border-b border-border px-4 py-2"
      style={{ backgroundColor: `${palette.danger}1F` }}
    >
      <Text size="sm" tone="danger" className="flex-1">
        {ctl.error}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        hitSlop={10}
        onPress={() => {
          ctl.setError(undefined);
        }}
      >
        <Icon name="x" size={18} color={palette.danger} />
      </Pressable>
    </Animated.View>
  );
}

export function BoardLoading({ label }: { readonly label: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <Spinner size={28} label={label} />
    </View>
  );
}

function emptyMessage(ctl: BoardController): string {
  if (ctl.archivedBoards)
    return "Boards you archive are kept here until you restore or delete them.";
  if (ctl.canManage) return "Create a board, then organize your work into cards and columns.";
  return "No boards are available to you. Ask a board manager to create one or add you to a private board.";
}

/** Shown when there is no board to open. */
export function BoardEmpty({ ctl }: { readonly ctl: BoardController }) {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-card bg-accent-soft">
        <Icon name="kanban" size={32} color={palette.accent} />
      </View>
      <Heading level={3} className="text-center">
        {ctl.archivedBoards ? "No archived boards" : "Plan your next project"}
      </Heading>
      <Text size="sm" tone="muted" className="text-center">
        {emptyMessage(ctl)}
      </Text>
      {ctl.archivedBoards && (
        <Button
          variant="secondary"
          onPress={() => {
            ctl.setArchivedBoards(false);
          }}
        >
          Back to active boards
        </Button>
      )}
      {!ctl.archivedBoards && ctl.canManage && (
        <Button
          onPress={() => {
            ctl.setOpen({ kind: "newBoard" });
          }}
        >
          Create your first board
        </Button>
      )}
    </View>
  );
}
