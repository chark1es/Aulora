import type { ReactNode } from "react";
import { Animated } from "react-native";
import { useEntrance, useReduceMotion } from "../../lib/use-entrance";

/**
 * A settings page entering in place, where a native sheet used to slide up.
 * The same fade-and-rise is shared by the You tab's own pages, the role list
 * and one role's editor; with Reduce Motion on, the page appears in its final
 * position and never animates.
 */
export function PageTransition({ children }: { readonly children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const { animatedStyle } = useEntrance(reduceMotion);
  return (
    <Animated.View style={[{ flex: 1, minWidth: 0 }, animatedStyle]}>{children}</Animated.View>
  );
}
