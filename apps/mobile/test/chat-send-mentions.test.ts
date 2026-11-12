import { hasPermission, Permission, type RoleMentionTarget } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { resolveSendMentions } from "../src/lib/chat-mentions";

const roles: readonly RoleMentionTarget[] = [
  {
    roleId: "role-mods",
    name: "Mods",
    mentionable: true,
    memberUserIds: ["alice", "bob"],
  },
];

const targets = {
  userTargets: [
    { userId: "alice", displayName: "Alice" },
    { userId: "bob", displayName: "Bob" },
  ],
  memberIds: ["alice", "bob", "carol"],
  roles,
  channelTargets: [{ channelId: "channel-general", name: "general" }],
  categoryTargets: [{ categoryId: "category-news", name: "news" }],
};

describe("send mention resolution", () => {
  it("forwards user, channel and role mentions together", () => {
    expect(resolveSendMentions("Hi @Alice in #general @Mods", targets)).toEqual({
      // Roles expand at the server; the outbox keeps only explicit user ids.
      mentionUserIds: ["alice"],
      mentionChannelIds: ["channel-general"],
      mentionRoleIds: ["role-mods"],
    });
  });

  it("forwards a category mention when no channel name matches", () => {
    expect(resolveSendMentions("See #news", targets)).toEqual({
      mentionCategoryIds: ["category-news"],
    });
  });

  it("preserves @here for transport-time expansion", () => {
    expect(
      resolveSendMentions("@here standup", { ...targets, canMentionEveryone: true }).mentionHere,
    ).toBe(true);
    expect(resolveSendMentions("@here standup", targets)).toEqual({});
  });

  it("omits mention kinds the text does not use", () => {
    expect(resolveSendMentions("plain message", targets)).toEqual({});
  });
});

it("gates semantic markers using the effective channel permission", () => {
  const workspace = Permission.MentionEveryone;
  const channel = workspace & ~Permission.MentionEveryone;
  expect(
    resolveSendMentions("@everyone", {
      ...targets,
      canMentionEveryone: hasPermission(channel, Permission.MentionEveryone),
    }),
  ).toEqual({});
  expect(
    resolveSendMentions("@everyone", {
      ...targets,
      canMentionEveryone: hasPermission(workspace, Permission.MentionEveryone),
    }).mentionEveryone,
  ).toBe(true);
});
