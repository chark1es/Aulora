import * as Haptics from "expo-haptics";

/** A light tick for selection changes: switching panes, tabs and rows. */
export function selectionFeedback(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}

/** A soft bump for an action that opens something, such as a long-press menu. */
export function impactFeedback(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
