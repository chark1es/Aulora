import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profiles: [] as Array<{ id: string }>,
  activeProfile: undefined as { id: string } | undefined,
  resolve: vi.fn(),
  setActive: vi.fn(async (_id: string) => undefined),
  replace: vi.fn(),
  record: vi.fn(),
  clear: vi.fn(),
  target: vi.fn(),
  received: [] as Array<(notification: unknown) => void>,
  opened: [] as Array<(response: unknown) => void>,
}));

vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (listener: (notification: unknown) => void) => {
    state.received.push(listener);
    return { remove: () => undefined };
  },
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    state.opened.push(listener);
    return { remove: () => undefined };
  },
  getLastNotificationResponseAsync: async () => null,
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("../src/providers/ProfileProvider", () => ({
  useProfiles: () => ({
    profiles: state.profiles,
    activeProfile: state.activeProfile,
    ready: true,
    setActive: state.setActive,
  }),
}));
vi.mock("../src/lib/workspace-identity", () => ({
  backfillWorkspaceServerId: async () => null,
  clearWorkspaceUnread: state.clear,
  ensureWorkspaceNotificationsLoaded: async () => undefined,
  profileForServerId: () => undefined,
  readWorkspaceNotificationHint: (data: unknown) => data,
  recordWorkspaceUnread: state.record,
  resolveWorkspaceProfile: (...args: unknown[]) => state.resolve(...args),
  setWorkspaceNotificationTarget: state.target,
  subscribeWorkspaceUnread: () => () => undefined,
  workspaceServerIdForProfile: () => undefined,
  workspaceUnreadSnapshot: () => new Map(),
}));

import { useWorkspaceNotifications } from "../src/lib/use-workspace-notifications";

const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  slot: 0,
  changed: false,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<() => void>,
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
    useSyncExternalStore: (
      _subscribe: unknown,
      getSnapshot: () => unknown,
      _getServerSnapshot: () => unknown,
    ) => getSnapshot(),
    useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
      const slot = hooks.slot++;
      const previous = hooks.cells[slot] as
        | { deps: readonly unknown[]; cleanup?: () => void }
        | undefined;
      if (previous && deps.every((dep, index) => dep === previous.deps[index])) {
        return;
      }
      if (previous?.cleanup !== undefined) hooks.cleanups.push(previous.cleanup);
      const cell: { deps: readonly unknown[]; cleanup?: () => void } = { deps };
      hooks.cells[slot] = cell;
      hooks.effects.push(() => {
        const cleanup = effect();
        if (typeof cleanup === "function") cell.cleanup = cleanup as () => void;
      });
    },
  };
});

function renderHook(): void {
  do {
    hooks.changed = false;
    hooks.slot = 0;
    hooks.effects = [];
    // biome-ignore lint/correctness/useHookAtTopLevel: this loop simulates native renders with stable hook cells.
    useWorkspaceNotifications();
    for (const cleanup of hooks.cleanups) cleanup();
    hooks.cleanups = [];
    for (const effect of hooks.effects) effect();
  } while (hooks.changed);
}

function notification(identifier: string, serverId: string) {
  return {
    request: {
      identifier,
      content: {
        data: { serverId, channelId: "channel-1", messageId: "message-1", kind: "message" },
      },
    },
  };
}

beforeEach(() => {
  state.profiles = [{ id: "A" }, { id: "B" }];
  state.activeProfile = { id: "A" };
  state.resolve.mockReset();
  state.setActive.mockClear();
  state.replace.mockClear();
  state.record.mockClear();
  state.clear.mockClear();
  state.target.mockClear();
  state.received = [];
  state.opened = [];
  hooks.cells = [];
  hooks.cleanups = [];
  hooks.changed = false;
});

it("retries an opened notification after transient identity resolution fails", async () => {
  const globex = { id: "B" };
  state.resolve.mockResolvedValueOnce(undefined).mockResolvedValue(globex);
  renderHook();

  const wake = notification("opened-1", "srv-b");
  state.opened.at(-1)?.({ notification: wake });
  await vi.waitFor(() => expect(state.resolve).toHaveBeenCalledTimes(1));
  expect(state.setActive).not.toHaveBeenCalled();

  // Profiles hydrate/refresh: the effect reruns instead of the id being spent.
  state.profiles = [{ id: "A" }, { id: "B" }];
  renderHook();
  await vi.waitFor(() => expect(state.setActive).toHaveBeenCalledWith("B"));
  expect(state.target).toHaveBeenCalledWith("B", "channel-1", "message-1", "message");
  expect(state.replace).toHaveBeenCalledWith("/");
  expect(state.resolve).toHaveBeenCalledTimes(2);
});

it("keeps a wake queued when the effect is cancelled during identity resolution", async () => {
  const globex = { id: "B" };
  let finishFirst: ((profile: typeof globex | undefined) => void) | undefined;
  state.resolve.mockImplementationOnce(
    () =>
      new Promise<typeof globex | undefined>((resolve) => {
        finishFirst = resolve;
      }),
  );
  state.resolve.mockResolvedValue(globex);
  renderHook();

  state.opened.at(-1)?.({ notification: notification("opened-2", "srv-b") });
  await vi.waitFor(() => expect(state.resolve).toHaveBeenCalledTimes(1));

  // A profile/auth change replaces the effect while the fetch is in flight.
  state.profiles = [{ id: "A" }, { id: "B" }];
  renderHook();
  finishFirst?.(globex);
  await Promise.resolve();
  await Promise.resolve();

  // The cancelled attempt queues the wake; the next effect run routes it.
  state.profiles = [{ id: "A" }, { id: "B" }];
  renderHook();
  await vi.waitFor(() => expect(state.setActive).toHaveBeenCalledWith("B"));
  expect(state.resolve).toHaveBeenCalledTimes(2);
  expect(state.target).toHaveBeenCalledWith("B", "channel-1", "message-1", "message");
});

it("counts a received wake once across retries and duplicate delivery", async () => {
  const globex = { id: "B" };
  state.resolve.mockResolvedValueOnce(undefined).mockResolvedValue(globex);
  renderHook();

  const wake = notification("received-1", "srv-b");
  state.received.at(-1)?.(wake);
  await vi.waitFor(() => expect(state.resolve).toHaveBeenCalledTimes(1));
  expect(state.record).not.toHaveBeenCalled();

  state.profiles = [{ id: "A" }, { id: "B" }];
  renderHook();
  await vi.waitFor(() => expect(state.setActive).toHaveBeenCalledWith("B"));
  expect(state.record).toHaveBeenCalledTimes(1);

  // A replayed foreground receipt is already processed.
  state.received.at(-1)?.(wake);
  await Promise.resolve();
  expect(state.record).toHaveBeenCalledTimes(1);
});
