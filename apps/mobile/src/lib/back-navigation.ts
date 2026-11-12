import type { HubTab } from "../components/chat/HubPane";
import type { PaneIndex } from "../components/chat/SwipePanes";

/**
 * A place in the chat surface that Android back can return to.
 *
 * The panes and hub tabs are not a fixed hierarchy: somebody can go from
 * Notes to You, from a conversation to the hub, or back to a tab they used
 * earlier. Remembering the state they actually left is what makes Back feel
 * native; unwinding a hardcoded pane -> hub -> Channels order would send them
 * somewhere they had not been.
 */
export interface ChatLocation {
  readonly pane: PaneIndex;
  readonly hubTab: HubTab;
}

/** A bounded stack: enough to retrace a session without growing forever. */
export const MAX_CHAT_HISTORY = 32;

export function pushChatLocation(
  history: readonly ChatLocation[],
  location: ChatLocation,
): ChatLocation[] {
  const next = [...history, location];
  return next.length > MAX_CHAT_HISTORY ? next.slice(next.length - MAX_CHAT_HISTORY) : next;
}

export function popChatLocation(
  history: readonly ChatLocation[],
): { readonly location: ChatLocation; readonly history: ChatLocation[] } | null {
  const location = history[history.length - 1];
  if (location === undefined) {
    return null;
  }
  return { location, history: history.slice(0, -1) };
}

/**
 * Routes one Android back press through nested views, then the chat history.
 *
 * React Native invokes its own `hardwareBackPress` listeners newest-first, but
 * each component registering one has no idea whether it is the visible
 * surface. A single router is registered once per chat screen; nested views
 * join and leave it as they become active, so an off-screen settings page or
 * note editor cannot consume a press meant for the conversation behind it.
 * Handlers run newest-first, matching Android's overlay order.
 */
export interface BackPressRouter {
  /** Adds a handler. Returns an idempotent unregister function. */
  register(handler: () => boolean): () => void;
  /** Runs the newest active handler, then the fallback. `true` consumed it. */
  handle(): boolean;
}

export function createBackPressRouter(fallback: () => boolean = () => false): BackPressRouter {
  const handlers: Array<() => boolean> = [];
  return {
    register(handler) {
      handlers.push(handler);
      return () => {
        const index = handlers.lastIndexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      };
    },
    handle() {
      for (let index = handlers.length - 1; index >= 0; index -= 1) {
        const handler = handlers[index];
        if (handler?.()) {
          return true;
        }
      }
      return fallback();
    },
  };
}

/** What the notes tab should do with Android back, if anything. */
export type NotesBackAction =
  /** Close the history page and show the note it came from. */
  | "history"
  /** Close the editor through its unsaved-changes guard. */
  | "editor"
  /** Return from a drilled-in folder to the list it was opened from. */
  | "folder"
  /** The notes tab has nothing nested to close. */
  | "none";

export function notesBackAction(state: {
  readonly mode: "list" | "editor" | "history";
  readonly folderId: string | null | undefined;
}): NotesBackAction {
  if (state.mode === "history") {
    return "history";
  }
  if (state.mode === "editor") {
    return "editor";
  }
  // `null` is the built-in "Unfiled" view, which has no back affordance of its
  // own; only a real folder drills in one level.
  return typeof state.folderId === "string" ? "folder" : "none";
}
