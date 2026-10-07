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

/**
 * The offline demo opens from the reserved address on a fresh install, on iOS
 * and Android alike. Saving any real server profile disables the shortcut.
 */
export function shouldOpenReviewDemo(savedProfileCount: number, input: string): boolean {
  return savedProfileCount === 0 && isReviewDemoAddress(input);
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

interface DemoIds {
  readonly generalId: string;
  readonly designId: string;
  readonly announcementsId: string;
  readonly dmId: string;
  readonly groupId: string;
}

type SeedFn = (
  id: string,
  channelId: string,
  authorId: string,
  body: string,
  minutesAgo: number,
  extra?: Partial<MessagePayload>,
) => void;

function createSeeder(port: MockPort, now: number): SeedFn {
  return (id, channelId, authorId, body, minutesAgo, extra = {}) => {
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
  };
}

function renameDmChannels(port: MockPort, ids: DemoIds): void {
  const channels: readonly [string, string][] = [
    [ids.dmId, "Sam Chen"],
    [ids.groupId, "Launch crew"],
  ];
  for (const [id, name] of channels) {
    const row = port.state.channels.get(id);
    if (row !== undefined) port.state.channels.set(id, { ...row, name });
  }
}

function seedGeneral(seed: SeedFn, ids: DemoIds, now: number): void {
  seed(
    "welcome",
    ids.generalId,
    "sam",
    "Welcome to Acme Studio. This workspace is an offline demo. Nothing you send leaves this device.",
    35,
    { pinnedAt: now - 35 * 60_000 },
  );
  seed(
    "explore",
    ids.generalId,
    "jordan",
    "Try sending a message, adding a reaction, or opening this thread. You can also explore #design and our direct messages.",
    30,
    { replyCount: 2, lastReplyAt: now - 22 * 60_000 },
  );
  seed(
    "reply",
    ids.generalId,
    REVIEW_USER_ID,
    "The same composer and message list work here without an account or a server.",
    25,
    { threadRootId: "explore" },
  );
}

function seedOtherChannels(seed: SeedFn, ids: DemoIds, now: number, fileId: string): void {
  seed("file-reply", ids.generalId, "sam", "", 22, {
    threadRootId: "explore",
    attachmentIds: [fileId],
  });
  seed(
    "design",
    ids.designId,
    "jordan",
    "The **ember** accent and warm canvas are ready for the mobile launch.",
    20,
  );
  seed("design-reply", ids.designId, REVIEW_USER_ID, "Looks good in light and dark mode.", 15, {
    editedAt: now - 10 * 60_000,
  });
  seed(
    "announcement",
    ids.announcementsId,
    "sam",
    "**Aulora 1.0** is ready for testing. Real workspaces use your own server address.",
    10,
  );
  seed("dm", ids.dmId, "sam", "Could you review the launch notes?", 8);
  seed(
    "group",
    ids.groupId,
    "jordan",
    "Let's coordinate the launch in this group conversation.",
    5,
  );
}

function seedPresence(port: MockPort, now: number): void {
  for (const member of REVIEW_MEMBERS) {
    port.state.presence.push({
      userId: member.userId,
      status: "online",
      customStatus: null,
      lastHeartbeat: now,
    });
  }
}

function buildRuntime(session: ChatSession, port: MockPort): ChatSurfaceRuntime {
  return {
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
}

function demoSearch(port: MockPort, query: string): readonly SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  return [...port.state.messages.values()]
    .filter((message) => message.deletedAt === null && message.body.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((message) => ({
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      snippet: message.body,
      score: 1,
      createdAt: message.createdAt,
    }));
}

/** Each entry starts a separate, disposable workspace. No network or profile store. */
export async function createReviewDemo(): Promise<ReviewDemo> {
  const port = createMockPort({ now: Date.now });
  const session = ChatSession.create({ port, subscriptions: port });
  await session.start();
  const ids: DemoIds = {
    generalId: await port.createChannel({ kind: "text", name: "general" }),
    designId: await port.createChannel({ kind: "text", name: "design" }),
    announcementsId: await port.createChannel({ kind: "announcement", name: "announcements" }),
    dmId: (await port.createDm({ otherUserId: "sam" })).channelId,
    groupId: (await port.createGroupDm({ memberIds: ["sam", "jordan"] })).channelId,
  };
  const now = Date.now();
  renameDmChannels(port, ids);
  const seed = createSeeder(port, now);
  seedGeneral(seed, ids, now);
  const file = await uploadAttachment(port, {
    bytes: new TextEncoder().encode("This attachment stays in the offline review workspace."),
    name: "review-notes.txt",
    mime: "text/plain",
  });
  seedOtherChannels(seed, ids, now, file.fileId);
  port.state.reactions.set("design", [{ id: "reaction-design", emoji: "👍", userId: "sam" }]);
  seedPresence(port, now);
  for (const channel of port.state.channels.values()) await session.openChannel(channel);
  await session.receiveMessages([...port.state.messages.values()]);

  return {
    runtime: buildRuntime(session, port),
    port,
    firstChannelId: ids.generalId,
    search: (query) => demoSearch(port, query),
    dispose: () => session.dispose(),
  };
}

export function reviewChannelTitle(channel: ChannelSummary): string {
  return channel.name ?? (channel.kind === "dm" ? "Direct message" : "Group message");
}
