import { readFileSync } from "node:fs";
import {
  BROADCAST_FALLBACK_NOTE,
  type MessagePayload,
  reportBroadcastFallback,
} from "@aulora/core";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Composer } from "../components/chat/Composer";
import { NotificationsSettingsSection } from "../components/chat/NotificationsSettingsSection";
import type { ChatRuntime } from "../lib/chat-runtime";
import { useDesktopNotifications } from "../lib/use-desktop-notifications";

it("notifies direct mentions despite suppressed broadcasts, with the broadcast title", () => {
  let receive!: (messages: readonly MessagePayload[]) => void;
  const notification = vi.fn();
  vi.stubGlobal(
    "Notification",
    Object.assign(
      class {
        constructor(title: string, options: unknown) {
          notification(title, options);
        }
      },
      { permission: "granted" },
    ),
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const runtime = {
    client: {
      watchQuery: () => ({
        localQueryResult: () => [{ scope: "server", channelId: null, suppressMassMentions: true }],
        onUpdate: () => () => {},
      }),
    },
    session: {
      onDecrypted: (fn: typeof receive) => {
        receive = fn;
        return () => {};
      },
      decryptedText: () => "@everyone @Ada",
    },
  } as unknown as ChatRuntime;
  const { unmount } = renderHook(() =>
    useDesktopNotifications(runtime, "viewer", new Map([["c", "general"]])),
  );
  act(() => receive([]));
  const message = {
    id: "direct",
    channelId: "c",
    authorId: "author",
    createdAt: Date.now() + 1000,
    mentionEveryone: true,
    mentionUserIds: ["viewer", "other-expanded-member"],
    broadcastDirectUserIds: ["viewer"],
  } as unknown as MessagePayload;
  act(() => receive([message, { ...message, id: "broadcast-only", broadcastDirectUserIds: [] }]));
  expect(notification).toHaveBeenCalledExactlyOnceWith("@everyone in #general", {
    body: "@everyone @Ada",
  });
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("disables the suppression switch until preferences load", () => {
  const change = vi.fn();
  const { rerender } = render(<NotificationsSettingsSection onSuppressMassMentions={change} />);
  const toggle = screen.getByRole("switch", { name: "Don't notify me for @everyone and @here" });
  expect(toggle).toBeDisabled();
  rerender(<NotificationsSettingsSection prefsLoaded onSuppressMassMentions={change} />);
  fireEvent.click(toggle);
  expect(change).toHaveBeenCalledWith(true);
  expect(screen.getByText("Unread badges still count them.")).toBeInTheDocument();
});
it("both clients send only suppression and scope, preserving notification levels", () => {
  for (const path of [
    "../components/chat/ChatView.tsx",
    "../../../mobile/src/components/chat/SoundSettingsSection.tsx",
  ]) {
    const source = readFileSync(`src/test/${path}`, "utf8");
    expect(
      source.match(
        /(?:setNotificationPref|setPref)\(\{\s*scope: "server",\s*suppressMassMentions: value,?\s*\}/,
      ),
      path,
    ).not.toBeNull();
  }
});
it("outbox replay calls the session directly without compose-time confirmation", () => {
  const source = readFileSync("src/lib/outbox-send.ts", "utf8");
  expect(source).toContain("session.sendMessage(");
  expect(source).not.toMatch(/confirm|Composer/);
});
it("retires the last-send fallback note once the user types", () => {
  render(
    <Composer
      channelId="c1"
      members={[]}
      roles={[]}
      memberIds={["me"]}
      onTyping={vi.fn()}
      onSend={vi.fn()}
    />,
  );
  // A fallback for another channel is not this composer's note.
  act(() => {
    reportBroadcastFallback("other-channel");
  });
  expect(screen.queryByText(BROADCAST_FALLBACK_NOTE)).not.toBeInTheDocument();
  act(() => {
    reportBroadcastFallback("c1");
  });
  expect(screen.getByRole("status")).toHaveTextContent(BROADCAST_FALLBACK_NOTE);
  // Typing the next message retires the past-tense note.
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "n" } });
  expect(screen.queryByText(BROADCAST_FALLBACK_NOTE)).not.toBeInTheDocument();
});
