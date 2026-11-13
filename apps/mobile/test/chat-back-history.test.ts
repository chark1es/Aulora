import { beforeEach, expect, it, vi } from "vitest";
import { useChatScreenNavigation } from "../src/components/chat/use-chat-screen-actions";
import type { ChatScreenData } from "../src/components/chat/use-chat-screen-data";
import { useChatScreenUiState } from "../src/components/chat/use-chat-screen-ui-state";

// The hook cells let the real chat controllers run without a native renderer.
const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  slot: 0,
  changed: false,
  effects: [] as (() => void)[],
}));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Keyboard: { dismiss: vi.fn() },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));
vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light" },
  impactAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
}));
vi.mock("react", () => {
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const slot = hooks.slot++;
    const previous = hooks.cells[slot] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
      hooks.cells[slot] = { deps, value: factory() };
    }
    return (hooks.cells[slot] as { value: unknown }).value;
  };
  return {
    useState: (initial: unknown) => {
      const slot = hooks.slot++;
      if (!(slot in hooks.cells)) hooks.cells[slot] = initial;
      return [
        hooks.cells[slot],
        (next: unknown) => {
          const value = typeof next === "function" ? next(hooks.cells[slot]) : next;
          if (value !== hooks.cells[slot]) hooks.changed = true;
          hooks.cells[slot] = value;
        },
      ];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useRef: (current: unknown) => memo(() => ({ current }), []),
    useEffect: (effect: () => void, deps: readonly unknown[]) =>
      memo(() => {
        hooks.effects.push(effect);
      }, deps),
  };
});

beforeEach(() => {
  hooks.cells = [];
  hooks.changed = false;
});

interface ChannelSummary {
  readonly id: string;
}

function setup() {
  const opened: string[] = [];
  const availability = { boards: true, notes: true };
  const runtime = {
    session: {
      openChannel: async (channel: ChannelSummary) => {
        opened.push(channel.id);
      },
    },
  };
  const channels: ChannelSummary[] = [{ id: "A" }, { id: "B" }];
  const render = (nextAvailability?: { boards: boolean; notes: boolean }) => {
    if (nextAvailability !== undefined) {
      availability.boards = nextAvailability.boards;
      availability.notes = nextAvailability.notes;
    }
    let ui: ReturnType<typeof useChatScreenUiState>;
    let navigation: ReturnType<typeof useChatScreenNavigation>;
    do {
      hooks.changed = false;
      hooks.slot = 0;
      hooks.effects = [];
      // biome-ignore lint/correctness/useHookAtTopLevel: this loop simulates native renders with stable hook cells.
      ui = useChatScreenUiState(availability);
      // biome-ignore lint/correctness/useHookAtTopLevel: this loop simulates native renders with stable hook cells.
      navigation = useChatScreenNavigation({
        ...ui,
        runtime,
        channels,
      } as unknown as ChatScreenData);
      for (const effect of hooks.effects) effect();
    } while (hooks.changed);
    return { ui, navigation };
  };
  return { render, opened };
}

it("restores A after A -> hub -> B -> Back -> Back and reopens A's session", () => {
  const { render, opened } = setup();
  let { ui, navigation } = render();

  ui.setActiveChannelId("A");
  ({ ui, navigation } = render());
  expect({ channel: ui.activeChannelId, pane: ui.pane }).toEqual({ channel: "A", pane: 1 });

  // Leave A for the hub, open B from it.
  ui.setPane(0);
  ({ ui } = render());
  expect(ui.pane).toBe(0);
  ui.setActiveChannelId("B");
  ui.setPane(1);
  ({ ui, navigation } = render());
  expect({ channel: ui.activeChannelId, pane: ui.pane }).toEqual({ channel: "B", pane: 1 });

  expect(navigation.handleBack()).toBe(true);
  expect(render().ui.pane).toBe(0);

  ({ ui, navigation } = render());
  expect(navigation.handleBack()).toBe(true);
  expect(render().ui).toMatchObject({ activeChannelId: "A", pane: 1 });
  expect(opened).toEqual(["A"]);
});

it("leaves a restored addon tab that was revoked mid-session", () => {
  const { render } = setup();
  let { ui, navigation } = render();
  ui.setHubTab("boards");
  ({ ui } = render());
  expect(ui.hubTab).toBe("boards");

  // Move on to chats, then the addon is revoked. Back still has the boards
  // frame in history; restoring it must not leave the settings fallback
  // rendered under a boards value the dock no longer offers.
  ui.setHubTab("chats");
  ({ ui, navigation } = render());
  ({ ui, navigation } = render({ boards: false, notes: true }));
  expect(navigation.handleBack()).toBe(true);
  ({ ui } = render({ boards: false, notes: true }));
  expect(ui.hubTab).toBe("chats");
});

it("normalizes a current addon tab when its permission disappears", () => {
  const { render } = setup();
  let { ui } = render();
  ui.setHubTab("notes");
  ({ ui } = render());
  expect(ui.hubTab).toBe("notes");

  ({ ui } = render({ boards: true, notes: false }));
  expect(ui.hubTab).toBe("chats");
});

it("restores the thread, quote and message jump that belonged to the conversation", () => {
  const { render, opened } = setup();
  let { ui, navigation } = render();
  const threadRoot = { id: "root", channelId: "A" } as never;
  const quote = { id: "quoted", channelId: "A" } as never;

  ui.setActiveChannelId("A");
  ui.setThreadRoot(threadRoot);
  ui.setQuote(quote);
  ui.setJumpToMessageId("jump-1");
  ({ ui } = render());
  ui.setPane(0);
  ({ ui } = render());
  ui.setActiveChannelId("B");
  ui.setThreadRoot(null);
  ui.setQuote(null);
  ui.setJumpToMessageId(null);
  ui.setPane(1);
  ({ ui, navigation } = render());

  expect(navigation.handleBack()).toBe(true);
  ({ ui, navigation } = render());
  expect(navigation.handleBack()).toBe(true);
  expect(render().ui).toMatchObject({
    activeChannelId: "A",
    threadRoot,
    quote,
    jumpToMessageId: "jump-1",
  });
  expect(opened).toEqual(["A"]);
});

it("returns from an addon to its chooser before the prior hub tab", () => {
  const { render } = setup();
  let { ui, navigation } = render();
  ui.setPane(0);
  ({ ui } = render());
  ui.setHubTab("addons");
  ({ ui } = render());
  ui.setHubTab("notes");
  ({ ui, navigation } = render());
  expect(navigation.handleBack()).toBe(true);
  ({ ui, navigation } = render());
  expect(ui.hubTab).toBe("addons");
  expect(navigation.handleBack()).toBe(true);
  expect(render().ui.hubTab).toBe("chats");
});
