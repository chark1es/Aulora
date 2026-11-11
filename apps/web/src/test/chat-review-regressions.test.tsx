import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { Composer } from "../components/chat/Composer";
import { AttachmentSizeError } from "../lib/attachments";
import { createChatRuntime } from "../lib/chat-runtime";
import { convexPort, convexSubscriptions } from "../lib/convex-chat";
import { DraftScopeContext, draftScope, readDraft, scopedDraftKey } from "../lib/drafts";

const base = { channelId: "c1", members: [], roles: [], memberIds: [], onTyping: vi.fn() };
const scope = draftScope("https://server.example/path", "alice");
function composer(onSend: () => Promise<void>, account = scope, channelId = "c1") {
  return createElement(
    DraftScopeContext.Provider,
    { value: account },
    createElement(Composer, { ...base, channelId, draftKey: channelId, onSend }),
  );
}
it("flushes last keystrokes on switch and isolates drafts by account and origin", () => {
  localStorage.clear();
  const send = vi.fn(async () => undefined);
  const view = render(composer(send));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "unfinished" } });
  view.rerender(composer(send, scope, "c2"));
  expect(screen.getByRole("combobox")).toHaveValue("");
  expect(readDraft(scopedDraftKey(scope, "c1") ?? "")).toBe("unfinished");
  for (const other of [
    draftScope("https://server.example", "bob"),
    draftScope("https://other.example", "alice"),
  ]) {
    view.rerender(composer(send, other));
    expect(screen.getByRole("combobox")).toHaveValue("");
  }
  view.rerender(composer(send));
  expect(screen.getByRole("combobox")).toHaveValue("unfinished");
});
it("keeps text and files on failure and clears only after acceptance", async () => {
  localStorage.clear();
  let accept: (() => void) | undefined;
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("Upload failed"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
  const view = render(composer(send));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "keep me" } });
  fireEvent.drop(window, {
    dataTransfer: { files: [new File(["test"], "draft.txt")], types: ["Files"] },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Message not sent. Your text is still here.",
  );
  expect(screen.getByRole("combobox")).toHaveValue("keep me");
  expect(screen.getByTestId("composer-attachments")).toHaveTextContent("draft.txt");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("combobox")).toHaveValue("keep me");
  await act(async () => {
    accept?.();
  });
  expect(screen.getByRole("combobox")).toHaveValue("");
  view.unmount();
  expect(readDraft(scopedDraftKey(scope, "c1") ?? "")).toBe("");
});
it("forwards channel and category mentions", async () => {
  const mutation = vi.fn(async (_query: unknown, _args: unknown) => "message");
  await convexPort({ mutation } as unknown as ConvexReactClient).sendMessage({
    channelId: "c1",
    body: "hello",
    mentionChannelIds: ["c2"],
    mentionCategoryIds: ["cat"],
  });
  expect(mutation.mock.calls[0]?.[1]).toMatchObject({
    mentionChannelIds: ["c2"],
    mentionCategoryIds: ["cat"],
  });
});
it.each(["channels", "timeline"])("reports primary %s subscription update errors", (kind) => {
  let update: () => void = () => undefined;
  let failed = false;
  const error = new Error("Access denied");
  const client = {
    watchQuery: () => ({
      localQueryResult: () => {
        if (failed) throw error;
        return undefined;
      },
      onUpdate: (callback: () => void) => {
        update = callback;
        return vi.fn();
      },
    }),
  } as unknown as ConvexReactClient;
  const onError = vi.fn();
  const subscriptions = convexSubscriptions(client, onError);
  if (kind === "channels") subscriptions.watchChannels(vi.fn());
  else subscriptions.watchMessages("c1", vi.fn());
  failed = true;
  expect(() => update()).not.toThrow();
  expect(onError).toHaveBeenCalledWith(error);
});
it("uses thread page cursors and keeps runtime thread errors local", async () => {
  let update: () => void = () => undefined;
  let failed = false;
  const page = { page: [], isDone: false, continueCursor: "page2" };
  const watchQuery = vi.fn((_query: unknown, args: { threadRootId?: string }) => ({
    localQueryResult: () => {
      if (failed) throw new Error("offline");
      return args.threadRootId === undefined ? undefined : page;
    },
    onUpdate: (callback: () => void) => {
      update = callback;
      return vi.fn();
    },
  }));
  const onError = vi.fn();
  const runtime = await createChatRuntime({
    client: { watchQuery, mutation: vi.fn(async () => ({})) } as unknown as ConvexReactClient,
    userId: "alice",
    displayName: "Alice",
    onError,
  });
  const onPage = vi.fn();
  const off = runtime.watchThread("root", vi.fn(), { cursor: "page2", onPage });
  expect(watchQuery.mock.calls.at(-1)?.[1]).toMatchObject({
    paginationOpts: { numItems: 100, cursor: "page2" },
  });
  expect(onPage).toHaveBeenCalledWith(page);
  failed = true;
  expect(() => update()).not.toThrow();
  expect(onError).not.toHaveBeenCalled();
  off();
  runtime.setPresenceScope?.(["alice"]);
  const offPresence = runtime.subscriptions.watchPresence(vi.fn());
  expect(onError).not.toHaveBeenCalled();
  offPresence();
  runtime.session.dispose();
});

it("does not clear a new draft after leaving and returning during a pending send", async () => {
  localStorage.clear();
  let accept: (() => void) | undefined;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  const view = render(composer(send));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "old draft" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  view.rerender(composer(send, scope, "c2"));
  view.rerender(composer(send));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "new draft" } });
  // Switching away flushes the new draft before the old request resolves.
  view.rerender(composer(send, scope, "c2"));
  await act(async () => {
    accept?.();
  });
  expect(readDraft(scopedDraftKey(scope, "c1") ?? "")).toBe("new draft");
  view.rerender(composer(send));
  expect(screen.getByRole("combobox")).toHaveValue("new draft");
});

it("keeps reaction, typing, read state, and presence errors out of the provider", () => {
  const onError = vi.fn();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = {
    watchQuery: () => ({
      localQueryResult: () => {
        throw new Error("denied");
      },
      onUpdate: () => vi.fn(),
    }),
  } as unknown as ConvexReactClient;
  const subscriptions = convexSubscriptions(client, onError);
  subscriptions.watchReactions("m", vi.fn());
  subscriptions.watchTyping("c", vi.fn());
  subscriptions.watchReadState("c", vi.fn());
  subscriptions.watchPresence(vi.fn());
  expect(onError).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it.each([false, true])(
  "clears a remounted submitted draft unless edited (edited=%s)",
  async (edited) => {
    localStorage.clear();
    let accept: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const view = render(composer(send));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pending" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    view.rerender(composer(send, scope, "c2"));
    view.rerender(composer(send));
    expect(screen.getByRole("combobox")).toHaveValue("pending");
    if (edited) fireEvent.change(screen.getByRole("combobox"), { target: { value: "new draft" } });
    await act(async () => {
      accept?.();
    });
    expect(screen.getByRole("combobox")).toHaveValue(edited ? "new draft" : "");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readDraft(scopedDraftKey(scope, "c1") ?? "")).toBe(edited ? "new draft" : "");
  },
);

it("removes only attachments submitted before an in-flight send", async () => {
  let accept: (() => void) | undefined;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  render(composer(send));
  const drop = (name: string) =>
    fireEvent.drop(window, {
      dataTransfer: { files: [new File(["test"], name)], types: ["Files"] },
    });
  drop("sent.txt");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  drop("new.txt");
  await act(async () => {
    accept?.();
  });
  expect(screen.getByTestId("composer-attachments")).toHaveTextContent("new.txt");
  expect(screen.getByTestId("composer-attachments")).not.toHaveTextContent("sent.txt");
});

it.each(["Missing permission", "Channel not found", "Not a channel member"])(
  "closes unavailable channels and recovers subscriptions: %s",
  async (reason) => {
    let update = () => {};
    let result: "error" | "closed" | "success" = "error";
    const onError = vi.fn();
    const onChange = vi.fn();
    const page = { page: [], isDone: true, continueCursor: "" };
    const client = {
      watchQuery: () => ({
        localQueryResult: () => {
          if (result === "error") throw new Error("offline");
          if (result === "closed") throw new ConvexError(reason);
          return page;
        },
        onUpdate: (callback: () => void) => {
          update = callback;
          return vi.fn();
        },
      }),
      mutation: vi.fn(async () => ({})),
    } as unknown as ConvexReactClient;
    const off = convexSubscriptions(client, onError).watchMessages("c1", onChange);
    expect(onError.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
    result = "closed";
    update();
    expect(onError.mock.calls.at(-1)).toEqual([null]);
    expect(onChange).toHaveBeenLastCalledWith([]);
    result = "success";
    update();
    expect(onError.mock.calls.at(-1)).toEqual([null]);
    off();
    result = "success";
    const runtime = await createChatRuntime({
      client,
      userId: "alice",
      displayName: "Alice",
      onError,
    });
    result = "error";
    const stop = runtime.watchChannelMessages("c1", onChange);
    expect(onError.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
    result = "closed";
    update();
    expect(onChange).toHaveBeenLastCalledWith(page);
    expect(onError.mock.calls.at(-1)).toEqual([null]);
    result = "success";
    update();
    expect(onError.mock.calls.at(-1)).toEqual([null]);
    stop();
    runtime.session.dispose();
  },
);

it.each(["Retry", "Dismiss send error"])(
  "returns focus to the composer after %s",
  async (label) => {
    localStorage.clear();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("internal trace"))
      .mockResolvedValueOnce(undefined);
    render(composer(send));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "keep me" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    const button = await screen.findByRole("button", { name: label });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("combobox")).toHaveFocus();
    await waitFor(() => expect(screen.queryByTestId("composer-send-error")).toBeNull());
  },
);
it.each([
  [new AttachmentSizeError("clip.mov", 2000, 1000), "clip.mov is 2.0 KiB, over the 1000 B limit."],
  [new Error("permission denied"), "You don’t have permission"],
  [new TypeError("Failed to fetch"), "Check your connection"],
  [new ConvexError("This channel is read-only"), "This channel is read-only"],
])("shows a safe send failure reason", async (cause, expected) => {
  localStorage.clear();
  render(composer(vi.fn().mockRejectedValue(cause)));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "keep me" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(expected);
});
it("shows a silent character count", () => {
  localStorage.clear();
  render(composer(vi.fn()));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "a".repeat(3601) } });
  const counter = screen.getByText(/3601/);
  expect(counter).not.toHaveAttribute("role");
  expect(counter).not.toHaveAttribute("aria-live");
});

it("preserves overlong pasted text and explains why Send is disabled", () => {
  localStorage.clear();
  const send = vi.fn();
  render(composer(send));
  const text = "x".repeat(4001);
  const input = screen.getByRole("combobox");
  expect(input).not.toHaveAttribute("maxlength");
  fireEvent.change(input, { target: { value: text } });
  expect(input).toHaveValue(text);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Message is over 4,000 characters. Trim it or split it.",
  );
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "short" } });
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});
