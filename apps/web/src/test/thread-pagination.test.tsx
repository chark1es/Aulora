import type { MessagePayload } from "@aulora/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ThreadsPanel } from "../components/chat/ThreadsPanel";
import type { ChatRuntime } from "../lib/chat-runtime";

vi.mock("../components/chat/Composer", () => ({ Composer: () => null }));
vi.mock("../components/chat/MessageList", () => ({
  MessageList: ({ messages }: { messages: MessagePayload[] }) => (
    <div>
      {messages.map((message) => (
        <span key={message.id}>{message.id}</span>
      ))}
    </div>
  ),
}));
type WatchOptions = {
  cursor: string | null;
  onPage: (page: unknown) => void;
  onError?: () => void;
};

/** A paged `watchThread` stub: the first 2,000 replies arrive at once, later pages on demand. */
function createPagedThreadWatch(total: number) {
  const updates: ((messages: MessagePayload[]) => void)[] = [];
  const off = vi.fn();
  const pendingPages: (() => void)[] = [];
  let failOnce = true;
  const watchThread = vi.fn(
    (_id: string, onChange: (messages: MessagePayload[]) => void, options: WatchOptions) => {
      const offset = Number(options.cursor ?? 0);
      const page = Array.from(
        { length: Math.min(100, total - offset) },
        (_, i) => ({ id: `reply-${offset + i}` }) as MessagePayload,
      );
      updates.push(onChange);
      const deliver = () => {
        if (offset === 2000 && failOnce) {
          failOnce = false;
          options.onError?.();
          return;
        }
        onChange(page);
        options.onPage({
          page,
          isDone: offset + page.length >= total,
          continueCursor: String(offset + 100),
        });
      };
      if (offset >= 2000) pendingPages.push(deliver);
      else deliver();
      return off;
    },
  );
  return { updates, off, pendingPages, watchThread };
}

function renderThread(runtime: ChatRuntime, root = { id: "root" } as MessagePayload) {
  return render(
    <ThreadsPanel
      runtime={runtime}
      channelId="c1"
      channelTitle="general"
      root={root}
      rootText="root"
      members={[]}
      roles={[]}
      memberIds={[]}
      permissions={0n}
      maxUploadBytes={1000}
      ownUserId="me"
      ownName="Me"
      memberNames={new Map()}
      memberColors={new Map()}
      mentionNames={[]}
      onClose={vi.fn()}
      onTyping={vi.fn()}
      onSendReply={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onPinToggle={vi.fn()}
      onReact={vi.fn()}
    />,
  );
}

/** Loads the pages beyond the 2,000-reply window, retrying the first one that fails. */
async function loadPagesBeyondWindow(total: number, pendingPages: (() => void)[]) {
  expect(screen.queryByText("reply-2000")).toBeNull();
  for (let offset = 2000; offset < total; offset += 100) {
    fireEvent.click(screen.getByRole("button", { name: "Load more replies" }));
    expect(screen.getByRole("button", { name: "Load more replies" })).toBeDisabled();
    await act(async () => pendingPages.shift()?.());
    if (offset === 2000) {
      expect(screen.getByRole("alert")).toHaveTextContent("Replies couldn’t load");
      expect(screen.getByRole("button", { name: "Load more replies" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Load more replies" }));
      await act(async () => pendingPages.shift()?.());
    }
    await screen.findByText(`reply-${offset}`);
  }
}

it.each([1, 101, 2001])(
  "follows the live reply tail with a bounded page window (%i replies)",
  async (total) => {
    const watch = createPagedThreadWatch(total);
    const receiveMessages = vi.fn(
      async (_messages: readonly MessagePayload[], _scopeId: string) => undefined,
    );
    const runtime = {
      watchThread: watch.watchThread,
      session: { receiveMessages, decryptedText: () => "", attachmentsFor: () => [] },
    } as unknown as ChatRuntime;
    renderThread(runtime, { id: "root", replyCount: total } as MessagePayload);
    const summary = total === 1 ? "1 reply ·" : `${total} replies`;
    expect(screen.getByText((content) => content.includes(summary))).toBeInTheDocument();
    const expectedPages = Math.min(20, Math.ceil(total / 100));
    await waitFor(() => expect(watch.watchThread).toHaveBeenCalledTimes(expectedPages));
    expect(watch.off).not.toHaveBeenCalled();
    if (total > 2000) await loadPagesBeyondWindow(total, watch.pendingPages);
    expect(await screen.findByText(`reply-${total - 1}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more replies" })).toBeNull();
    await act(async () => {
      watch.updates.at(-1)?.([{ id: "new-own-reply" } as MessagePayload]);
    });
    expect(await screen.findByText("new-own-reply")).toBeInTheDocument();
    expect(receiveMessages.mock.calls.every((call) => call[1] === "thread:root")).toBe(true);
    const lastSnapshot = receiveMessages.mock.lastCall?.[0] as MessagePayload[] | undefined;
    expect(lastSnapshot?.some((message) => message.id === "new-own-reply")).toBe(true);
    if (total > 100) expect(lastSnapshot?.some((message) => message.id === "reply-0")).toBe(true);
    if (total <= 2000) expect(watch.off).not.toHaveBeenCalled();
  },
);

it("keeps the latest snapshot when earlier attachment metadata resolves last", async () => {
  let onChange: (messages: MessagePayload[]) => void = () => undefined;
  const resolvers: (() => void)[] = [];
  const getFiles = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
  const runtime = {
    watchThread: vi.fn((_id, receive) => {
      onChange = receive;
      return vi.fn();
    }),
    session: {
      receiveMessages: async () => {
        await getFiles();
      },
      decryptedText: () => "",
      attachmentsFor: () => [],
    },
  } as unknown as ChatRuntime;
  renderThread(runtime);
  act(() => {
    onChange([{ id: "older" } as MessagePayload]);
  });
  act(() => {
    onChange([{ id: "older" }, { id: "newest" }] as MessagePayload[]);
  });
  await act(async () => resolvers[1]?.());
  expect(screen.getByText("newest")).toBeInTheDocument();
  await act(async () => resolvers[0]?.());
  expect(screen.getByText("newest")).toBeInTheDocument();
  expect(getFiles).toHaveBeenCalledTimes(2);
});

it("retries a middle page without replacing the live tail or its next cursor", async () => {
  type PageWatch = {
    receive: (messages: MessagePayload[]) => void;
    onError: () => void;
    onPage: (page: { isDone: boolean; continueCursor: string }) => void;
  };
  const watches = new Map<string | null, PageWatch>();
  const runtime = {
    watchThread: vi.fn((_id, receive, options) => {
      watches.set(options.cursor, { receive, ...options });
      return vi.fn();
    }),
    session: {
      receiveMessages: async () => undefined,
      decryptedText: () => "",
      attachmentsFor: () => [],
    },
  } as unknown as ChatRuntime;
  renderThread(runtime);
  for (const [cursor, next, id] of [
    [null, "middle", "first"],
    ["middle", "tail", "middle"],
    ["tail", "next", "tail"],
  ] as const) {
    await act(async () => {
      watches.get(cursor)?.receive([{ id } as MessagePayload]);
      watches.get(cursor)?.onPage({ isDone: cursor === "tail", continueCursor: next });
    });
  }
  await act(async () => watches.get("middle")?.onError());
  fireEvent.click(screen.getByRole("button", { name: "Load more replies" }));
  await act(async () => {
    watches.get("middle")?.receive([{ id: "retried-middle" } as MessagePayload]);
    watches.get("middle")?.onPage({ isDone: false, continueCursor: "tail" });
  });
  expect(screen.getByText("retried-middle")).toBeInTheDocument();
  expect(screen.getByText("tail")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more replies" })).toBeNull();
  await act(async () => {
    watches.get("tail")?.receive([{ id: "live-tail" } as MessagePayload]);
    watches.get("tail")?.onPage({ isDone: false, continueCursor: "next" });
  });
  // The tail's cursor remains authoritative; only its next page is subscribed.
  expect(watches.has("next")).toBe(true);
  expect(screen.getByText("retried-middle")).toBeInTheDocument();
  expect(screen.getByText("live-tail")).toBeInTheDocument();
});
