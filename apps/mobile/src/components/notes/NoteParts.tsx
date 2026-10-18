/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { ErrorBanner, Icon, IconButton, Spinner, Text, usePalette } from "@aulora/ui-native";
import { View } from "react-native";
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
  if (ctl.error === undefined) return null;
  return (
    <ErrorBanner
      message={ctl.error}
      onDismiss={() => {
        ctl.setError(undefined);
      }}
    />
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
export function NoteBackButton({
  onPress,
  label = "Back to notes",
}: {
  readonly onPress: () => void;
  readonly label?: string;
}) {
  const palette = usePalette();
  return (
    <IconButton label={label} size="sm" onPress={onPress}>
      <Icon name="chevron-left" size={22} color={palette.text} />
    </IconButton>
  );
}
