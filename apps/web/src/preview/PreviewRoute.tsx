import type { ChannelView, PresenceRow } from "@aulora/core";
import { Spinner } from "@aulora/ui-web";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ChatView } from "../components/chat/ChatView";
import {
  ChatContextProvider,
  type ChatContextValue,
  type ChatSearchHit,
} from "../providers/ChatProvider";
import {
  createDemoWorkspace,
  DEMO_MEMBERS,
  DEMO_OWN_ID,
  DEMO_OWN_NAME,
  type DemoWorkspace,
} from "./demo";

/**
 * Dev-only UI preview: the real chat surface over the in-memory port, so
 * layout and interactions can be checked without a running server. Registered
 * at `/__preview` only in development builds.
 */
export function PreviewRoute() {
  const [demo, setDemo] = useState<DemoWorkspace | null>(null);
  const [presence, setPresence] = useState<readonly PresenceRow[]>([]);
  const convex = useMemo(() => new ConvexReactClient("http://127.0.0.1:9"), []);

  useEffect(() => {
    let cancelled = false;
    void createDemoWorkspace().then((created) => {
      if (cancelled) {
        return;
      }
      const key = "aulora.lastChannel.v1:Acme Studio";
      if (globalThis.localStorage?.getItem(key) === null) {
        globalThis.localStorage?.setItem(key, created.firstChannelId);
      }
      // The mock stamps sends with a sequence number; use wall-clock time.
      const send = created.port.sendMessage.bind(created.port);
      created.port.sendMessage = async (args) => {
        const id = await send(args);
        const message = created.port.state.messages.get(id);
        if (message !== undefined) {
          created.port.state.messages.set(id, { ...message, createdAt: Date.now() });
          await created.port.unpinMessage({ messageId: id });
        }
        return id;
      };
      setDemo(created);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => demo?.port.watchPresence(setPresence), [demo]);

  const value = useMemo<ChatContextValue | null>(() => {
    if (demo === null) {
      return null;
    }
    const channels: ChannelView[] = demo.channels.map((channel) => ({
      ...channel,
      name: demo.names.get(channel.id) ?? "channel",
    }));
    return {
      runtime: demo.runtime,
      channelNames: demo.names,
      reportChannelNames: () => undefined,
      presence,
      channels,
      ready: true,
      online: true,
      outbox: [],
      async sendMessage(channelId, text, options) {
        const messageId = await demo.runtime.session.sendMessage(channelId, text, options);
        return { queued: false, messageId };
      },
      async search(query): Promise<readonly ChatSearchHit[]> {
        const needle = query.toLowerCase();
        return [...demo.port.state.messages.values()]
          .map((message) => ({ message, text: demo.runtime.session.decryptedText(message.id) }))
          .filter((entry) => entry.text.toLowerCase().includes(needle))
          .slice(0, 10)
          .map(({ message, text }) => ({
            messageId: message.id,
            channelId: message.channelId,
            authorId: message.authorId,
            snippet: text,
            score: 1,
            createdAt: message.createdAt,
            channelName: demo.names.get(message.channelId) ?? "channel",
          }));
      },
    };
  }, [demo, presence]);

  if (value === null || demo === null) {
    return (
      <div className="pane flex flex-1 items-center justify-center">
        <Spinner size={28} label="Building preview" />
      </div>
    );
  }

  return (
    <ConvexProvider client={convex}>
      <ChatContextProvider value={value}>
        <ChatView
          workspaceName="Acme Studio"
          workspaceIconSeed="aulora:server:acme-studio"
          ownUserId={DEMO_OWN_ID}
          ownName={DEMO_OWN_NAME}
          permissions={-1n}
          members={DEMO_MEMBERS.map((member) => ({ ...member }))}
          roles={[]}
          unreadByChannel={demo.unread}
          admin={{
            viewer: {
              userId: DEMO_OWN_ID,
              isOwner: true,
              roleIds: [],
              permissions: -1n,
              topPosition: Number.POSITIVE_INFINITY,
            },
            ownerId: DEMO_OWN_ID,
            roleViews: [],
            memberViews: [],
            categories: demo.categories,
          }}
          onSignOut={() => undefined}
        />
      </ChatContextProvider>
    </ConvexProvider>
  );
}
