import { Keyboard } from "react-native";

/**
 * A plain function for gesture worklets to schedule: the `Keyboard` module
 * itself cannot be captured by a worklet.
 */
export function dismissKeyboard(): void {
  Keyboard.dismiss();
}
