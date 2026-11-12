import { Text } from "@aulora/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions } from "react-native";
import type { Fn } from "../../lib/function-type";
import type { MentionCandidate } from "./use-mention-suggestions";

const DEFAULT_ROW_HEIGHT = 44;
/** Rows measured for the list's minimum height: two whole rows stay visible. */
const MEASURED_ROWS = 2;
const VISIBLE_ROWS = 5;

const sumHeights = (total: number, height: number) => total + height;

/** The measured heights of the first two rows, and whether details stack at large text. */
export function useSuggestionLayout() {
  // At large text sizes the detail ("Notify online members") stacks under the label and
  // wraps instead of being cut to a few letters beside it.
  const stackDetail = useWindowDimensions().fontScale > 1.3;
  // Measured from the first two rendered suggestions: their heights differ when only one
  // detail wraps, so two whole rows are the sum of both, not twice the first.
  const [rowHeights, setRowHeights] = useState<readonly number[]>([
    DEFAULT_ROW_HEIGHT,
    DEFAULT_ROW_HEIGHT,
  ]);
  const measure = (index: number, height: number) => {
    if (height <= 0) return;
    setRowHeights((heights) =>
      heights.at(index) === height
        ? heights
        : heights.map((known, at) => (at === index ? height : known)),
    );
  };
  return { rowHeights, stackDetail, measure };
}

export interface ComposerSuggestionsProps {
  readonly suggestions: readonly MentionCandidate[];
  readonly rowHeights: readonly number[];
  readonly stackDetail: boolean;
  readonly onMeasure: Fn<[index: number, height: number], void>;
  readonly onSelect: Fn<[candidate: MentionCandidate], void>;
}

interface SuggestionRowProps {
  readonly candidate: MentionCandidate;
  readonly stackDetail: boolean;
  /** Reports this row's height; omitted for rows that are not measured. */
  readonly onMeasured: Fn<[height: number], void> | undefined;
  readonly onSelect: Fn<[candidate: MentionCandidate], void>;
}

const ROW_STACKED = "min-h-11 justify-center px-3 py-1.5 active:bg-surface-3";
const ROW_INLINE = "min-h-11 flex-row items-center justify-between gap-2 px-3 active:bg-surface-3";

function SuggestionRow({ candidate, stackDetail, onMeasured, onSelect }: SuggestionRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Insert ${candidate.insert}`}
      accessibilityState={{ selected: false }}
      className={stackDetail ? ROW_STACKED : ROW_INLINE}
      onLayout={
        onMeasured === undefined
          ? undefined
          : (event) => {
              onMeasured(Math.round(event.nativeEvent.layout.height));
            }
      }
      onPress={() => {
        onSelect(candidate);
      }}
    >
      <Text size="sm" className="min-w-0 flex-1" numberOfLines={1}>
        {candidate.insert}
      </Text>
      <Text
        size="xs"
        tone="muted"
        className={stackDetail ? "min-w-0" : "max-w-[45%]"}
        numberOfLines={2}
      >
        {candidate.detail}
      </Text>
    </Pressable>
  );
}

/** Mention suggestions that shrink and scroll before they can push the input off screen. */
export function ComposerSuggestions({
  suggestions,
  rowHeights,
  stackDetail,
  onMeasure,
  onSelect,
}: ComposerSuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    // Shrinks and scrolls before it can push the input under the keyboard
    // on short screens or at large text sizes.
    <ScrollView
      className="rounded-card border border-border bg-surface-2"
      // At least two whole rows: on a short screen at large text the list
      // takes that room from the messages above, never from the input.
      style={{
        flexGrow: 0,
        flexShrink: 1,
        minHeight:
          rowHeights.slice(0, Math.min(MEASURED_ROWS, suggestions.length)).reduce(sumHeights, 0) +
          2,
        maxHeight: VISIBLE_ROWS * Math.max(...rowHeights) + 2,
      }}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      {suggestions.map((candidate, index) => (
        <SuggestionRow
          key={candidate.key}
          candidate={candidate}
          stackDetail={stackDetail}
          onMeasured={
            index < MEASURED_ROWS
              ? (height) => {
                  onMeasure(index, height);
                }
              : undefined
          }
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}
