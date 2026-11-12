/** The top-level surfaces the signed-in chat shell can show. */
export type ChatMainView = "chat" | "threads" | "kanban" | "notes" | "scheduled" | "transcripts";

export interface ChatSurfaceState {
  readonly mainView: ChatMainView;
  readonly adminOpen: boolean;
  readonly userSettingsOpen: boolean;
  /** `list` is the channel sidebar; `chat` is the conversation on a phone. */
  readonly mobilePane: "list" | "chat";
  /** Whether the sidebar and the canvas are both on screen (`md` and up). */
  readonly wideShell: boolean;
}

/**
 * Whether the conversation timeline is actually on screen.
 *
 * Kept panes stay mounted while another surface is active (see `KeepAlive`),
 * and their effects still run. Read receipts and thread acknowledgements have
 * to check this, or a message in a hidden canvas is marked seen for the reader
 * who is looking at Notes, the Kanban board or an admin sheet.
 */
export function isChatCanvasOnScreen(state: ChatSurfaceState): boolean {
  return (
    state.mainView === "chat" &&
    !state.adminOpen &&
    !state.userSettingsOpen &&
    (state.wideShell || state.mobilePane === "chat")
  );
}

/** The same visibility check for the Threads inbox, which replaces the timeline. */
export function isThreadsInboxOnScreen(state: ChatSurfaceState): boolean {
  return (
    state.mainView === "threads" &&
    !state.adminOpen &&
    !state.userSettingsOpen &&
    (state.wideShell || state.mobilePane === "chat")
  );
}
