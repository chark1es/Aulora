import {
  type ChannelSummary,
  ChatSession,
  type MessagePayload,
  type SearchHit,
  tryNormalizeServerUrl,
  uploadAttachment,
} from "@aulora/core";
import { createMockPort, type MockPort } from "../../../../packages/core/src/chat/testing";
import type { ChatSurfaceRuntime } from "./chat-surface";

/**
 * Typing this into the server address field opens the offline demo instead of
 * connecting. `.example` is reserved (RFC 2606), so no real server can claim it.
 */
export const REVIEW_DEMO_ADDRESS = "demo.aulora.example";

export function isReviewDemoAddress(input: string): boolean {
  return tryNormalizeServerUrl(input) === `https://${REVIEW_DEMO_ADDRESS}`;
}

export const REVIEW_USER_ID = "me";
export const REVIEW_MEMBERS = [
  { userId: REVIEW_USER_ID, displayName: "Alex Rivera" },
  { userId: "sam", displayName: "Sam Chen" },
  { userId: "jordan", displayName: "Jordan Ellis" },
] as const;

export interface ReviewDemo {
  readonly runtime: ChatSurfaceRuntime;
  readonly port: MockPort;
  readonly firstChannelId: string;
  search(query: string): readonly SearchHit[];
  dispose(): void;
}

/** Each entry starts a separate, disposable workspace. No network or profile store. */
export async function createReviewDemo(): Promise<ReviewDemo> {
  const port = createMockPort({ now: Date.now });
  const session = ChatSession.create({ port, subscriptions: port });
  await session.start();
  const generalId = await port.createChannel({ kind: "text", name: "general" });
  const designId = await port.createChannel({ kind: "text", name: "design" });
  const announcementsId = await port.createChannel({ kind: "announcement", name: "announcements" });
  const dm = await port.createDm({ otherUserId: "sam" });
  const group = await port.createGroupDm({ memberIds: ["sam", "jordan"] });
  const channels: readonly [string, string][] = [
    [dm.channelId, "Sam Chen"],
    [group.channelId, "Launch crew"],
  ];
  for (const [id, name] of channels) {
    const row = port.state.channels.get(id);
    if (row !== undefined) port.state.channels.set(id, { ...row, name });
  }
  const now = Date.now();
  function seed(
    id: string,
    channelId: string,
    authorId: string,
    body: string,
    minutesAgo: number,
    extra: Partial<MessagePayload> = {},
  ) {
    port.state.messages.set(id, {
      id,
      channelId,
      authorId,
      body,
      threadRootId: null,
      attachmentIds: [],
      mentionUserIds: [],
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      createdAt: now - minutesAgo * 60_000,
      ...extra,
    });
  }
  seed(
    "welcome",
    generalId,
    "sam",
    "Welcome to Acme Studio. This workspace is an offline demo. Nothing you send leaves this device.",
    35,
    { pinnedAt: now - 35 * 60_000 },
  );
  seed(
    "explore",
    generalId,
    "jordan",
    "Try sending a message, adding a reaction, or opening this thread. You can also explore #design and our direct messages.",
    30,
    { replyCount: 2, lastReplyAt: now - 22 * 60_000 },
  );
  seed(
    "reply",
    generalId,
    REVIEW_USER_ID,
    "The same composer and message list work here without an account or a server.",
    25,
    { threadRootId: "explore" },
  );
  const file = await uploadAttachment(port, {
    bytes: new TextEncoder().encode("This attachment stays in the offline review workspace."),
    name: "review-notes.txt",
    mime: "text/plain",
  });
  seed("file-reply", generalId, "sam", "", 22, {
    threadRootId: "explore",
    attachmentIds: [file.fileId],
  });
  seed(
    "design",
    designId,
    "jordan",
    "The **ember** accent and warm canvas are ready for the mobile launch.",
    20,
  );
  seed("design-reply", designId, REVIEW_USER_ID, "Looks good in light and dark mode.", 15, {
    editedAt: now - 10 * 60_000,
  });
  seed(
    "announcement",
    announcementsId,
    "sam",
    "**Aulora 1.0** is ready for testing. Real workspaces use your own server address.",
    10,
  );
  seed("dm", dm.channelId, "sam", "Could you review the launch notes?", 8);
  seed(
    "group",
    group.channelId,
    "jordan",
    "Let's coordinate the launch in this group conversation.",
    5,
  );
  port.state.reactions.set("design", [{ id: "reaction-design", emoji: "👍", userId: "sam" }]);
  for (const member of REVIEW_MEMBERS) {
    port.state.presence.push({
      userId: member.userId,
      status: "online",
      customStatus: null,
      lastHeartbeat: now,
    });
  }
  for (const channel of port.state.channels.values()) await session.openChannel(channel);
  await session.receiveMessages([...port.state.messages.values()]);

  const runtime: ChatSurfaceRuntime = {
    session,
    port,
    subscriptions: port,
    watchThread(threadRootId, onChange) {
      const emit = () =>
        onChange(
          [...port.state.messages.values()]
            .filter((message) => message.threadRootId === threadRootId)
            .sort((a, b) => a.createdAt - b.createdAt),
        );
      const root = port.state.messages.get(threadRootId);
      if (root === undefined) {
        onChange([]);
        return () => undefined;
      }
      return port.watchMessages(root.channelId, emit);
    },
  };
  return {
    runtime,
    port,
    firstChannelId: generalId,
    search(query) {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return [];
      return [...port.state.messages.values()]
        .filter(
          (message) => message.deletedAt === null && message.body.toLowerCase().includes(needle),
        )
        .slice(0, 20)
        .map((message) => ({
          messageId: message.id,
          channelId: message.channelId,
          authorId: message.authorId,
          snippet: message.body,
          score: 1,
          createdAt: message.createdAt,
        }));
    },
    dispose: () => session.dispose(),
  };
}

export function reviewChannelTitle(channel: ChannelSummary): string {
  return channel.name ?? (channel.kind === "dm" ? "Direct message" : "Group message");
}
