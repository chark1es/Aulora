import { View } from "react-native";
import { useScreenInsets } from "../layout/ScreenContainer";
import { ComposerAttachMenu } from "./ComposerAttachMenu";
import { ComposerInputRow } from "./ComposerInputRow";
import { ComposerNotices } from "./ComposerNotices";
import type { ComposerProps } from "./composer-props";
import { useComposerModel } from "./use-composer-model";

export type { ComposerProps } from "./composer-props";
export type { MentionCandidate } from "./use-mention-suggestions";

/** Mobile composer with attachments, `@`/`#` autocomplete and a markdown preview. */
export function Composer(props: ComposerProps) {
  const insets = useScreenInsets();
  const { notices, inputRow, attachMenu } = useComposerModel(props);
  return (
    <View
      className="gap-1.5 bg-bg px-3 pt-1.5"
      // Anchored to the bottom: if the screen is too short for suggestions at
      // their two-row minimum, the list's top is clipped, never the input.
      style={{
        flexShrink: 1,
        paddingBottom: Math.max(insets.keyboardBottom, 8),
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      <ComposerNotices {...notices} />
      <ComposerInputRow {...inputRow} />
      <ComposerAttachMenu {...attachMenu} />
    </View>
  );
}
