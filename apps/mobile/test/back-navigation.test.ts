import { describe, expect, it } from "vitest";
import { chatBackTarget, notesBackTarget } from "../src/lib/back-navigation";

describe("chatBackTarget", () => {
  it("closes an open thread before touching the panes", () => {
    expect(chatBackTarget({ threadOpen: true, pane: 2, hubTab: "dms" })).toBe("thread");
  });

  it("walks the member pane back to the conversation", () => {
    expect(chatBackTarget({ threadOpen: false, pane: 2, hubTab: "chats" })).toBe("conversation");
  });

  it("walks the conversation back to the hub", () => {
    expect(chatBackTarget({ threadOpen: false, pane: 1, hubTab: "search" })).toBe("hub");
  });

  it("returns a secondary hub tab to Channels", () => {
    expect(chatBackTarget({ threadOpen: false, pane: 0, hubTab: "boards" })).toBe("channels");
  });

  it("only leaves the app from Channels", () => {
    expect(chatBackTarget({ threadOpen: false, pane: 0, hubTab: "chats" })).toBe("exit");
  });
});

describe("notesBackTarget", () => {
  it("closes the editor or history page first", () => {
    expect(notesBackTarget({ mode: "editor", folderId: "folder-1" })).toBe("list");
    expect(notesBackTarget({ mode: "history", folderId: undefined })).toBe("list");
  });

  it("returns from a drilled-in folder to its parent", () => {
    expect(notesBackTarget({ mode: "list", folderId: "folder-1" })).toBe("parent-folder");
  });

  it("leaves the notes list alone at the top level and in Unfiled", () => {
    expect(notesBackTarget({ mode: "list", folderId: undefined })).toBe("none");
    expect(notesBackTarget({ mode: "list", folderId: null })).toBe("none");
  });
});
