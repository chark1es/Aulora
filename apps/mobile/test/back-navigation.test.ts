import { describe, expect, it } from "vitest";
import {
  type ChatLocation,
  createBackPressRouter,
  MAX_CHAT_HISTORY,
  notesBackAction,
  popChatLocation,
  pushChatLocation,
} from "../src/lib/back-navigation";

const notes: ChatLocation = { pane: 0, hubTab: "notes" };
const you: ChatLocation = { pane: 0, hubTab: "you" };
const conversation: ChatLocation = { pane: 1, hubTab: "chats" };

describe("chat location history", () => {
  it("restores the tab somebody actually left instead of a fixed hierarchy", () => {
    // Going Notes -> You records the Notes location that Back must restore.
    const afterLeavingNotes = pushChatLocation([], notes);
    expect(popChatLocation(afterLeavingNotes)).toEqual({
      location: notes,
      history: [],
    });
  });

  it("walks back through every surface the person visited", () => {
    // Notes -> You -> a conversation: Back returns to You, then to Notes.
    let history = pushChatLocation([], notes);
    history = pushChatLocation(history, you);
    const backToYou = popChatLocation(history);
    expect(backToYou?.location).toEqual(you);
    expect(backToYou === null ? null : popChatLocation(backToYou.history)?.location).toEqual(notes);
  });

  it("restores a conversation the person swiped away from", () => {
    const afterLeavingConversation = pushChatLocation([], conversation);
    expect(popChatLocation(afterLeavingConversation)?.location).toEqual(conversation);
  });

  it("reports an empty stack at the chat's own root", () => {
    expect(popChatLocation([])).toBeNull();
  });

  it("bounds a long session so history cannot grow without limit", () => {
    let history: ChatLocation[] = [];
    for (let index = 0; index < MAX_CHAT_HISTORY + 5; index += 1) {
      history = pushChatLocation(history, { pane: (index % 3) as 0 | 1 | 2, hubTab: "chats" });
    }
    expect(history).toHaveLength(MAX_CHAT_HISTORY);
    // The oldest five entries were dropped; the sixth entry (pane 5 % 3) leads.
    expect(history[0]?.pane).toBe((MAX_CHAT_HISTORY + 5 - MAX_CHAT_HISTORY) % 3);
  });
});

describe("back press router", () => {
  it("runs the newest active handler first and stops when it consumes", () => {
    const calls: string[] = [];
    const router = createBackPressRouter(() => {
      calls.push("chat");
      return false;
    });
    router.register(() => {
      calls.push("notes-folder");
      return false;
    });
    router.register(() => {
      calls.push("note-editor");
      return true;
    });

    expect(router.handle()).toBe(true);
    expect(calls).toEqual(["note-editor"]);
  });

  it("falls through to the chat history when no nested view handles the press", () => {
    const calls: string[] = [];
    const router = createBackPressRouter(() => {
      calls.push("chat");
      return true;
    });
    router.register(() => {
      calls.push("notes-list");
      return false;
    });

    expect(router.handle()).toBe(true);
    expect(calls).toEqual(["notes-list", "chat"]);
  });

  it("releases an off-screen view so its handler cannot steal the press", () => {
    const calls: string[] = [];
    const router = createBackPressRouter(() => {
      calls.push("chat");
      return true;
    });
    const unregisterSettings = router.register(() => {
      calls.push("settings-page");
      return true;
    });
    expect(router.handle()).toBe(true);

    // The person swiped to the conversation; Settings is still mounted but no
    // longer the visible surface, so it unregisters.
    unregisterSettings();
    calls.length = 0;
    expect(router.handle()).toBe(true);
    expect(calls).toEqual(["chat"]);
  });

  it("tolerates unregistering twice and leaves the root to Android", () => {
    const router = createBackPressRouter();
    const remove = router.register(() => true);
    remove();
    remove();
    expect(router.handle()).toBe(false);
  });
});

describe("notes back action", () => {
  it("closes the history page before the note so Back restores the note", () => {
    expect(notesBackAction({ mode: "history", folderId: undefined })).toBe("history");
  });

  it("closes the editor through its discard guard", () => {
    expect(notesBackAction({ mode: "editor", folderId: "folder-1" })).toBe("editor");
  });

  it("returns from a drilled-in folder to the list", () => {
    expect(notesBackAction({ mode: "list", folderId: "folder-1" })).toBe("folder");
  });

  it("leaves the notes list alone at the top level and in Unfiled", () => {
    expect(notesBackAction({ mode: "list", folderId: undefined })).toBe("none");
    expect(notesBackAction({ mode: "list", folderId: null })).toBe("none");
  });
});
