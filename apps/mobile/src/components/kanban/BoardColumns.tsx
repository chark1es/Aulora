import { Text } from "@aulora/ui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type ScrollView,
  useWindowDimensions,
} from "react-native";
import { impactFeedback, selectionFeedback } from "../../lib/haptics";
import type { Board, Card } from "../../lib/kanban";
import { HorizontalScroll } from "../chat/SwipePanes";
import { BoardColumn } from "./BoardColumn";
import { useNow } from "./parts";
import type { BoardController } from "./use-board";

/** From this width the columns sit side by side instead of paging. */
const WIDE = 768;
const GAP = 10;
const EDGE = 16;

/** How wide each column is: a page with the next one peeking, or a share of a tablet. */
function useColumnWidth(count: number) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const share = (width - EDGE * 2 - GAP * (count - 1)) / Math.max(count, 1);
  const columnWidth = wide ? Math.min(420, Math.max(280, share)) : Math.min(width - 56, 400);
  return { wide, columnWidth, interval: columnWidth + GAP };
}

interface StripProps {
  readonly ctl: BoardController;
  readonly board: Board;
  readonly active: number;
  readonly onShow: (index: number) => void;
}

/** Column names with their counts; tapping one brings that column into view. */
function ColumnStrip({ ctl, board, active, onShow }: StripProps) {
  const strip = useRef<ScrollView | null>(null);
  const offsets = useRef(new Map<number, number>());
  // Keeps the highlighted column name in view as the board is swiped.
  useEffect(() => {
    const x = offsets.current.get(active);
    if (x !== undefined) strip.current?.scrollTo({ x: Math.max(0, x - 48), animated: true });
  }, [active]);
  return (
    <HorizontalScroll
      ref={strip}
      accessibilityRole="tablist"
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 4, paddingHorizontal: EDGE - 4, paddingTop: 8 }}
    >
      {board.columns.map((column, index) => {
        const selected = index === active;
        const count = ctl.filtered.filter((card) => card.columnId === column.id).length;
        return (
          <Pressable
            key={column.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${column.name}, ${count} cards`}
            onLayout={(event) => {
              offsets.current.set(index, event.nativeEvent.layout.x);
            }}
            onPress={() => {
              onShow(index);
            }}
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
    </HorizontalScroll>
  );
}

/** The board itself: columns that page sideways under a strip of their names. */
export function BoardColumns({
  ctl,
  board,
}: {
  readonly ctl: BoardController;
  readonly board: Board;
}) {
  const pager = useRef<ScrollView | null>(null);
  const [active, setActive] = useState(0);
  const now = useNow(false);
  const { wide, columnWidth, interval } = useColumnWidth(board.columns.length);
  const show = useCallback(
    (index: number) => {
      pager.current?.scrollTo({ x: index * interval, animated: true });
      setActive(index);
    },
    [interval],
  );
  // Lets a card's "Move to" follow the card to its new column.
  useEffect(() => {
    ctl.showColumn.current = show;
  }, [ctl.showColumn, show]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / interval);
      setActive((current) => {
        if (current !== index) selectionFeedback();
        return index;
      });
    },
    [interval],
  );
  const { setDetail, setOpen } = ctl;
  const openCard = useCallback(
    (card: Card) => {
      setDetail(card._id);
    },
    [setDetail],
  );
  const menuCard = useCallback(
    (card: Card) => {
      impactFeedback();
      setOpen({ kind: "card", cardId: card._id });
    },
    [setOpen],
  );
  return (
    <>
      {!wide && board.columns.length > 1 && (
        <ColumnStrip ctl={ctl} board={board} active={active} onShow={show} />
      )}
      <HorizontalScroll
        ref={pager}
        keyboardShouldPersistTaps="handled"
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEventThrottle={16}
        onScroll={onScroll}
        {...(wide ? {} : { snapToInterval: interval, snapToAlignment: "start" as const })}
        contentContainerStyle={{ gap: GAP, paddingHorizontal: EDGE, paddingVertical: 10 }}
      >
        {board.columns.map((column) => (
          <BoardColumn
            key={column.id}
            ctl={ctl}
            board={board}
            column={column}
            width={columnWidth}
            now={now}
            onOpen={openCard}
            onMenu={menuCard}
          />
        ))}
      </HorizontalScroll>
    </>
  );
}
