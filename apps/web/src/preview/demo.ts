/**
 * Demo workspace for the dev-only UI preview (`/__preview`). Everything here
 * runs through the real `ChatSession` over `@aulora/core`'s in-memory plaintext
 * port, so the preview exercises the same render path as a live server without
 * one.
 */
import {
  type ChannelSummary,
  ChatSession,
  createMemoryProfileStore,
  createServerProfile,
  type MessagePayload,
  type ProfileStore,
} from "@aulora/core";
import type { ConvexReactClient } from "convex/react";
import { createMockPort, type MockPort } from "../../../../packages/core/src/chat/testing";
import type { ChatRuntime } from "../lib/chat-runtime";

export const DEMO_OWN_ID = "me";
export const DEMO_OWN_NAME = "Alex Rivera";

export const DEMO_MEMBERS = [
  { userId: "me", displayName: DEMO_OWN_NAME, roleColor: null, isOwner: true },
  { userId: "u-ludmil", displayName: "Ludmil Popov", roleColor: null },
  { userId: "u-kathryn", displayName: "Kathryn Murphy", roleColor: "#7C5CFF" },
  { userId: "u-savannah", displayName: "Savannah Nguyen", roleColor: null },
  { userId: "u-jacob", displayName: "Jacob Jones", roleColor: "#0E9F8E" },
  { userId: "u-marvin", displayName: "Marvin McKinney", roleColor: null },
  { userId: "u-wade", displayName: "Wade Warren", roleColor: null },
  { userId: "u-theresa", displayName: "Theresa Webb", roleColor: null },
  { userId: "u-leslie", displayName: "Leslie Alexander", roleColor: null },
  { userId: "u-floyd", displayName: "Floyd Miles", roleColor: null },
] as const;

const PRESENCE: Record<string, "online" | "idle" | "dnd" | "offline"> = {
  me: "online",
  "u-ludmil": "online",
  "u-kathryn": "online",
  "u-savannah": "idle",
  "u-jacob": "online",
  "u-marvin": "dnd",
  "u-wade": "offline",
  "u-theresa": "online",
  "u-leslie": "offline",
  "u-floyd": "offline",
};

export function demoProfileStore(): ProfileStore {
  const wellKnown = (name: string, seed: string) => ({
    name,
    version: "0.1.0",
    apiVersion: 1,
    convexUrl: "http://127.0.0.1:9",
    siteUrl: "http://127.0.0.1:9",
    iconSeed: seed,
    auth: { local: { enabled: true, signup: false }, providers: [] },
  });
  const acme = createServerProfile(
    "https://chat.acme.studio",
    wellKnown("Acme Studio", "aulora:server:acme-studio"),
  );
  const store = createMemoryProfileStore([
    acme,
    createServerProfile(
      "https://hall.makers.club",
      wellKnown("Makers Club", "aulora:server:makers"),
    ),
    createServerProfile("https://team.lumen.dev", wellKnown("Lumen", "aulora:server:lumen")),
  ]);
  void store.setActive(acme.id);
  return store;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface SeedMessage {
  readonly author: string;
  readonly text: string;
  readonly at: number;
  readonly mentions?: readonly string[];
  readonly reactions?: readonly [emoji: string, userId: string][];
  readonly replies?: readonly { author: string; text: string; at: number }[];
  readonly pinned?: boolean;
  readonly edited?: boolean;
}

export interface DemoWorkspace {
  readonly runtime: ChatRuntime;
  readonly port: MockPort;
  readonly channels: readonly ChannelSummary[];
  readonly names: ReadonlyMap<string, string>;
  readonly categories: readonly { id: string; name: string; position: number; overrides: [] }[];
  readonly unread: ReadonlyMap<
    string,
    { unread: boolean; mentionCount: number; lastActivityAt: number | null }
  >;
  readonly firstChannelId: string;
}

/** Builds the demo workspace: channels, DMs, history, reactions, threads, presence. */
export async function createDemoWorkspace(): Promise<DemoWorkspace> {
  const port = createMockPort();
  const session = ChatSession.create({
    port,
    subscriptions: port,
  });
  await session.start();

  const now = Date.now();
  const friday = now - 2 * DAY - 3 * 60 * MINUTE;
  const names = new Map<string, string>();
  const channels: ChannelSummary[] = [];
  const unread = new Map<
    string,
    { unread: boolean; mentionCount: number; lastActivityAt: number | null }
  >();

  async function channel(
    kind: ChannelSummary["kind"],
    name: string,
    options: { categoryId?: string; memberIds?: readonly string[] } = {},
  ): Promise<ChannelSummary> {
    const id =
      kind === "dm" || kind === "group_dm"
        ? (
            await (kind === "dm"
              ? port.createDm({ otherUserId: options.memberIds?.[0] ?? "" })
              : port.createGroupDm({ memberIds: options.memberIds ?? [] }))
          ).channelId
        : await port.createChannel({ kind, name });
    const summary: ChannelSummary = {
      id,
      kind,
      categoryId: options.categoryId ?? null,
      name,
      topic: null,
      archived: false,
      ...(options.memberIds !== undefined
        ? { memberIds: [DEMO_OWN_ID, ...options.memberIds] }
        : {}),
    };
    await session.openChannel(summary);
    channels.push(summary);
    names.set(id, name);
    return summary;
  }

  async function seed(target: ChannelSummary, messages: readonly SeedMessage[]): Promise<void> {
    for (const entry of messages) {
      const id = `seed-${target.id}-${entry.at}-${entry.author}`;
      const message: MessagePayload = {
        id,
        channelId: target.id,
        authorId: entry.author,
        body: entry.text,
        threadRootId: null,
        attachmentIds: [],
        mentionUserIds: [...(entry.mentions ?? [])],
        editedAt: entry.edited === true ? entry.at + 2 * MINUTE : null,
        deletedAt: null,
        pinnedAt: entry.pinned === true ? entry.at : null,
        createdAt: entry.at,
        replyCount: entry.replies?.length ?? 0,
        lastReplyAt: entry.replies?.at(-1)?.at ?? null,
      };
      port.state.messages.set(id, message);
      for (const reply of entry.replies ?? []) {
        const replyId = `seed-reply-${id}-${reply.at}`;
        port.state.messages.set(replyId, {
          ...message,
          id: replyId,
          authorId: reply.author,
          body: reply.text,
          threadRootId: id,
          createdAt: reply.at,
          replyCount: 0,
          lastReplyAt: null,
          pinnedAt: null,
          editedAt: null,
          mentionUserIds: [],
        });
      }
      const rows = [];
      for (const [emoji, userId] of entry.reactions ?? []) {
        rows.push({
          id: `r-${id}-${emoji}-${userId}`,
          userId,
          emoji,
        });
      }
      if (rows.length > 0) {
        port.state.reactions.set(id, rows);
      }
    }
  }

  const categories = [{ id: "cat-product", name: "Product", position: 1, overrides: [] as [] }];

  const general = await channel("text", "general");
  const announcements = await channel("announcement", "announcements");
  const design = await channel("text", "design", { categoryId: "cat-product" });
  const engineering = await channel("text", "engineering", { categoryId: "cat-product" });
  const random = await channel("text", "random");
  const dmLudmil = await channel("dm", "Ludmil Popov", { memberIds: ["u-ludmil"] });
  const dmJacob = await channel("dm", "Jacob Jones", { memberIds: ["u-jacob"] });
  const group = await channel("group_dm", "Launch crew", {
    memberIds: ["u-kathryn", "u-wade", "u-leslie"],
  });
  const dmSavannah = await channel("dm", "Savannah Nguyen", { memberIds: ["u-savannah"] });

  await seed(design, [
    {
      author: "u-ludmil",
      text: "Hi everyone, can we get an update on the progress of the web app design project?",
      at: friday,
    },
    {
      author: DEMO_OWN_ID,
      text: "Sure! I just invited you to the Figma file that shows the web app design: https://www.figma.com/file/67jcRh4BnEc7h7NykDhFJ9",
      at: friday + MINUTE,
      reactions: [
        ["👍", "u-ludmil"],
        ["🎉", "u-kathryn"],
      ],
    },
    {
      author: DEMO_OWN_ID,
      text: "The inbox layout follows the **three-pane** pattern we sketched last week.",
      at: friday + 2 * MINUTE,
    },
    { author: "u-ludmil", text: "okay I'll check it today", at: friday + 20 * MINUTE },
    {
      author: DEMO_OWN_ID,
      text: "I've been working on the mobile design and I'm almost finished with that. I'll send over a file in just a few minutes so you can take a look.",
      at: now - 95 * MINUTE,
      pinned: true,
    },
    {
      author: "u-kathryn",
      text: "Looks great! Love the new _ember_ accent 🔥 @Alex Rivera can you share the token sheet too?",
      at: now - 60 * MINUTE,
      mentions: [DEMO_OWN_ID],
      reactions: [
        ["❤️", "u-ludmil"],
        ["❤️", "u-jacob"],
        ["🔥", "me"],
      ],
      replies: [
        {
          author: DEMO_OWN_ID,
          text: "Yes, it's in the tokens package. Uploading a PDF too.",
          at: now - 55 * MINUTE,
        },
        { author: "u-kathryn", text: "Perfect, thank you!", at: now - 50 * MINUTE },
        {
          author: "u-jacob",
          text: "I'll wire it into the native theme after lunch.",
          at: now - 42 * MINUTE,
        },
      ],
    },
    {
      author: "u-jacob",
      text: "Here's the palette mapping I'm using on mobile:\n```ts\nconst accent = palette.accent; // #DE4C14\nconst chat = palette.chat;     // warm canvas\n```",
      at: now - 40 * MINUTE,
      edited: true,
    },
    { author: "u-jacob", text: "Contrast checks pass in both themes ✅", at: now - 39 * MINUTE },
    {
      author: "u-ludmil",
      text: "Nice. Shipping this to the beta group on Monday.",
      at: now - 12 * MINUTE,
    },
  ]);

  await seed(general, [
    { author: "u-theresa", text: "Morning all ☕", at: now - 5 * 60 * MINUTE },
    {
      author: "u-marvin",
      text: "Reminder: all-hands at 3pm in the big room.",
      at: now - 4 * 60 * MINUTE,
    },
    { author: "u-savannah", text: "I will. Have a nice day!", at: now - 3 * 60 * MINUTE },
  ]);
  await seed(announcements, [
    {
      author: "u-kathryn",
      text: "**Aulora 0.2 beta** is out: threads, group DMs and the new theme. Read the notes in #general.",
      at: now - DAY,
    },
  ]);
  await seed(engineering, [
    {
      author: "u-jacob",
      text: "The sealed-storage rollout landed in main.",
      at: now - 3 * 60 * MINUTE,
    },
    {
      author: "u-marvin",
      text: "@Alex Rivera can you review the read-cursor change? It stops the cursor moving backwards.",
      at: now - 30 * MINUTE,
      mentions: [DEMO_OWN_ID],
    },
    {
      author: "u-jacob",
      text: "@here deploy freeze starts at 5pm",
      at: now - 8 * MINUTE,
      mentions: [DEMO_OWN_ID],
    },
  ]);
  await seed(random, [
    {
      author: "u-floyd",
      text: "Hey alex, if you're free now can we pair on the bug?",
      at: now - 25 * MINUTE,
    },
  ]);
  await seed(dmLudmil, [
    { author: "u-ludmil", text: "Can you send me the latest export?", at: now - 70 * MINUTE },
    { author: DEMO_OWN_ID, text: "Sent! Let me know what you think.", at: now - 66 * MINUTE },
    { author: "u-ludmil", text: "I'm looking forward to it", at: now - 60 * MINUTE },
  ]);
  await seed(dmJacob, [
    {
      author: "u-jacob",
      text: "Sure! let me tell you about what we offer 😀",
      at: now - 5 * MINUTE,
    },
  ]);
  await seed(group, [
    { author: "u-wade", text: "Ok great, thanks!", at: now - 2 * 60 * MINUTE },
    { author: "u-leslie", text: "Sounds great!", at: now - 100 * MINUTE },
  ]);
  await seed(dmSavannah, [
    { author: "u-savannah", text: "That's everything, thanks again!", at: now - 2 * DAY },
  ]);

  for (const entry of DEMO_MEMBERS) {
    port.state.presence.push({
      userId: entry.userId,
      status: PRESENCE[entry.userId] ?? "offline",
      customStatus: null,
      lastHeartbeat: now,
    });
  }
  port.state.typing.set(design.id, [{ userId: "u-ludmil", expiresAt: now + 60 * 60 * MINUTE }]);

  const lastAt = (id: string) =>
    Math.max(
      0,
      ...[...port.state.messages.values()]
        .filter((m) => m.channelId === id)
        .map((m) => m.createdAt),
    );
  for (const entry of channels) {
    unread.set(entry.id, {
      unread: false,
      mentionCount: 0,
      lastActivityAt: lastAt(entry.id) || null,
    });
  }
  unread.set(engineering.id, {
    unread: true,
    mentionCount: 2,
    lastActivityAt: lastAt(engineering.id),
  });
  unread.set(random.id, { unread: true, mentionCount: 0, lastActivityAt: lastAt(random.id) });
  unread.set(dmJacob.id, { unread: true, mentionCount: 1, lastActivityAt: lastAt(dmJacob.id) });

  const runtime: ChatRuntime = {
    session,
    port,
    subscriptions: port,
    client: { query: () => new Promise(() => undefined) } as unknown as ConvexReactClient,
    watchThread(threadRootId, onChange) {
      const emit = () =>
        onChange(
          [...port.state.messages.values()]
            .filter((message) => message.threadRootId === threadRootId)
            .sort((a, b) => a.createdAt - b.createdAt),
        );
      const root = port.state.messages.get(threadRootId);
      const off =
        root === undefined ? () => undefined : port.watchMessages(root.channelId, () => emit());
      emit();
      return off;
    },
  };

  return {
    runtime,
    port,
    channels,
    names,
    categories,
    unread,
    firstChannelId: design.id,
  };
}
