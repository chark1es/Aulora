import { debugLog } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import { act, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatSessionShell } from "../components/chat/ChatSessionShell";
import { QueryErrorBoundary } from "../components/QueryErrorBoundary";

// Keep the real shell, provider and Convex subscription adapter together;
// the canvas itself is unrelated to subscription startup.
vi.mock("../components/chat/ChatView", () => ({
  ChatView: () => <div>Workspace ready</div>,
}));

const fixture = vi.hoisted(() => ({
  desktop: true,
  channelError: null as Error | null,
  me: { member: { userId: "u1", name: "Alice", roleIds: [], role: "member" }, isOwner: false },
  page: { page: [], isDone: true, continueCursor: "" },
  empty: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name === "members:me") return fixture.me;
    if (name === "channels:list" || name === "channels:listDms") return fixture.page;
    if (name === "server:publicConfig") return { features: {}, capabilities: {}, addons: {} };
    if (name === "notifications:getPrefs") return {};
    return fixture.empty;
  },
  useMutation: () => async () => null,
  useAction: () => async () => null,
  usePaginatedQuery: () => ({ results: fixture.empty, status: "Exhausted", loadMore: () => {} }),
  useConvex: () => client,
}));
vi.mock("../lib/desktop", async (original) => ({
  ...(await original<typeof import("../lib/desktop")>()),
  isDesktop: () => fixture.desktop,
}));
vi.mock("../lib/outbox-store", () => ({
  webOutboxStore: () => ({ readAll: async () => [], put: async () => {}, delete: async () => {} }),
}));
vi.mock("../lib/search-store", () => ({
  webSearchStore: () => ({ readAll: async () => [], put: async () => {}, delete: async () => {} }),
}));
const client = {
  url: "https://chat.example.test",
  watchQuery: (ref: Parameters<typeof getFunctionName>[0]) => ({
    localQueryResult: () => {
      if (getFunctionName(ref) !== "channels:list") return undefined;
      if (fixture.channelError !== null) throw fixture.channelError;
      return fixture.page;
    },
    onUpdate: () => () => {},
  }),
  subscribeToConnectionState: () => () => {},
  mutation: async () => null,
  query: async () => [],
} as unknown as ConvexReactClient;

beforeEach(() => {
  fixture.channelError = null;
  debugLog.clear();
});

function workspace() {
  return (
    <ContextMenuProvider>
      <QueryErrorBoundary client={client} onSignOut={() => {}}>
        <ChatSessionShell
          client={client}
          workspaceName="Acme"
          workspaceIconSeed="acme"
          user={{ id: "u1", name: "Alice" }}
          onSignOut={() => {}}
        />
      </QueryErrorBoundary>
    </ContextMenuProvider>
  );
}

it.each([true, false])(
  "accepts the initial channel list after sign-in (desktop: %s)",
  async (desktop) => {
    fixture.desktop = desktop;
    render(workspace());
    await act(async () => {
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    });
    expect(
      screen.queryByText("Something went wrong"),
      debugLog.report("test", ""),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Workspace ready")).toBeInTheDocument();
    expect(debugLog.snapshot().filter((entry) => entry.source === "query.error")).toHaveLength(0);
  },
);

it("still reports and displays real channel subscription failures", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.channelError = new Error("Channel access denied");
  try {
    render(workspace());
    await act(async () => {
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      debugLog
        .snapshot()
        .some(
          (entry) =>
            entry.source === "query.error" && entry.detail.includes("Channel access denied"),
        ),
    ).toBe(true);
  } finally {
    consoleError.mockRestore();
  }
});
