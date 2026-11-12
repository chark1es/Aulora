import {
  type ChatPort,
  ChatSession,
  type ChatSubscriptions,
  type MessagePayload,
  type StoredFileView,
} from "@aulora/core";
import { expect, it, vi } from "vitest";
import type { ChatSurfaceRuntime } from "../src/lib/chat-surface";
import { watchThreadFeed } from "../src/lib/thread-feed";

function reply(id: string, attachmentIds: string[] = []): MessagePayload {
  return {
    id,
    channelId: "channel",
    authorId: "alice",
    body: id,
    threadRootId: "root",
    replyToId: null,
    attachmentIds,
    mentionUserIds: [],
    createdAt: 1,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
  };
}

function harness(session: ChatSession, rootId = "root") {
  const windows: {
    emit: (rows: readonly MessagePayload[]) => void;
    page: (cursor: string | null) => void;
    off: ReturnType<typeof vi.fn>;
    error: () => void;
    cursor: string | null;
  }[] = [];
  const watchThread: ChatSurfaceRuntime["watchThread"] = (_id, emit, options) => {
    const off = vi.fn();
    windows.push({
      emit,
      page: options?.onPage ?? (() => undefined),
      off,
      error: () => options?.onError?.(new Error("offline")),
      cursor: options?.cursor ?? null,
    });
    return off;
  };
  const seen: string[][] = [];
  const onPage = vi.fn();
  const onStatus = vi.fn();
  const feed = watchThreadFeed(
    { session, watchThread },
    rootId,
    (rows) => seen.push(rows.map((r) => r.id)),
    onPage,
    onStatus,
  );
  return { windows, seen, feed, onPage, onStatus };
}

const files: StoredFileView[] = [
  {
    id: "file",
    uploaderId: "alice",
    sizeBytes: 1,
    name: "report.pdf",
    mime: "application/pdf",
    dimensions: null,
    blurhash: null,
    url: null,
  },
];

function session(getFiles: ChatPort["getFiles"] = async () => []) {
  return ChatSession.create({
    port: { getFiles } as unknown as ChatPort,
    subscriptions: {} as ChatSubscriptions,
  });
}

it("ignores a first-page hydration completion after a combined snapshot has rendered", async () => {
  let resolveMetadata!: (files: StoredFileView[]) => void;
  const metadata = new Promise<StoredFileView[]>((resolve) => {
    resolveMetadata = resolve;
  });
  const getFiles = vi.fn(() => metadata);
  const chat = session(getFiles);
  const { windows, seen, feed } = harness(chat);
  const first = reply("first", ["file"]);
  windows[0]?.emit([first]);
  // Both snapshots share the lookup; the newest waits for the retained file.
  windows[0]?.emit([first, reply("second")]);
  await Promise.resolve();
  expect(seen).toEqual([]);
  resolveMetadata(files);
  await metadata;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await vi.waitFor(() => expect(seen).toEqual([["first", "second"]]));
  expect(chat.attachmentsFor("first")[0]?.fileId).toBe("file");
  expect(getFiles).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([["first", "second"]]);
  feed.stop();
});

it("retains earlier windows, deduplicates boundaries, and keeps the loaded tail live", async () => {
  const { windows, seen, feed, onPage } = harness(session());
  windows[0]?.emit([reply("first"), reply("boundary")]);
  windows[0]?.page("next");
  feed.loadMore();
  expect(windows).toHaveLength(2);
  windows[1]?.emit([reply("boundary"), reply("second")]);
  windows[1]?.page(null);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["first", "boundary", "second"]));
  windows[1]?.emit([reply("boundary"), reply("second"), reply("new")]);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["first", "boundary", "second", "new"]));
  expect(onPage).toHaveBeenLastCalledWith(null);
  feed.stop();
  expect(windows.every((window) => window.off.mock.calls.length === 1)).toBe(true);
  windows[1]?.emit([reply("after-close")]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen.at(-1)).toEqual(["first", "boundary", "second", "new"]);
});

it("keeps the cursor while loading, blocks duplicate requests, and retries a failed window", async () => {
  const { windows, seen, feed, onPage, onStatus } = harness(session());
  windows[0]?.emit([reply("first")]);
  windows[0]?.page("next");
  feed.loadMore();
  expect(onStatus).toHaveBeenLastCalledWith({ loading: true, error: false });
  expect(onPage).toHaveBeenLastCalledWith("next");
  feed.loadMore();
  expect(windows).toHaveLength(2);
  windows[1]?.error();
  expect(onStatus).toHaveBeenLastCalledWith({ loading: false, error: true });
  feed.loadMore();
  expect(windows[1]?.off).toHaveBeenCalledOnce();
  expect(windows[2]?.cursor).toBe("next");
  windows[2]?.emit([reply("second")]);
  windows[2]?.page(null);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["first", "second"]));
  expect(onStatus).toHaveBeenLastCalledWith({ loading: false, error: false });
  expect(onPage).toHaveBeenLastCalledWith(null);
  feed.stop();
});

it("retries a failure in the initial window", () => {
  const { windows, feed, onStatus } = harness(session());
  windows[0]?.error();
  feed.loadMore();
  expect(windows[1]?.cursor).toBeNull();
  windows[1]?.page("next");
  expect(onStatus).toHaveBeenLastCalledWith({ loading: false, error: false });
  feed.stop();
});

it.each(["edit", "delete"])("does not re-index an older thread snapshot after %s", async (kind) => {
  let release!: (files: StoredFileView[]) => void;
  const metadata = new Promise<StoredFileView[]>((resolve) => {
    release = resolve;
  });
  const chat = session(() => metadata);
  const notifications: string[] = [];
  chat.onDecrypted((rows) => {
    for (const row of rows) {
      notifications.push(row.deletedAt === null ? chat.decryptedText(row.id) : "deleted");
    }
  });
  const { windows, feed } = harness(chat);
  const original = { ...reply("r", ["file"]), body: "old body" };
  windows[0]?.emit([original]);
  windows[0]?.emit([
    kind === "edit"
      ? { ...original, body: "edited body", editedAt: 2 }
      : { ...original, body: "", attachmentIds: [], deletedAt: 2 },
  ]);
  if (kind === "edit") {
    await Promise.resolve();
    expect(notifications).toEqual([]);
  } else {
    await vi.waitFor(() => expect(notifications).toEqual(["deleted"]));
  }
  release(files);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(chat.attachmentsFor("r").map((file) => file.fileId)).toEqual(
    kind === "edit" ? ["file"] : [],
  );
  expect(chat.decryptedText("r")).toBe(kind === "edit" ? "edited body" : "");
  expect(notifications).toEqual([kind === "edit" ? "edited body" : "deleted"]);
  feed.stop();
});

it("isolates concurrent thread feeds, including an empty snapshot", async () => {
  let release!: (files: StoredFileView[]) => void;
  const metadata = new Promise<StoredFileView[]>((resolve) => {
    release = resolve;
  });
  const chat = session(() => metadata);
  const first = harness(chat, "root-a");
  const second = harness(chat, "root-b");
  first.windows[0]?.emit([{ ...reply("a", ["file"]), threadRootId: "root-a" }]);
  second.windows[0]?.emit([{ ...reply("b", ["file"]), threadRootId: "root-b" }]);
  first.windows[0]?.emit([]);
  await vi.waitFor(() => expect(first.seen).toEqual([[]]));
  release(files);
  await vi.waitFor(() => expect(second.seen).toEqual([["b"]]));
  expect(first.seen).toEqual([[]]);
  expect(chat.decryptedBody("a")).toBeUndefined();
  expect(chat.decryptedText("b")).toBe("b");
  expect(chat.attachmentsFor("b")[0]?.fileId).toBe("file");
  first.feed.stop();
  second.feed.stop();
});
