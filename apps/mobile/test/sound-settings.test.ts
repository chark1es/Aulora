import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ prefs: undefined as unknown, stuck: false }));
vi.mock("convex/react", () => ({
  useQuery: () => state.prefs,
  useMutation: () => vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/lib/stuck-timeout", () => ({ useStuckTimeout: () => state.stuck }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  ScrollView: "ScrollView",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1 }),
}));
vi.mock("@aulora/ui-native", () => ({
  Button: "Button",
  SettingRow: "SettingRow",
  SwitchRow: "SwitchRow",
  Text: "Text",
}));
vi.mock("../src/lib/haptics", () => ({ selectionFeedback: vi.fn() }));
vi.mock("../src/providers/ChatProvider", () => ({ useOptionalChat: () => null }));
vi.mock("../src/providers/SoundProvider", () => ({ useSound: () => null }));
vi.mock("../src/components/chat/List", () => ({
  ListGroup: "ListGroup",
  ListHeader: "ListHeader",
}));
vi.mock("../../../packages/convex/convex/_generated/api", () => ({
  api: { notifications: { getPrefs: "getPrefs", setPref: "setPref" }, server: {} },
}));

const { MassMentionBoundary, MassMentionToggle, MassMentionUnavailable, SoundSettingsSection } =
  await import("../src/components/chat/SoundSettingsSection");

type Element = ReactElement<Record<string, unknown>>;

beforeEach(() => {
  state.prefs = undefined;
  state.stuck = false;
});

it("offers an error and a retry, not a dead switch, when preferences never load", () => {
  const onRetry = vi.fn();
  state.stuck = true;
  const stuck = MassMentionToggle({ attempt: 0, onRetry }) as Element;
  expect(stuck.type).toBe(MassMentionUnavailable);
  expect(stuck.props.onRetry).toBe(onRetry);
  const fallback = MassMentionUnavailable({ onRetry }) as Element;
  const flatten = (node: Element): Element[] => [
    node,
    ...[node.props.children]
      .flat(Infinity)
      .filter((child): child is Element => typeof child === "object" && child !== null)
      .flatMap(flatten),
  ];
  const retry = flatten(fallback).find((node) => node.type === "Button");
  if (retry === undefined) throw new Error("Missing retry");
  expect(retry.props.children).toBe("Try again");
  (retry.props.onPress as () => void)();
  expect(onRetry).toHaveBeenCalledOnce();
});

it("waits briefly with a disabled switch, then enables it once loaded", () => {
  const loading = MassMentionToggle({ attempt: 0, onRetry: vi.fn() }) as Element;
  expect(loading.type).toBe("SwitchRow");
  expect(loading.props.disabled).toBe(true);
  state.prefs = [{ scope: "server", suppressMassMentions: true }];
  const ready = MassMentionToggle({ attempt: 0, onRetry: vi.fn() }) as Element;
  expect(ready.props.disabled).toBe(false);
  expect(ready.props.value).toBe(true);
});

it("keeps a failed preference query inside its row", () => {
  expect(MassMentionBoundary.getDerivedStateFromError()).toEqual({ failed: true });
});

it("renders outside a chat provider, as in the offline demo", () => {
  expect(() => SoundSettingsSection()).not.toThrow();
});
