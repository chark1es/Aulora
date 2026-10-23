import type { ChannelView, PresenceRow } from "@aulora/core";
import { Permission } from "@aulora/core";
import { Spinner } from "@aulora/ui-web";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { ChatView } from "../components/chat/ChatView";
import type { MemberView } from "../lib/workspace-admin";
import {
  ChatContextProvider,
  type ChatContextValue,
  type ChatSearchHit,
} from "../providers/ChatProvider";
import { type VoicePolicy, VoiceProvider } from "../providers/VoiceProvider";
import {
  createDemoWorkspace,
  DEMO_MEMBERS,
  DEMO_OWN_ID,
  DEMO_OWN_NAME,
  DEMO_ROLES,
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
  // `?viewer=manager` previews the same workspace as a Design lead, for
  // checking hierarchy-gated roles and grant limits without a server.
  const managerPreview =
    new URLSearchParams(globalThis.location?.search ?? "").get("viewer") === "manager";
  const viewer = managerPreview
    ? {
        userId: DEMO_OWN_ID,
        isOwner: false,
        roleIds: ["design"],
        permissions:
          Permission.ViewChannel |
          Permission.SendMessages |
          Permission.ReadHistory |
          Permission.ManageRoles |
          Permission.Kick |
          Permission.ManageMessages |
          Permission.MuteMembers,
        topPosition: 4,
      }
    : {
        userId: DEMO_OWN_ID,
        isOwner: true,
        roleIds: [] as readonly string[],
        permissions: -1n,
        topPosition: Number.POSITIVE_INFINITY,
      };
  const voicePolicy = useMemo<VoicePolicy>(
    () => ({
      enabled: true,
      videoEnabled: true,
      screenShareEnabled: true,
      maxParticipants: 10,
      iceServers: [],
    }),
    [],
  );

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
      async openChannel(channel) {
        await demo.runtime.session.openChannel(channel);
      },
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
      <VoiceProvider client={convex} userId={DEMO_OWN_ID} permissions={-1n} policy={voicePolicy}>
        <ChatContextProvider value={value}>
          <ChatView
            workspaceName="Acme Studio"
            workspaceIconSeed="aulora:server:acme-studio"
            ownUserId={DEMO_OWN_ID}
            ownName={DEMO_OWN_NAME}
            permissions={viewer.permissions}
            members={DEMO_MEMBERS.map((member) => ({ ...member }))}
            roles={DEMO_ROLES.filter((role) => !role.isEveryone).map((role) => ({
              roleId: role.key,
              name: role.name,
              mentionable: role.mentionable,
              memberUserIds: DEMO_MEMBERS.filter((member) =>
                (member.roleIds as readonly string[]).includes(role.key),
              ).map((member) => member.userId),
            }))}
            unreadByChannel={demo.unread}
            admin={{
              viewer,
              ownerId: DEMO_OWN_ID,
              roleViews: [...DEMO_ROLES],
              memberViews: DEMO_MEMBERS.map(
                (member): MemberView => ({
                  id: `member-${member.userId}`,
                  userId: member.userId,
                  nickname: null,
                  accountName: member.displayName,
                  roleIds: [...member.roleIds],
                  joinedAt: 0,
                  timeoutUntil: null,
                }),
              ),
              categories: demo.categories,
            }}
            onSignOut={() => undefined}
          />
        </ChatContextProvider>
      </VoiceProvider>
    </ConvexProvider>
  );
}
