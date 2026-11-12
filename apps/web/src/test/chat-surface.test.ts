import { describe, expect, it } from "vitest";
import {
  type ChatSurfaceState,
  isChatCanvasOnScreen,
  isThreadsInboxOnScreen,
} from "../lib/chat-surface";

function state(overrides: Partial<ChatSurfaceState> = {}): ChatSurfaceState {
  return {
    mainView: "chat",
    adminOpen: false,
    userSettingsOpen: false,
    mobilePane: "chat",
    wideShell: true,
    ...overrides,
  };
}

describe("chat surface visibility", () => {
  it("shows the timeline only while the chat view is the active surface", () => {
    expect(isChatCanvasOnScreen(state())).toBe(true);
    for (const mainView of ["notes", "kanban", "scheduled", "transcripts", "threads"] as const) {
      expect(isChatCanvasOnScreen(state({ mainView }))).toBe(false);
    }
  });

  it("hides the timeline behind an admin sheet or the settings page", () => {
    expect(isChatCanvasOnScreen(state({ adminOpen: true }))).toBe(false);
    expect(isChatCanvasOnScreen(state({ userSettingsOpen: true }))).toBe(false);
  });

  it("hides the timeline behind the sidebar on a phone", () => {
    expect(isChatCanvasOnScreen(state({ wideShell: false, mobilePane: "list" }))).toBe(false);
    expect(isChatCanvasOnScreen(state({ wideShell: false, mobilePane: "chat" }))).toBe(true);
  });

  it("does not require the phone pane when both panes are on screen", () => {
    expect(isChatCanvasOnScreen(state({ wideShell: true, mobilePane: "list" }))).toBe(true);
  });

  it("shows the threads inbox with the same surface rules", () => {
    expect(isThreadsInboxOnScreen(state({ mainView: "threads" }))).toBe(true);
    expect(isThreadsInboxOnScreen(state({ mainView: "chat" }))).toBe(false);
    expect(isThreadsInboxOnScreen(state({ mainView: "threads", adminOpen: true }))).toBe(false);
    expect(
      isThreadsInboxOnScreen(state({ mainView: "threads", wideShell: false, mobilePane: "list" })),
    ).toBe(false);
  });
});
