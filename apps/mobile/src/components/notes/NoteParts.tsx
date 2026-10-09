/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Icon, IconButton, Spinner, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import type { NotesController, NoteTagView } from "./use-notes";

/** A centred spinner while a query is in flight. */
export function NotesLoading({ label }: { readonly label: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <Spinner size={28} label={label} />
    </View>
  );
}

/** A failed write, shown until it is dismissed or the next write starts. */
export function NotesError({ ctl }: { readonly ctl: NotesController }) {
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

/** A small coloured tag pill. */
export function NoteTagChip({ tag }: { readonly tag: NoteTagView }) {
  return (
    <View
      className="max-w-full flex-row items-center gap-1.5 rounded-pill px-2 py-0.5"
      style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(tag.color) ? `${tag.color}2E` : undefined }}
    >
      <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: tag.color }} />
      <Text size="xs" className="shrink font-medium" numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

/** A round back button used by the editor and history headers. */
export function NoteBackButton({ onPress }: { readonly onPress: () => void }) {
  const palette = usePalette();
  return (
    <IconButton label="Back to notes" size="sm" onPress={onPress}>
      <Icon name="chevron-left" size={22} color={palette.text} />
    </IconButton>
  );
}
