import { BROADCAST_FALLBACK_NOTE, reportBroadcastFallback } from "@aulora/core";
import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { Composer } from "../src/components/chat/Composer";
import type { Fn } from "../src/lib/function-type";

const state = vi.hoisted(() => ({
  fontScale: 1,
  draft: "",
  setDraft: vi.fn(),
  mounted: false,
  cells: [] as unknown[],
  slot: 0,
  effects: [] as (() => undefined | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    if (!state.mounted) return initial === "" ? [state.draft, state.setDraft] : [initial, vi.fn()];
    const cells = state.cells;
    const slot = state.slot++;
    if (!(slot in cells)) cells[slot] = initial;
    return [
      cells[slot],
      (next: unknown) => {
        cells[slot] = typeof next === "function" ? next(cells[slot]) : next;
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => undefined | (() => void)) => {
    state.effects.push(effect);
  },
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  LayoutAnimation: { configureNext: vi.fn(), create: vi.fn(), Types: {} },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  useWindowDimensions: () => ({ width: 360, height: 640, fontScale: state.fontScale }),
  View: "View",
}));
vi.mock("../src/lib/use-entrance", () => ({ useReduceMotion: () => false }));
// TextField is the shared Inter TextInput; render it under the host name the assertions look for.
vi.mock("@aulora/ui-native", () => ({
  Icon: "Icon",
  Text: "Text",
  TextField: "TextInput",
  usePalette: () => ({}),
}));
vi.mock("../src/components/layout/ScreenContainer", () => ({
  useScreenInsets: () => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    keyboardBottom: 0,
    sheetBottom: 12,
  }),
}));
vi.mock("../src/lib/attachments", () => ({
  pickDocuments: vi.fn(),
  pickFromCamera: vi.fn(),
  pickFromClipboard: vi.fn(),
  pickFromLibrary: vi.fn(),
}));
vi.mock("../src/lib/haptics", () => ({ impactFeedback: vi.fn() }));
vi.mock("../src/components/chat/BottomSheet", () => ({ BottomSheet: "BottomSheet" }));
vi.mock("../src/components/chat/List", () => ({ ListGroup: "ListGroup", ListRow: "ListRow" }));
vi.mock("../src/components/chat/RichText", () => ({ RichText: "RichText" }));

type Element = ReactElement<Record<string, unknown>>;
const isElement = (child: unknown): child is Element =>
  typeof child === "object" && child !== null && "props" in child;
/**
 * Every element the composer renders, depth first. Function components (the composer's own
 * parts) are called with their props, as React would; host and mocked components are leaves
 * that contribute their `children`.
 */
function descendants(element: Element): Element[] {
  const rendered =
    typeof element.type === "function"
      ? (element.type as Fn<[props: Record<string, unknown>], unknown>)(element.props)
      : element.props.children;
  const children = [rendered].flat(Infinity).filter(isElement);
  return [element, ...children.flatMap(descendants)];
}

it("preserves an oversized paste, explains the limit, and disables Send without announcing the counter", () => {
  state.draft = "x".repeat(4001);
  const send = vi.fn();
  const tree = descendants(Composer({ channelId: "channel", onTyping: vi.fn(), onSend: send }));
  const input = tree.find((node) => node.type === "TextInput");
  if (input === undefined) throw new Error("Missing composer input");
  expect(input.props.value).toBe(state.draft);
  expect(input?.props.maxLength).toBeUndefined();
  const paste = "p".repeat(8000);
  (input.props.onChangeText as (text: string) => void)(paste);
  expect(state.setDraft).toHaveBeenCalledWith(paste);
  const reason = "Message is over 4,000 characters. Trim it or split it.";
  expect(tree.some((node) => node.props.children === reason)).toBe(true);
  const button = tree.find((node) => node.props.accessibilityLabel === "Send");
  expect(button?.props.disabled).toBe(true);
  expect(button?.props.accessibilityHint).toBe(reason);
  // Neither the counter nor an empty hint row is a live region.
  expect(tree.filter((node) => node.props.accessibilityLiveRegion !== undefined)).toHaveLength(0);
  expect(send).not.toHaveBeenCalled();
});

it("reserves no row for an empty mention hint and announces a hint only once", () => {
  state.draft = "hello";
  const quiet = descendants(Composer({ channelId: "channel", onTyping: vi.fn(), onSend: vi.fn() }));
  expect(quiet.some((node) => node.props.testID === "composer-mention-hint")).toBe(false);
  state.draft = "@everyone hi";
  const tree = descendants(Composer({ channelId: "channel", onTyping: vi.fn(), onSend: vi.fn() }));
  const hint = tree.find((node) => node.props.testID === "composer-mention-hint");
  expect(hint?.props.children).toMatch(/plain text/);
  // announceForAccessibility speaks it; a live region as well would read it twice.
  expect(hint?.props.accessibilityLiveRegion).toBeUndefined();
});

it("keeps at least two mention suggestions visible", () => {
  state.draft = "@";
  const tree = descendants(
    Composer({
      channelId: "channel",
      members: [
        { userId: "a", displayName: "Ana" },
        { userId: "b", displayName: "Bo" },
        { userId: "c", displayName: "Cy" },
      ],
      onTyping: vi.fn(),
      onSend: vi.fn(),
    }),
  );
  const list = tree.find((node) => node.type === "ScrollView");
  const style = list?.props.style as { minHeight: number; maxHeight: number };
  expect(style.minHeight).toBe(2 * 44 + 2);
  expect(style.maxHeight).toBe(5 * 44 + 2);
});

it("sizes the list for two whole rows even when the second row is taller than the first", () => {
  state.mounted = true;
  state.cells = [];
  state.effects = [];
  try {
    const render = () => {
      state.slot = 0;
      state.effects = [];
      return descendants(
        Composer({
          channelId: "channel",
          members: [{ userId: "a", displayName: "Ana" }],
          canMentionEveryone: true,
          onTyping: vi.fn(),
          onSend: vi.fn(),
        }),
      );
    };
    const input = render().find((node) => node.type === "TextInput");
    if (input === undefined) throw new Error("Missing input");
    (input.props.onChangeText as (text: string) => void)("@");
    const first = render();
    const row = (tree: Element[], label: string) =>
      tree.find((node) => node.props.accessibilityLabel === label);
    const layout = (node: Element | undefined, height: number) => {
      const onLayout = node?.props.onLayout as ((event: unknown) => void) | undefined;
      if (onLayout === undefined) throw new Error("Row is not measured");
      onLayout({ nativeEvent: { layout: { height } } });
    };
    // "@here" has a one-line detail; "@everyone" wraps to two.
    layout(row(first, "Insert @here"), 60);
    layout(row(first, "Insert @everyone"), 96);
    const style = render().find((node) => node.type === "ScrollView")?.props.style as {
      minHeight: number;
      maxHeight: number;
    };
    expect(style.minHeight).toBe(60 + 96 + 2);
    expect(style.maxHeight).toBe(5 * 96 + 2);
    // Rows after the second are never measured.
    expect(row(render(), "Insert @Ana")?.props.onLayout).toBeUndefined();
  } finally {
    state.mounted = false;
  }
});

it("lets mention suggestion details wrap under the label at large text sizes", () => {
  state.draft = "@";
  const render = (fontScale: number) => {
    state.fontScale = fontScale;
    const tree = descendants(
      Composer({
        channelId: "channel",
        members: [{ userId: "a", displayName: "Ana" }],
        canMentionEveryone: true,
        onTyping: vi.fn(),
        onSend: vi.fn(),
      }),
    );
    state.fontScale = 1;
    const row = tree.find((node) => node.props.accessibilityLabel === "Insert @here");
    const detail = (row === undefined ? [] : descendants(row)).find(
      (node) => node.props.children === "Notify online members",
    );
    return { row, detail };
  };
  const normal = render(1);
  expect(normal.row?.props.className).toContain("flex-row");
  expect(normal.detail?.props.numberOfLines).toBeGreaterThanOrEqual(2);
  const large = render(2);
  expect(large.row?.props.className).not.toContain("flex-row");
  expect(large.detail?.props.className).toBe("min-w-0");
  expect(large.detail?.props.numberOfLines).toBeGreaterThanOrEqual(2);
});

it("counts the trimmed payload consistently when whitespace surrounds a limit-length message", () => {
  state.draft = `   ${"x".repeat(4000)}   `;
  const tree = descendants(Composer({ channelId: "channel", onTyping: vi.fn(), onSend: vi.fn() }));
  expect(tree.find((node) => node.props.accessibilityLabel === "Send")?.props.disabled).toBe(false);
  expect(
    tree.find((node) => node.props.className === "text-right tabular-nums")?.props.children,
  ).toEqual([4000, "/", 4000]);
});

it("a keyed channel remount keeps B sendable and preserves its identical draft when A finishes", async () => {
  state.mounted = true;
  state.cells = [];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onSend = vi.fn(() => pending);
  const render = (channelId: string) => {
    state.slot = 0;
    return descendants(Composer({ channelId, onTyping: vi.fn(), onSend }));
  };
  const type = (tree: Element[], text: string) => {
    const input = tree.find((node) => node.type === "TextInput");
    if (input === undefined) throw new Error("Missing input");
    (input.props.onChangeText as (text: string) => void)(text);
  };
  type(render("A"), "Same draft");
  const sendA = render("A").find((node) => node.props.accessibilityLabel === "Send");
  if (sendA === undefined) throw new Error("Missing send button");
  (sendA.props.onPress as () => void)();
  await Promise.resolve();
  expect(onSend).toHaveBeenCalledWith({ text: "Same draft", files: [] });
  expect(render("A").find((node) => node.props.accessibilityLabel === "Send")?.props.disabled).toBe(
    true,
  );
  // React creates fresh hook cells when the channel key changes at both call sites.
  state.cells = [];
  type(render("B"), "Same draft");
  expect(render("B").find((node) => node.props.accessibilityLabel === "Send")?.props.disabled).toBe(
    false,
  );
  finish();
  await vi.waitFor(() =>
    expect(render("B").find((node) => node.type === "TextInput")?.props.value).toBe("Same draft"),
  );
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(render("B").find((node) => node.type === "TextInput")?.props.value).toBe("Same draft");
  state.mounted = false;
});

it("shows the last-send fallback note, retires it on typing, and lets a live hint win", () => {
  state.mounted = true;
  state.cells = [];
  state.effects = [];
  const cleanups: (() => void)[] = [];
  // Runs the effects of the latest render, as React does after committing it.
  const commit = () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    const pending = state.effects.splice(0);
    for (const effect of pending) {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
  };
  const render = () => {
    state.slot = 0;
    state.effects = [];
    return descendants(Composer({ channelId: "c1", onTyping: vi.fn(), onSend: vi.fn() }));
  };
  const hint = (tree: Element[]) =>
    tree.find((node) => node.props.testID === "composer-mention-hint")?.props.children;
  const type = (tree: Element[], text: string) => {
    const input = tree.find((node) => node.type === "TextInput");
    if (input === undefined) throw new Error("Missing input");
    (input.props.onChangeText as (text: string) => void)(text);
  };
  try {
    render();
    commit();
    expect(hint(render())).toBeUndefined();
    // Another channel's fallback is not this composer's note.
    reportBroadcastFallback("other");
    expect(hint(render())).toBeUndefined();
    reportBroadcastFallback("c1");
    expect(hint(render())).toBe(BROADCAST_FALLBACK_NOTE);
    // An empty draft keeps the note; the first typed character retires it for good.
    commit();
    expect(hint(render())).toBe(BROADCAST_FALLBACK_NOTE);
    type(render(), "h");
    render();
    commit(); // the post-render effect sees the typed draft and clears the note
    expect(hint(render())).toBeUndefined();
    type(render(), "");
    render();
    commit();
    expect(hint(render())).toBeUndefined();
    // A live warning about the draft shows instead of a pending note.
    reportBroadcastFallback("c1");
    expect(hint(render())).toBe(BROADCAST_FALLBACK_NOTE);
    type(render(), "@everyone");
    expect(hint(render())).toMatch(/plain text/);
  } finally {
    for (const cleanup of cleanups) cleanup();
    state.mounted = false;
    state.effects = [];
  }
});
