import { useRef } from "react";
import type { TextInputInstance } from "react-native";

/** The ref to the composer's text field, so a seeded draft can focus it. */
export function useComposerInputRef() {
  return useRef<TextInputInstance>(null);
}

export type ComposerInputRef = ReturnType<typeof useComposerInputRef>;
