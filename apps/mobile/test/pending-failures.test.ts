import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { ChatPendingFailures } from "../src/components/chat/ChatPendingFailures";
import type { ChatScreenModel } from "../src/components/chat/use-chat-screen-model";

const state = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("react-native", () => ({
  Alert: { alert: state.alert },
  View: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("@aulora/ui-native", () => ({ Text: "Text", Button: "Button" }));
vi.mock("../src/lib/use-action-error", () => ({
  useActionError: () => ({ show: (title: string) => state.alert(title, "Try again.") }),
}));

it("requires destructive confirmation before discarding a failed send", () => {
  const discardSend = vi.fn(async () => undefined);
  const model = {
    pendingItems: [
      { id: "failed-1", text: "A message that is longer than thirty characters", status: "failed" },
    ],
    discardSend,
  } as unknown as ChatScreenModel;
  const failure = ChatPendingFailures({ model })?.[0];
  expect(failure).toBeDefined();
  const row = failure?.type(failure.props) as ReactElement<{
    children: ReactElement<{ children: string; accessibilityLabel: string; onPress: () => void }>[];
  }>;
  const discard = row.props.children.find((child) => child.props.children === "Discard");
  expect(discard).toBeDefined();
  expect(discard?.props.accessibilityLabel).toBe(
    "Discard unsent message: A message that is longer than ",
  );
  expect(
    row.props.children.find((child) => child.props.children === "Retry")?.props.accessibilityLabel,
  ).toBe("Retry sending: A message that is longer than ");
  discard?.props.onPress();
  expect(discardSend).not.toHaveBeenCalled();
  expect(state.alert).toHaveBeenCalledWith(
    "Discard failed message?",
    "This message was not sent. Discarding removes it from this conversation.",
    expect.any(Array),
  );
  const buttons = state.alert.mock.calls[0]?.[2] as {
    text: string;
    style: string;
    onPress?: () => void;
  }[];
  expect(buttons[0]).toEqual({ text: "Cancel", style: "cancel" });
  expect(buttons[1]).toMatchObject({ text: "Discard message", style: "destructive" });
  buttons[1]?.onPress?.();
  expect(discardSend).toHaveBeenCalledWith("failed-1");
});

it("shows the message preview and identifies attachment-only failures", () => {
  for (const [text, attachments, preview] of [
    ["My unsent draft", [], "My unsent draft"],
    ["  ", [{ fileId: "one" }, { fileId: "two" }], "Attachment only · 2 files"],
  ] as const) {
    const model = {
      pendingItems: [{ id: "failed", status: "failed", text, attachments }],
    } as unknown as ChatScreenModel;
    const failure = ChatPendingFailures({ model })?.[0];
    const row = failure?.type(failure.props) as ReactElement<{ children: ReactElement[] }>;
    const copy = row.props.children[0] as ReactElement<{
      children: ReactElement<{ children: string; numberOfLines?: number }>[];
    }>;
    expect(copy.props.children[1]?.props.children).toBe(preview);
    expect(copy.props.children[1]?.props.numberOfLines).toBe(1);
  }
});
