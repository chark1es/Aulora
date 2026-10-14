/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { MessagePayload } from "@aulora/core";
import { createContext, createElement, type ReactNode, useContext } from "react";
import type { useConvexChatScreenSession } from "./use-chat-screen-data";

/** Profile details that a live server supplies; the offline demo injects its own. */
export interface MemberProfileData {
  readonly bio: string;
  readonly lastOnlineAt: number | null;
}

/** The viewer's editable profile fields, supplied offline by the demo. */
export interface ViewerProfileData {
  readonly nickname: string | null;
  readonly bio: string;
}

/**
 * Optional data only a live server normally reports. The offline review demo
 * fills these so server-backed sheets render sample content instead of a
 * spinner; every other screen reads the shared session unchanged.
 */
export interface ChatScreenOfflineData {
  readonly pinsFor?: (_channelId: string) => readonly MessagePayload[];
  readonly profiles?: ReadonlyMap<string, MemberProfileData>;
  readonly viewerProfile?: ViewerProfileData | null;
  /** Persists an offline profile edit for the life of the surface. */
  readonly onSaveViewerProfile?: (next: ViewerProfileData) => void;
  /** Thread to open once on mount, for an offline screenshot capture. */
  readonly initialThreadRoot?: MessagePayload;
}

export type ChatScreenSession = ReturnType<typeof useConvexChatScreenSession> &
  ChatScreenOfflineData;

const ChatScreenSessionContext = createContext<ChatScreenSession | null>(null);

/**
 * Provides the session every chat pane reads. The signed-in app supplies the
 * Convex-backed session; the offline demo supplies a mock one, so both render
 * the identical surfaces.
 */
export function ChatScreenSessionProvider({
  value,
  children,
}: {
  readonly value: ChatScreenSession;
  readonly children: ReactNode;
}) {
  return createElement(ChatScreenSessionContext.Provider, { value }, children);
}

export function useChatScreenSessionValue(): ChatScreenSession {
  const value = useContext(ChatScreenSessionContext);
  if (value === null) {
    throw new Error("useChatScreenSessionValue must be used within a ChatScreenSessionProvider.");
  }
  return value;
}
