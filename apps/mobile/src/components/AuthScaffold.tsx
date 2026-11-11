import { usePalette } from "@aulora/ui-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
  KeyboardEvents,
} from "react-native-keyboard-controller";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { BlobBackdrop } from "./BlobBackdrop";

export interface AuthScaffoldProps {
  /** Rendered below the intro, directly on the page. */
  readonly children: React.ReactNode;
  /** The hero mark, centred in the colour band. */
  readonly aura?: React.ReactNode;
  /** Title and supporting copy between the band and the form. */
  readonly intro?: React.ReactNode;
  /** Icon seed for the drifting blob band; omitted for a plain band. */
  readonly seed?: string;
  /** `false` lets the blob field drift; `true`/`null` holds it still. */
  readonly reduceMotion?: boolean | null;
}

/**
 * Shared layout for the pre-session screens: an inset, rounded colour band on
 * top carrying the workspace’s blobatar, then the title and the form set
 * directly on the page. There is no card around the form, so the screen reads as
 * one composition rather than a panel floating over a wallpaper. The content
 * width is capped on tablets so a primary button never stretches edge to edge
 * (HIG: “Avoid full-width buttons”). Callers own keyboard avoidance.
 */
export function AuthScaffold({ children, aura, intro, seed, reduceMotion }: AuthScaffoldProps) {
  return (
    <View className="flex-1 px-4 pb-8 pt-4 min-w-0">
      <View className="h-[236px] w-full max-w-content self-center overflow-hidden rounded-[28px] border border-border">
        {seed !== undefined && (
          <BlobBackdrop seed={seed} {...(reduceMotion !== undefined ? { reduceMotion } : {})} />
        )}
        <View className="flex-1 items-center justify-center min-w-0">{aura}</View>
      </View>
      <View className="w-full max-w-content gap-7 self-center px-2 pt-8">
        {intro !== undefined && <View className="items-stretch">{intro}</View>}
        {children}
      </View>
    </View>
  );
}

const scrollStyles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  content: { flexGrow: 1 },
  edge: { position: "absolute", top: 0, left: 0, right: 0, height: 24 },
});

/**
 * Scrolled content fades out at the scroller's top edge (just under the status
 * bar) instead of being cut flat through the hero band.
 */
function ScrollEdgeFade({ surface }: { readonly surface: "bg" | "surface-1" }) {
  const palette = usePalette();
  const color = palette[surface];
  return (
    <View pointerEvents="none" style={scrollStyles.edge}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="scroll-edge" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#scroll-edge)" />
      </Svg>
    </View>
  );
}

/**
 * Room kept between the keyboard and the focused field: enough for the primary
 * action that follows it (a large button plus the form gap) at 2x text, so the
 * field and its Continue/Sign in button both stay visible while typing.
 */
export const AUTH_KEYBOARD_CLEARANCE = 112;

/**
 * Keyboard-aware, tap-through scroller that every pre-session screen sits in. It
 * scrolls the focused field above the keyboard itself instead of relying on the
 * window resizing, which Android 15+ edge-to-edge apps no longer get.
 */
export function AuthScroll({ children }: { readonly children: React.ReactNode }) {
  return <FormScroll>{children}</FormScroll>;
}

/**
 * The same keyboard handling for any form: the focused field and the primary
 * action after it (see {@link AUTH_KEYBOARD_CLEARANCE}) stay above the keyboard,
 * with or without system animations.
 */
export function FormScroll({
  children,
  paddingBottom = 0,
  bottomOffset = AUTH_KEYBOARD_CLEARANCE,
  surface = "bg",
}: {
  readonly children: React.ReactNode;
  readonly paddingBottom?: number;
  /** Room kept between the focused field and the keyboard. */
  readonly bottomOffset?: number;
  /** The colour behind the scroller, which its top-edge fade blends into. */
  readonly surface?: "bg" | "surface-1";
}) {
  const ref = useRef<KeyboardAwareScrollViewRef>(null);
  const [scrolled, setScrolled] = useState(false);
  // The scroller follows keyboard animation frames; with system animations
  // removed (an accessibility setting) there are none, so settle once shown.
  useEffect(() => {
    const subscription = KeyboardEvents.addListener("keyboardDidShow", () => {
      ref.current?.assureFocusedInputVisible();
    });
    return () => {
      subscription.remove();
    };
  }, []);
  return (
    <View style={scrollStyles.fill}>
      <KeyboardAwareScrollView
        ref={ref}
        style={scrollStyles.fill}
        contentContainerStyle={[scrollStyles.content, { paddingBottom }]}
        bottomOffset={bottomOffset}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(event) => {
          const next = event.nativeEvent.contentOffset.y > 2;
          setScrolled((current) => (current === next ? current : next));
        }}
      >
        {children}
      </KeyboardAwareScrollView>
      {scrolled && <ScrollEdgeFade surface={surface} />}
    </View>
  );
}
