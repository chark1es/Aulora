import type { ChatScreenProps } from "./chat-screen-types";
import { useChatScreenActions } from "./use-chat-screen-actions";
import { useChatScreenData } from "./use-chat-screen-data";

export function useChatScreenModel(props: ChatScreenProps) {
  const data = useChatScreenData(props);
  const actions = useChatScreenActions(data);
  return { ...data, ...actions };
}

export type ChatScreenModel = ReturnType<typeof useChatScreenModel>;
