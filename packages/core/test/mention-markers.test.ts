import { describe, expect, it } from "vitest";
import {
  buildSendMentions,
  messageMentionsUser,
  resolveMentions,
  resolveServerCapabilities,
  suppressesBroadcast,
} from "../src/chat/index.js";
import { memoryOutboxStore, Outbox } from "../src/outbox/index.js";
import { countMentions, emptyCursor } from "../src/unread.js";

const roles = [{ roleId: "mods", name: "Mods", mentionable: true, memberUserIds: ["role-member"] }];
const members = [{ userId: "explicit", displayName: "Ada" }];
function build(capable: boolean, permission = true) {
  return buildSendMentions({
    resolution: resolveMentions("@Ada @Mods @here @everyone", members, roles, {
      expandRoles: !capable,
    }),
    canMentionEveryone: permission,
    memberIds: ["channel-member"],
    capabilities: { mentionMarkers: capable },
    channels: { channelIds: ["channel"], categoryIds: ["category"] },
  });
}

describe("mention markers", () => {
  it.each([
    undefined,
    null,
    true,
    [],
    {},
    { capabilities: null },
    { capabilities: { mentionMarkers: "true" } },
  ])("fails closed for %j", (value) => {
    expect(resolveServerCapabilities(value)).toEqual({ mentionMarkers: false });
  });
  it("recognizes only an explicit capability", () => {
    expect(resolveServerCapabilities({ capabilities: { mentionMarkers: true } })).toEqual({
      mentionMarkers: true,
    });
  });
  it("sends explicit ids, roles, links and broadcast markers on capable servers", () => {
    expect(build(true)).toEqual({
      mentionUserIds: ["explicit"],
      mentionRoleIds: ["mods"],
      mentionChannelIds: ["channel"],
      mentionCategoryIds: ["category"],
      mentionEveryone: true,
      mentionHere: true,
    });
  });
  it("retains legacy expansion without marker arguments", () => {
    expect(build(false)).toEqual({
      mentionUserIds: ["channel-member", "explicit", "role-member"],
      mentionRoleIds: ["mods"],
      mentionChannelIds: ["channel"],
      mentionCategoryIds: ["category"],
    });
  });
  it("gates broadcasts on permission while preserving explicit and role mentions", () => {
    expect(build(true, false)).toMatchObject({
      mentionUserIds: ["explicit"],
      mentionEveryone: false,
      mentionHere: false,
    });
    expect(build(false, false).mentionUserIds).toEqual(["explicit", "role-member"]);
  });
  it.each(["mentionEveryone", "mentionHere"] as const)(
    "recognizes %s for highlights, notification gating and unread math",
    (flag) => {
      const message = {
        id: "m",
        createdAt: 1,
        authorId: "author",
        mentionUserIds: [],
        [flag]: true,
      };
      expect(messageMentionsUser(message, "viewer")).toBe(true);
      expect(messageMentionsUser(message, "viewer")).toBe(true);
      expect(messageMentionsUser(message, "author")).toBe(false);
      expect(countMentions([{ ...message, mentionedUserIds: [] }], emptyCursor(), "viewer")).toBe(
        1,
      );
      expect(countMentions([{ ...message, mentionedUserIds: [] }], emptyCursor(), "author")).toBe(
        0,
      );
    },
  );
  it("does not cap explicit users or legacy broadcasts", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `user-${index}`);
    const resolution = resolveMentions(
      `@everyone ${ids.map((id) => `@${id}`).join(" ")}`,
      ids.map((id) => ({ userId: id, displayName: id })),
    );

    for (const mentionMarkers of [true, false]) {
      expect(
        buildSendMentions({
          resolution,
          memberIds: ["extra"],
          canMentionEveryone: true,
          capabilities: { mentionMarkers },
        }).mentionUserIds,
      ).toHaveLength(mentionMarkers ? 1000 : 1001);
    }
  });
  it("supports old messages and direct mentions", () => {
    expect(messageMentionsUser({ authorId: "author", mentionUserIds: ["viewer"] }, "viewer")).toBe(
      true,
    );
    expect(messageMentionsUser({ authorId: "author", mentionUserIds: [] }, "viewer")).toBe(false);
  });
  it("round trips new markers and flushes old persisted items", async () => {
    const store = memoryOutboxStore();
    const outbox = new Outbox({ store, createId: () => "new" });
    const queued = await outbox.enqueue(
      { channelId: "c", text: "@everyone", mentionEveryone: true, mentionHere: false },
      0,
    );
    const old = { ...queued, id: "old" };
    delete old.mentionEveryone;
    delete old.mentionHere;
    await store.put(JSON.parse(JSON.stringify(old)));
    const restored = new Outbox({ store });
    expect((await restored.list())[0]).toMatchObject({ mentionEveryone: true, mentionHere: false });
    const sent: unknown[] = [];
    await restored.flush(async (item) => {
      sent.push(item);
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toHaveProperty("mentionEveryone");
  });
});

it("suppresses broadcast cues with channel preference overriding server preference", () => {
  const message = { channelId: "c", mentionEveryone: true, mentionUserIds: [] };
  const server = { scope: "server", channelId: null, suppressMassMentions: true };
  expect(suppressesBroadcast(message, "viewer", [server])).toBe(true);
  expect(
    suppressesBroadcast(message, "viewer", [
      server,
      { scope: "channel", channelId: "c", suppressMassMentions: false },
    ]),
  ).toBe(false);
  expect(suppressesBroadcast(message, "viewer", undefined)).toBe(false);
});

it("inherits workspace suppression when a channel row only pins/hides/mutes", () => {
  const message = { channelId: "c", mentionEveryone: true };
  for (const flag of [undefined, null]) {
    expect(
      suppressesBroadcast(message, "u", [
        { scope: "channel", channelId: "c", suppressMassMentions: flag },
        { scope: "server", channelId: null, suppressMassMentions: true },
      ]),
    ).toBe(true);
  }
});
