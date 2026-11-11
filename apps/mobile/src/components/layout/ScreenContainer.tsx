import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type LayoutChangeEvent, ScrollView, type ViewInstance } from "react-native";
import {
  KeyboardAvoidingView,
  type KeyboardAvoidingViewProps,
  KeyboardEvents,
  useKeyboardState,
} from "react-native-keyboard-controller";
import {
  SafeAreaInsetsContext,
  SafeAreaView,
  type SafeAreaViewProps,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/** Window insets stay intact for portals; only keyboard-attached footers drop bottom spacing. */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  return {
    ...insets,
    keyboardBottom: keyboardVisible ? 0 : insets.bottom,
    sheetBottom: keyboardVisible ? 12 : Math.max(insets.bottom, 12),
  };
}

/**
 * Structural twin of the safe-area library's `EdgeInsets`, declared locally so
 * unions and intersections below do not depend on a type from another package.
 */
export interface EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The window's own insets, kept while a banner re-bases the safe area below it. */
const WindowInsetsContext = createContext<EdgeInsets | null>(null);

/**
 * Insets of the whole window, for overlays that cover it (bottom sheets) even
 * when rendered inside a {@link RebasedInsets} region.
 */
export function useWindowInsets(): EdgeInsets {
  const local = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? local;
}

/** Content below a banner that already owns the top inset sees `insets` instead. */
export function RebasedInsets({
  insets,
  children,
}: {
  readonly insets: EdgeInsets;
  readonly children: ReactNode;
}) {
  const window = useWindowInsets();
  return (
    <WindowInsetsContext.Provider value={window}>
      <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>
    </WindowInsetsContext.Provider>
  );
}

/** The pane's vertical distance from the window top beyond its parent-relative layout. */
function useWindowOffset() {
  const ref = useRef<ViewInstance>(null);
  const layoutY = useRef(0);
  const [offset, setOffset] = useState(0);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, windowY) => {
      if (Number.isFinite(windowY)) setOffset(Math.max(0, windowY - layoutY.current));
    });
  }, []);
  useEffect(() => {
    const subscription = KeyboardEvents.addListener("keyboardWillShow", measure);
    return () => {
      subscription.remove();
    };
  }, [measure]);
  const track = (event: LayoutChangeEvent) => {
    // The library types its ref as the legacy View class; keep the host view.
    ref.current = event.currentTarget as unknown as ViewInstance;
    layoutY.current = event.nativeEvent.layout.y;
  };
  return { offset, track, measure };
}

/**
 * Keyboard-avoiding pane for content that is not at the top of the window.
 *
 * The keyboard controller's view measures its frame relative to its parent, so
 * a pane below a banner, a status-bar inset or another pane is under-padded by
 * that distance and its composer ends up behind the keyboard (seen on Android
 * 16 edge-to-edge). This measures the pane's real window position on layout and
 * whenever the keyboard opens, and passes the difference as the vertical offset.
 */
export function KeyboardAvoidingPane({
  onLayout,
  behavior = "padding",
  ...props
}: Omit<KeyboardAvoidingViewProps, "keyboardVerticalOffset" | "automaticOffset">) {
  const { offset, track, measure } = useWindowOffset();
  return (
    <KeyboardAvoidingView
      {...props}
      behavior={behavior}
      keyboardVerticalOffset={offset}
      onLayout={(event: LayoutChangeEvent) => {
        track(event);
        onLayout?.(event);
        measure();
      }}
    />
  );
}

export interface ScreenContainerProps extends SafeAreaViewProps {
  readonly scrollable?: boolean;
}

/** Full screens protect every edge by default, including landscape cutouts. */
export function ScreenContainer(props: ScreenContainerProps) {
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const {
    scrollable = false,
    children,
    edges = ["top", "right", "bottom", "left"],
    ...rest
  } = props;
  const keyboardEdges = Array.isArray(edges)
    ? edges.filter((edge) => edge !== "bottom")
    : { ...edges, bottom: "off" as const };
  return (
    <SafeAreaView {...rest} edges={keyboardVisible ? keyboardEdges : edges}>
      {scrollable ? (
        <ScrollView
          style={{ flex: 1, alignSelf: "stretch" }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            gap: 12,
            paddingVertical: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
