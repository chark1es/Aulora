/**
 * What the Android back button should do at the chat surface's top level.
 *
 * The chat is a three-pane swipe (`pane`) with a hub tab inside the left pane
 * and an optional thread page over the conversation. Nested views (a settings
 * page, a note editor, a folder) register their own back handler while open,
 * so this only has to unwind the persistent structure once those are closed.
 */

export type PaneIndex = 0 | 1 | 2;

export type ChatBackTarget =
  /** The thread page is over the conversation. */
  | "thread"
  /** The member pane is open; return to the conversation. */
  | "conversation"
  /** The conversation is open; return to the hub pane. */
  | "hub"
  /** The hub is showing a secondary tab; return to Channels. */
  | "channels"
  /** Nothing is unwound: let Android leave the app. */
  | "exit";

export function chatBackTarget(state: {
  readonly threadOpen: boolean;
  readonly pane: PaneIndex;
  readonly hubTab: string;
}): ChatBackTarget {
  if (state.threadOpen) {
    return "thread";
  }
  if (state.pane === 2) {
    return "conversation";
  }
  if (state.pane === 1) {
    return "hub";
  }
  if (state.hubTab !== "chats") {
    return "channels";
  }
  return "exit";
}

export type NotesBackTarget =
  /** The open note editor or history page returns to the notes list. */
  | "list"
  /** A folder was drilled into; return to its parent. */
  | "parent-folder"
  /** The notes tab has nothing nested to close. */
  | "none";

export function notesBackTarget(state: {
  readonly mode: "list" | "editor" | "history";
  readonly folderId: string | null | undefined;
}): NotesBackTarget {
  if (state.mode !== "list") {
    return "list";
  }
  // `null` is the built-in "Unfiled" view, which has no back affordance of its
  // own; only a real folder drills in one level.
  if (typeof state.folderId === "string") {
    return "parent-folder";
  }
  return "none";
}
