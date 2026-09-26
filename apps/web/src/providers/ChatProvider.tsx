import type { ChannelSummary, ChannelView, MessagePayload, PresenceRow } from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ChatRuntime, createChatRuntime } from "../lib/chat-runtime";

export interface ChatContextValue {
  /** `undefined` until the runtime and device identity are ready. */
  readonly runtime: ChatRuntime | undefined;
  /** Decrypted channel names, keyed by channel id. */
  readonly channelNames: ReadonlyMap<string, string>;
  /** Decrypts and caches channel names for the given channels. */
  reportChannelNames(entries: readonly { id: string; ciphertext: string }[]): void;
  readonly presence: readonly PresenceRow[];
  readonly channels: readonly ChannelView[];
  readonly ready: boolean;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
  readonly client: ConvexReactClient;
  readonly userId: string;
  readonly displayName: string;
  readonly channels: readonly ChannelSummary[];
  readonly children: ReactNode;
}

/**
 * Owns the chat runtime for one signed-in device. Channel names are encrypted
 * like every other payload; the sidebar decrypts them through this provider.
 */
export function ChatProvider({
  client,
  userId,
  displayName,
  channels,
  children,
}: ChatProviderProps) {
  const [runtime, setRuntime] = useState<ChatRuntime | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [channelNames, setChannelNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  const runtimeRef = useRef<ChatRuntime | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void createChatRuntime({ client, userId, displayName }).then((created) => {
      if (cancelled) {
        created.session.dispose();
        return;
      }
      runtimeRef.current = created;
      setRuntime(created);
      setReady(true);
    });
    return () => {
      cancelled = true;
      runtimeRef.current?.session.dispose();
      runtimeRef.current = undefined;
    };
  }, [client, userId, displayName]);

  useEffect(() => {
    if (runtime === undefined) {
      return;
    }
    return runtime.subscriptions.watchPresence(setPresence);
  }, [runtime]);

  const reportChannelNames = useCallback(
    (entries: readonly { id: string; ciphertext: string }[]) => {
      const active = runtimeRef.current;
      if (active === undefined || entries.length === 0) {
        return;
      }
      void decryptNames(active, entries).then((decrypted) => {
        if (decrypted.size === 0) {
          return;
        }
        setChannelNames((current) => {
          const next = new Map(current);
          for (const [id, name] of decrypted) {
            next.set(id, name);
          }
          return next;
        });
      });
    },
    [],
  );

  const views = useMemo<readonly ChannelView[]>(
    () =>
      channels.map((channel) => ({
        ...channel,
        name: channelNames.get(channel.id) ?? placeholder(channel),
      })),
    [channels, channelNames],
  );

  const value = useMemo<ChatContextValue>(
    () => ({ runtime, channelNames, reportChannelNames, presence, channels: views, ready }),
    [runtime, channelNames, reportChannelNames, presence, views, ready],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

async function decryptNames(
  runtime: ChatRuntime,
  entries: readonly { id: string; ciphertext: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of entries) {
    const payload = await runtime.session.decryptPayload<{ text: string }>(
      entry.id,
      entry.ciphertext,
    );
    if (payload !== undefined) {
      result.set(entry.id, payload.text);
    }
  }
  return result;
}

function placeholder(channel: ChannelSummary): string {
  if (channel.kind === "dm") {
    return "Direct message";
  }
  if (channel.kind === "group_dm") {
    return "Group message";
  }
  return channel.archived ? "archived" : "channel";
}

/** Reads the chat context; throws outside a {@link ChatProvider}. */
export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used within a ChatProvider.");
  }
  return value;
}

export type { MessagePayload };
