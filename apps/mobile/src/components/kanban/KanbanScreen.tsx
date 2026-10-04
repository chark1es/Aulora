import { hasPermission, Permission } from "@aulora/core";
import type { IconName } from "@aulora/tokens";
import { Button, Heading, Icon, IconButton, Spinner, Text, usePalette } from "@aulora/ui-native";
import { useMutation, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import {
  applyMove,
  applyTimer,
  type Board,
  type BoardMember,
  type Card,
  type CardFilters,
  type Column,
  cardsInColumn,
  failure,
  filterCards,
  filterCount,
  isColumnFull,
  moveStep,
  NO_FILTERS,
  PRIORITIES,
  PRIORITY,
  UNASSIGNED,
} from "../../lib/kanban";
import { MemberAvatar } from "../chat/MemberAvatar";
import { BoardSettingsSheet, NewBoardSheet } from "./BoardSettingsSheet";
import { CardSheet } from "./CardSheet";
import { CardTile } from "./CardTile";
import { AvatarStack, PriorityFlag, useNow } from "./parts";
import { ActionSheet, PickerSheet, SearchField, type SheetAction } from "./sheets";

/** From this width the columns sit side by side instead of paging. */
const WIDE = 768;
const GAP = 10;
const EDGE = 16;

type Open =
  | { kind: "boards" }
  | { kind: "board" }
  | { kind: "assignees" }
  | { kind: "labels" }
  | { kind: "priorities" }
  | { kind: "card"; cardId: Id<"kanbanCards"> }
  | { kind: "settings" }
  | { kind: "newBoard" };

export function KanbanScreen({
  ownUserId,
  permissions,
  members,
  boardId,
  onBoardChange: setBoardId,
  onOpenDrawer,
}: {
  readonly ownUserId: string;
  readonly permissions: bigint;
  readonly members: readonly BoardMember[];
  /** Kept by the parent so the board survives a visit to another tab. */
  readonly boardId: string | null;
  readonly onBoardChange: (boardId: string | null) => void;
  readonly onOpenDrawer: () => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const boards = useQuery(api.kanban.listBoards, {});
  const createCard = useMutation(api.kanban.createCard);
  const updateCard = useMutation(api.kanban.updateCard);
  const archiveCard = useMutation(api.kanban.archiveCard);
  const deleteCard = useMutation(api.kanban.deleteCard);
  const archiveBoard = useMutation(api.kanban.archiveBoard);
  const deleteBoard = useMutation(api.kanban.deleteBoard);
  // Moves and timers show at once and are corrected if the server disagrees.
  const moveCard = useMutation(api.kanban.moveCard);
  const move = useMemo(
    () =>
      moveCard.withOptimisticUpdate((store, args) => {
        for (const query of store.getAllQueries(api.kanban.listCards))
          if (query.value?.some((card) => card._id === args.cardId))
            store.setQuery(api.kanban.listCards, query.args, applyMove(query.value, args));
      }),
    [moveCard],
  );
  const toggleTimer = useMutation(api.kanban.timer);
  const timer = useMemo(
    () =>
      toggleTimer.withOptimisticUpdate((store, args) => {
        for (const query of store.getAllQueries(api.kanban.listCards))
          if (query.value?.some((card) => card._id === args.cardId))
            store.setQuery(
              api.kanban.listCards,
              query.args,
              applyTimer(query.value, args, ownUserId, Date.now()),
            );
      }),
    [toggleTimer, ownUserId],
  );

  const [archivedBoards, setArchivedBoards] = useState(false);
  const [archivedCards, setArchivedCards] = useState(false);
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const [detail, setDetail] = useState<Id<"kanbanCards"> | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const pager = useRef<ScrollView | null>(null);
  const strip = useRef<ScrollView | null>(null);
  const chips = useRef(new Map<number, number>());
  const now = useNow(false);

  const visibleBoards = useMemo(
    () => (boards ?? []).filter((entry) => entry.archived === archivedBoards),
    [boards, archivedBoards],
  );
  const board = visibleBoards.find((entry) => entry.id === boardId) ?? visibleBoards[0];
  const cards = useQuery(api.kanban.listCards, board ? { boardId: board.id } : "skip");
  const canManage = hasPermission(permissions, Permission.ManageKanban);
  const canEdit = hasPermission(permissions, Permission.EditKanban) && !board?.archived;
  const canArrange = canEdit && !archivedCards;
  const boardMembers = useMemo(
    () => members.filter((member) => !board?.private || board.memberIds.includes(member.userId)),
    [members, board],
  );

  // A board change starts a new filter and editing context.
  const currentBoardId = board?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the selected board changes
  useEffect(() => {
    setFilters(NO_FILTERS);
    setSearching(false);
    setArchivedCards(false);
    setComposing(null);
    setDetail(null);
    setActive(0);
  }, [currentBoardId]);

  // Cards stagger in once per board; anything arriving later just fades in.
  const scope = `${currentBoardId}:${archivedCards}`;
  const loaded = cards !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => setSettled(scope), 700);
    return () => clearTimeout(timeout);
  }, [scope, loaded]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    }
  }, []);

  const inView = useMemo(
    () => (cards ?? []).filter((card) => card.archived === archivedCards),
    [cards, archivedCards],
  );
  const filtered = useMemo(() => filterCards(inView, filters), [inView, filters]);
  const filtering = filterCount(filters) > 0;
  const columns = board?.columns ?? [];
  const wide = width >= WIDE;
  const columnWidth = wide
    ? Math.min(420, Math.max(280, (width - EDGE * 2 - GAP * (columns.length - 1)) / columns.length))
    : Math.min(width - 56, 400);
  const interval = columnWidth + GAP;

  const showColumn = useCallback(
    (index: number) => {
      pager.current?.scrollTo({ x: index * interval, animated: true });
      setActive(index);
    },
    [interval],
  );
  // Keeps the highlighted column name in view as the board is swiped.
  useEffect(() => {
    const x = chips.current.get(active);
    if (x !== undefined) strip.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
  }, [active]);
  const onPagerScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / interval);
      setActive((current) => (current === index ? current : index));
    },
    [interval],
  );

  const openCard = useCallback((card: Card) => setDetail(card._id), []);
  const menuCard = useCallback((card: Card) => setOpen({ kind: "card", cardId: card._id }), []);

  function confirm(title: string, message: string, label: string, onConfirm: () => void) {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: "destructive", onPress: onConfirm },
    ]);
  }

  function cardActions(card: Card): SheetAction[] {
    if (!board) return [];
    const siblings = cardsInColumn(filtered, card.columnId);
    const actions: SheetAction[] = [
      { id: "open", label: "Open card", icon: "expand", onPress: () => setDetail(card._id) },
    ];
    if (canArrange) {
      const up = moveStep(siblings, card._id, "up");
      const down = moveStep(siblings, card._id, "down");
      actions.push(
        ...board.columns
          .filter((column) => column.id !== card.columnId)
          .map((column, index): SheetAction => {
            const full = isColumnFull(column, cards ?? []);
            return {
              id: `column-${column.id}`,
              label: column.name,
              icon: "chevron-right",
              disabled: full,
              ...(full ? { hint: "Column limit reached" } : {}),
              ...(index === 0 ? { section: "Move to" } : {}),
              onPress: () => {
                showColumn(board.columns.indexOf(column));
                void run(() => move({ cardId: card._id, columnId: column.id }));
              },
            };
          }),
        {
          id: "up",
          label: "Move up",
          icon: "arrow-up",
          section: true,
          disabled: up === null,
          onPress: () => up && void run(() => move({ cardId: card._id, ...up })),
        },
        {
          id: "down",
          label: "Move down",
          icon: "arrow-down",
          disabled: down === null,
          onPress: () => down && void run(() => move({ cardId: card._id, ...down })),
        },
      );
      const mine = card.assigneeIds.includes(ownUserId);
      if (mine || boardMembers.some((member) => member.userId === ownUserId))
        actions.push({
          id: "assign",
          label: mine ? "Unassign me" : "Assign to me",
          icon: "user-plus",
          section: true,
          onPress: () =>
            void run(() =>
              updateCard({
                cardId: card._id,
                revision: card.revision,
                title: card.title,
                notes: card.notes,
                checklist: card.checklist,
                githubLinks: card.githubLinks,
                labelIds: card.labelIds,
                priority: card.priority,
                startAt: card.startAt ?? null,
                dueAt: card.dueAt ?? null,
                estimateMinutes: card.estimateMinutes ?? null,
                assigneeIds: mine
                  ? card.assigneeIds.filter((id) => id !== ownUserId)
                  : [...card.assigneeIds, ownUserId],
              }),
            ),
        });
    }
    const running = card.timerStartedAt !== undefined;
    if (
      !card.archived &&
      !board.archived &&
      (running ? card.timerUserId === ownUserId || canManage : canEdit)
    )
      actions.push({
        id: "timer",
        label: running ? "Stop timer" : "Start timer",
        icon: running ? "stop" : "play",
        onPress: () => void run(() => timer({ cardId: card._id, running: !running })),
      });
    actions.push({
      id: "copy",
      label: "Copy title",
      icon: "copy",
      section: true,
      onPress: () => void Clipboard.setStringAsync(card.title),
    });
    if (canEdit)
      actions.push({
        id: "archive",
        label: card.archived ? "Restore card" : "Archive card",
        icon: card.archived ? "unarchive" : "archive",
        onPress: () => void run(() => archiveCard({ cardId: card._id, archived: !card.archived })),
      });
    if (canManage)
      actions.push({
        id: "delete",
        label: "Delete card…",
        icon: "trash",
        danger: true,
        onPress: () =>
          confirm(
            "Permanently delete card?",
            "This deletes the card with its comments, activity and attachments. It cannot be undone.",
            "Delete card",
            () => void run(() => deleteCard({ cardId: card._id })),
          ),
      });
    return actions;
  }

  function boardActions(target: Board): SheetAction[] {
    const actions: SheetAction[] = [];
    if (canManage && !target.archived)
      actions.push({
        id: "settings",
        label: "Board settings…",
        icon: "settings",
        onPress: () => setOpen({ kind: "settings" }),
      });
    actions.push({
      id: "archived-cards",
      label: archivedCards ? "Show active cards" : "Show archived cards",
      icon: "archive",
      onPress: () => setArchivedCards(!archivedCards),
    });
    if (filtering)
      actions.push({
        id: "clear",
        label: "Clear filters",
        icon: "x",
        onPress: () => setFilters(NO_FILTERS),
      });
    if (canManage)
      actions.push(
        target.archived
          ? {
              id: "restore",
              label: "Restore board",
              icon: "unarchive",
              section: true,
              onPress: () => void run(() => archiveBoard({ boardId: target.id, archived: false })),
            }
          : {
              id: "archive",
              label: "Archive board…",
              icon: "archive",
              section: true,
              onPress: () =>
                confirm(
                  "Archive board?",
                  "Work timers will stop. You can restore this board from archived boards.",
                  "Archive board",
                  () => void run(() => archiveBoard({ boardId: target.id, archived: true })),
                ),
            },
        {
          id: "delete",
          label: "Delete board…",
          icon: "trash",
          danger: true,
          onPress: () =>
            confirm(
              "Permanently delete board?",
              "All cards, comments, activity and uploaded board files will be deleted. This cannot be undone.",
              "Delete board",
              () => void run(() => deleteBoard({ boardId: target.id })),
            ),
        },
      );
    return actions;
  }

  function boardChoices(): SheetAction[] {
    const actions: SheetAction[] = visibleBoards.map((entry) => ({
      id: entry.id,
      label: entry.name,
      icon: entry.id === board?.id ? "check" : entry.private ? "lock" : "kanban",
      onPress: () => {
        setBoardId(entry.id);
        setError(null);
      },
    }));
    if (canManage)
      actions.push({
        id: "new",
        label: "New board",
        icon: "plus",
        section: true,
        onPress: () => setOpen({ kind: "newBoard" }),
      });
    actions.push({
      id: "archived",
      label: archivedBoards ? "Show active boards" : "Show archived boards",
      icon: archivedBoards ? "kanban" : "archive",
      ...(canManage ? {} : { section: true as const }),
      onPress: () => {
        setArchivedBoards(!archivedBoards);
        setBoardId(null);
      },
    });
    return actions;
  }

  const menuCardTarget =
    open?.kind === "card" ? cards?.find((card) => card._id === open.cardId) : undefined;
  const detailCard = cards?.find((card) => card._id === detail);
  const close = () => setOpen(null);

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-1 border-b border-border px-3 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open conversations"
          className="h-12 w-12 items-center justify-center"
          onPress={onOpenDrawer}
        >
          <Icon name="menu" size={20} color={palette.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={board ? `${board.name}, switch board` : "Switch board"}
          className="min-h-12 min-w-0 flex-1 flex-row items-center gap-2 rounded-input px-2 active:bg-surface-3"
          onPress={() => setOpen({ kind: "boards" })}
        >
          <Icon name="kanban" size={20} color={palette.accent} />
          <Heading level={3} className="shrink" numberOfLines={1} maxFontSizeMultiplier={1.5}>
            {board?.name ?? (archivedBoards ? "Archived boards" : "Kanban")}
          </Heading>
          {board?.private && <Icon name="lock" size={14} color={palette["text-muted"]} />}
          <Icon name="chevron-down" size={16} color={palette["text-muted"]} />
        </Pressable>
        {board && (
          <>
            <IconButton
              label={searching ? "Close search" : "Search cards"}
              size="sm"
              onPress={() => {
                if (searching) setFilters({ ...filters, search: "" });
                setSearching(!searching);
              }}
            >
              <Icon
                name={searching ? "x" : "search"}
                size={20}
                color={filters.search.trim() ? palette.accent : palette.text}
              />
            </IconButton>
            <IconButton label="Board actions" size="sm" onPress={() => setOpen({ kind: "board" })}>
              <Icon name="more-horizontal" size={20} color={palette.text} />
            </IconButton>
          </>
        )}
      </View>

      {error !== null && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOut.duration(120)}
          accessibilityRole="alert"
          className="flex-row items-center gap-2 border-b border-border px-4 py-2"
          style={{ backgroundColor: `${palette.danger}1F` }}
        >
          <Text size="sm" tone="danger" className="flex-1">
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            hitSlop={10}
            onPress={() => setError(null)}
          >
            <Icon name="x" size={18} color={palette.danger} />
          </Pressable>
        </Animated.View>
      )}

      {boards === undefined ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={28} label="Loading boards" />
        </View>
      ) : !board ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <View className="h-16 w-16 items-center justify-center rounded-card bg-accent-soft">
            <Icon name="kanban" size={32} color={palette.accent} />
          </View>
          <Heading level={3} className="text-center">
            {archivedBoards ? "No archived boards" : "Plan your next project"}
          </Heading>
          <Text size="sm" tone="muted" className="text-center">
            {archivedBoards
              ? "Boards you archive are kept here until you restore or delete them."
              : canManage
                ? "Create a board, then organize your work into cards and columns."
                : "No boards are available to you. Ask a board manager to create one or add you to a private board."}
          </Text>
          {archivedBoards ? (
            <Button variant="secondary" onPress={() => setArchivedBoards(false)}>
              Back to active boards
            </Button>
          ) : (
            canManage && (
              <Button onPress={() => setOpen({ kind: "newBoard" })}>Create your first board</Button>
            )
          )}
        </View>
      ) : (
        <>
          {searching && (
            <Animated.View entering={FadeInDown.duration(180)} className="pt-2">
              <SearchField
                label="Search cards"
                value={filters.search}
                onChange={(search) => setFilters({ ...filters, search })}
              />
            </Animated.View>
          )}
          <View className="border-b border-border">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                gap: 8,
                paddingHorizontal: EDGE,
                paddingVertical: 8,
                alignItems: "center",
              }}
            >
              <FilterChip
                icon="users"
                label="Assignee"
                count={filters.assignees.length}
                onPress={() => setOpen({ kind: "assignees" })}
              />
              <FilterChip
                icon="label"
                label="Label"
                count={filters.labels.length}
                onPress={() => setOpen({ kind: "labels" })}
              />
              <FilterChip
                icon="flag"
                label="Priority"
                count={filters.priorities.length}
                onPress={() => setOpen({ kind: "priorities" })}
              />
              {filtering && (
                <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                  <Pressable
                    accessibilityRole="button"
                    className="min-h-9 justify-center px-2 active:opacity-60"
                    onPress={() => setFilters(NO_FILTERS)}
                  >
                    <Text size="sm" tone="accent">
                      Clear
                    </Text>
                  </Pressable>
                </Animated.View>
              )}
              <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                {filtering ? `${filtered.length} of ${inView.length}` : inView.length}{" "}
                {archivedCards ? "archived" : inView.length === 1 ? "card" : "cards"}
              </Text>
              {board.private && (
                <AvatarStack userIds={board.memberIds} members={members} max={4} ring="surface-1" />
              )}
            </ScrollView>
          </View>

          {(board.archived || archivedCards) && (
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
              {board.archived ? (
                canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() =>
                      void run(() => archiveBoard({ boardId: board.id, archived: false }))
                    }
                  >
                    Restore
                  </Button>
                )
              ) : (
                <Button size="sm" variant="secondary" onPress={() => setArchivedCards(false)}>
                  Active
                </Button>
              )}
            </Animated.View>
          )}

          {!wide && columns.length > 1 && (
            <ScrollView
              ref={strip}
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityRole="tablist"
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: 4, paddingHorizontal: EDGE - 4, paddingTop: 8 }}
            >
              {columns.map((column, index) => {
                const selected = index === active;
                const count = filtered.filter((card) => card.columnId === column.id).length;
                return (
                  <Pressable
                    key={column.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${column.name}, ${count} cards`}
                    onLayout={(event) => chips.current.set(index, event.nativeEvent.layout.x)}
                    onPress={() => showColumn(index)}
                    className={`min-h-9 flex-row items-center gap-1.5 rounded-pill px-3 ${
                      selected ? "bg-surface-3" : ""
                    }`}
                  >
                    <Text
                      size="sm"
                      tone={selected ? "default" : "muted"}
                      className={selected ? "font-semibold" : ""}
                    >
                      {column.name}
                    </Text>
                    <Text size="xs" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {cards === undefined ? (
            <View className="flex-1 items-center justify-center">
              <Spinner size={28} label="Loading cards" />
            </View>
          ) : (
            <ScrollView
              key={board.id}
              ref={pager}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              decelerationRate="fast"
              disableIntervalMomentum
              scrollEventThrottle={16}
              onScroll={onPagerScroll}
              {...(wide ? {} : { snapToInterval: interval, snapToAlignment: "start" as const })}
              contentContainerStyle={{ gap: GAP, paddingHorizontal: EDGE, paddingVertical: 10 }}
            >
              {columns.map((column) => (
                <ColumnView
                  key={column.id}
                  column={column}
                  width={columnWidth}
                  cards={cardsInColumn(filtered, column.id)}
                  full={isColumnFull(column, cards)}
                  board={board}
                  members={members}
                  now={now}
                  firstPaint={settled !== scope}
                  canArrange={canArrange}
                  composing={composing === column.id}
                  emptyText={
                    filtering
                      ? "No matching cards"
                      : archivedCards
                        ? "No archived cards"
                        : canArrange
                          ? "No cards yet. Add the first one below."
                          : "No cards yet"
                  }
                  onCompose={setComposing}
                  onCreate={(title) =>
                    run(() => createCard({ boardId: board.id, columnId: column.id, title }))
                  }
                  onOpen={openCard}
                  onMenu={menuCard}
                />
              ))}
            </ScrollView>
          )}
        </>
      )}

      {open?.kind === "boards" && (
        <ActionSheet
          title={archivedBoards ? "Archived boards" : "Boards"}
          actions={boardChoices()}
          onClose={close}
        />
      )}
      {open?.kind === "board" && board && (
        <ActionSheet title={board.name} actions={boardActions(board)} onClose={close} />
      )}
      {open?.kind === "card" && menuCardTarget && (
        <ActionSheet
          title={menuCardTarget.title}
          actions={cardActions(menuCardTarget)}
          onClose={close}
        />
      )}
      {open?.kind === "assignees" && (
        <PickerSheet
          multiple
          title="Filter by assignee"
          searchPlaceholder="Find a person"
          options={[
            {
              id: UNASSIGNED,
              label: "Unassigned",
              leading: (
                <View className="h-7 w-7 rounded-pill border border-dashed border-text-muted" />
              ),
            },
            ...boardMembers.map((member) => ({
              id: member.userId,
              label: member.displayName,
              leading: <MemberAvatar userId={member.userId} size={28} />,
            })),
          ]}
          selected={filters.assignees}
          onChange={(assignees) => setFilters({ ...filters, assignees })}
          onClose={close}
        />
      )}
      {open?.kind === "labels" && board && (
        <PickerSheet
          multiple
          title="Filter by label"
          emptyText="This board has no labels yet"
          options={board.labels.map((label) => ({
            id: label.id,
            label: label.name,
            leading: (
              <View className="h-3 w-3 rounded-pill" style={{ backgroundColor: label.color }} />
            ),
          }))}
          selected={filters.labels}
          onChange={(labels) => setFilters({ ...filters, labels })}
          onClose={close}
        />
      )}
      {open?.kind === "priorities" && (
        <PickerSheet
          multiple
          title="Filter by priority"
          options={[...PRIORITIES].reverse().map((priority) => ({
            id: priority,
            label: PRIORITY[priority].label,
            leading: <PriorityFlag priority={priority} />,
          }))}
          selected={filters.priorities}
          onChange={(priorities) => setFilters({ ...filters, priorities })}
          onClose={close}
        />
      )}
      {open?.kind === "newBoard" && (
        <NewBoardSheet
          ownUserId={ownUserId}
          onClose={close}
          onCreated={(id) => {
            setArchivedBoards(false);
            setBoardId(id);
          }}
        />
      )}
      {open?.kind === "settings" && board && (
        <BoardSettingsSheet key={board.id} board={board} members={members} onClose={close} />
      )}
      {detailCard && board && (
        <CardSheet
          key={detailCard._id}
          card={detailCard}
          board={board}
          members={members}
          permissions={permissions}
          ownUserId={ownUserId}
          onClose={() => setDetail(null)}
        />
      )}
    </View>
  );
}

function FilterChip({
  icon,
  label,
  count,
  onPress,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  const active = count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label.toLowerCase()}${active ? `, ${count} selected` : ""}`}
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

const ColumnView = memo(function ColumnView({
  column,
  width,
  cards,
  full,
  board,
  members,
  now,
  firstPaint,
  canArrange,
  composing,
  emptyText,
  onCompose,
  onCreate,
  onOpen,
  onMenu,
}: {
  readonly column: Column;
  readonly width: number;
  readonly cards: readonly Card[];
  readonly full: boolean;
  readonly board: Board;
  readonly members: readonly BoardMember[];
  readonly now: number;
  readonly firstPaint: boolean;
  readonly canArrange: boolean;
  readonly composing: boolean;
  readonly emptyText: string;
  readonly onCompose: (columnId: string | null) => void;
  readonly onCreate: (title: string) => Promise<boolean>;
  readonly onOpen: (card: Card) => void;
  readonly onMenu: (card: Card) => void;
}) {
  const palette = usePalette();
  const list = useRef<ScrollView | null>(null);
  return (
    <View
      accessibilityLabel={`${column.name} column`}
      className="rounded-card bg-surface-2"
      style={{ width }}
    >
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
            {cards.length}
            {column.wipLimit ? ` / ${column.wipLimit}` : ""}
          </Text>
        </View>
        <View className="flex-1" />
        {canArrange && (
          <IconButton
            label={`Add card to ${column.name}`}
            size="sm"
            disabled={full}
            onPress={() => onCompose(column.id)}
          >
            <Icon name="plus" size={20} color={palette["text-muted"]} />
          </IconButton>
        )}
      </View>
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
            members={members}
            now={now}
            index={index}
            firstPaint={firstPaint}
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
        {cards.length === 0 && !composing && (
          <Animated.View
            entering={FadeIn.duration(200)}
            layout={LinearTransition.duration(240)}
            className="rounded-input border border-dashed border-border px-3 py-6"
          >
            <Text size="sm" tone="muted" className="text-center">
              {emptyText}
            </Text>
          </Animated.View>
        )}
      </ScrollView>
      {canArrange && (
        <NewCard
          columnName={column.name}
          full={full}
          open={composing}
          onOpen={() => onCompose(column.id)}
          onClose={() => onCompose(null)}
          onCreate={async (title) => {
            const saved = await onCreate(title);
            if (saved) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 120);
            return saved;
          }}
        />
      )}
    </View>
  );
});

/** Stays open after a save so several cards can be added in a row. */
function NewCard({
  columnName,
  full,
  open,
  onOpen,
  onClose,
  onCreate,
}: {
  readonly columnName: string;
  readonly full: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onCreate: (title: string) => Promise<boolean>;
}) {
  const palette = usePalette();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open || full)
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
  const submit = () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    void onCreate(title).then((saved) => {
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
        accessibilityLabel={`New card in ${columnName}`}
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
        <Button size="sm" variant="ghost" onPress={onClose}>
          Cancel
        </Button>
      </View>
    </Animated.View>
  );
}
