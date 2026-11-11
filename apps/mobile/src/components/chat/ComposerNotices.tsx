import { Icon, Text, usePalette } from "@aulora/ui-native";
import { Pressable, View } from "react-native";
import type { Fn } from "../../lib/function-type";
import { MESSAGE_MAX_LENGTH } from "../../lib/message-limits";
import { ComposerSuggestions, type ComposerSuggestionsProps } from "./ComposerSuggestions";
import { RichText } from "./RichText";
import type { ComposerFile } from "./use-composer-attachments";

function ComposerError({
  error,
  onDismiss,
}: {
  readonly error: string | null;
  readonly onDismiss: Fn<[], void>;
}) {
  const palette = usePalette();
  if (error === null) return null;
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 rounded-card border border-border bg-surface-2 px-3 py-2"
    >
      <Text size="xs" tone="danger" className="flex-1 min-w-0">
        {error}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message error"
        className="-my-2 -mr-2 h-11 w-11 items-center justify-center"
        onPress={onDismiss}
      >
        <Icon name="x" size={14} color={palette["text-muted"]} />
      </Pressable>
    </View>
  );
}

function ComposerFileChips({
  files,
  onRemove,
}: {
  readonly files: readonly ComposerFile[];
  readonly onRemove: Fn<[key: string], void>;
}) {
  const palette = usePalette();
  if (files.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {files.map((entry) => (
        <Pressable
          key={entry.key}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${entry.file.name}`}
          className="min-h-11 min-w-11 flex-row items-center gap-1.5 rounded-pill bg-surface-2 py-1.5 pl-3 pr-2 active:opacity-70"
          onPress={() => {
            onRemove(entry.key);
          }}
        >
          <Icon name="paperclip" size={14} color={palette["text-muted"]} />
          <Text size="xs" numberOfLines={1} className="max-w-[10rem]">
            {entry.file.name}
          </Text>
          <Icon name="x" size={14} color={palette["text-muted"]} />
        </Pressable>
      ))}
    </View>
  );
}

/** Collapsed while empty: at large text an empty line costs ~30dp, enough to push the input under the keyboard on a short screen. */
function ComposerLengthRow({
  limitError,
  textLength,
}: {
  readonly limitError: string | null;
  readonly textLength: number;
}) {
  const nearLimit = textLength >= MESSAGE_MAX_LENGTH * 0.9;
  if (limitError === null && !nearLimit) return null;
  return (
    <View className="min-h-4 flex-row items-center justify-between gap-2">
      <Text size="xs" tone="danger" className="flex-1 min-w-0" numberOfLines={1}>
        {limitError ?? ""}
      </Text>
      {nearLimit && (
        <Text
          size="xs"
          tone={textLength > MESSAGE_MAX_LENGTH ? "danger" : "muted"}
          className="text-right tabular-nums"
        >
          {textLength}/{MESSAGE_MAX_LENGTH}
        </Text>
      )}
    </View>
  );
}

export interface ComposerPreviewProps {
  readonly text: string;
  readonly mentionNames: readonly string[];
  readonly channelNames: readonly string[];
  readonly viewerName: string;
}

export interface ComposerNoticesProps {
  readonly error: string | null;
  readonly onDismissError: Fn<[], void>;
  readonly files: readonly ComposerFile[];
  readonly onRemoveFile: Fn<[key: string], void>;
  readonly mentionHint: string;
  readonly suggestions: ComposerSuggestionsProps;
  /** The markdown preview; null while the draft has nothing to preview. */
  readonly preview: ComposerPreviewProps | null;
  readonly limitError: string | null;
  readonly textLength: number;
}

/** Everything the composer shows above its input row. */
export function ComposerNotices(props: ComposerNoticesProps) {
  const { mentionHint, preview } = props;
  return (
    <>
      <ComposerError error={props.error} onDismiss={props.onDismissError} />
      <ComposerFileChips files={props.files} onRemove={props.onRemoveFile} />
      {mentionHint.length > 0 && (
        <Text size="xs" tone="muted" testID="composer-mention-hint">
          {mentionHint}
        </Text>
      )}
      <ComposerSuggestions {...props.suggestions} />
      {preview !== null && (
        <View className="rounded-card border border-border bg-surface-2 px-3 py-2">
          <RichText {...preview} />
        </View>
      )}
      <ComposerLengthRow limitError={props.limitError} textLength={props.textLength} />
    </>
  );
}
