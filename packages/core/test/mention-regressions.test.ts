import { describe, expect, it } from "vitest";
import { hasBroadcastToken } from "../src/chat/mentions";
import {
  canUseMassMentions,
  expandBroadcast,
  Permission,
  resolveMentions,
  suppressesBroadcast,
} from "../src/index.js";

describe("mass mention context", () => {
  for (const kind of ["dm", "group_dm", "text"])
    for (const thread of [undefined, "root"])
      for (const permissions of [0n, Permission.MentionEveryone, Permission.Administrator]) {
        it(`${kind} ${thread} ${permissions}`, () => {
          expect(canUseMassMentions({ kind }, thread, permissions)).toBe(
            kind === "text" && !thread && permissions !== 0n,
          );
        });
      }
  it("requires a channel", () =>
    expect(canUseMassMentions(undefined, undefined, Permission.Administrator)).toBe(false));
});
it.each(["x@here", "mail foo@everyone", "@@here", "a.@everyone", "a-@here"])(
  "does not broadcast %s",
  (text) => {
    expect(resolveMentions(text, [])).toMatchObject({ here: false, everyone: false });
  },
);
it.each(["(@here)", "@here!", "hello @here"])("recognizes boundary %s", (text) =>
  expect(resolveMentions(text, []).here).toBe(true),
);
it("only expands @everyone for legacy servers", () => {
  expect(expandBroadcast(resolveMentions("@here standup", []), ["visible"])).toEqual([]);
  expect(expandBroadcast(resolveMentions("@everyone standup", []), ["visible"])).toEqual([
    "visible",
  ]);
});
it("direct mention exempts broadcast suppression for all local notification paths", () => {
  const prefs = [{ scope: "server", channelId: null, suppressMassMentions: true }];
  expect(suppressesBroadcast({ channelId: "c", mentionHere: true }, "me", prefs)).toBe(true);
  expect(
    suppressesBroadcast({ channelId: "c", mentionHere: true, mentionUserIds: ["me"] }, "me", prefs),
  ).toBe(false);
});

it.each([
  "> @here",
  "  > @everyone",
  "`@here`",
  "`` @everyone ` x ``",
  "```ts\n@here\n```",
  "~~~\n@everyone\n~~~",
  "`code\n@here`",
])("ignores broadcast in quoted/code content: %s", (body) => {
  expect(hasBroadcastToken(body)).toBe(false);
  expect(resolveMentions(body, []).everyone).toBe(false);
  expect(resolveMentions(body, []).here).toBe(false);
});

it("resolves all users and roles, with longest names winning at each position", () => {
  const members = ["alice", "bob", "carol", "alice smith"].map((name) => ({
    userId: name,
    displayName: name,
  }));
  const roles = ["design", "eng"].map((name) => ({
    roleId: name,
    name,
    mentionable: true,
    memberUserIds: [],
  }));
  expect(resolveMentions("@alice @bob @carol @design @eng", members, roles)).toMatchObject({
    explicitUserIds: ["alice", "bob", "carol"],
    roleIds: ["design", "eng"],
  });
  expect(resolveMentions("@alice smith", members).explicitUserIds).toEqual(["alice smith"]);
  for (const body of ["xa@alice", "> @alice", "`@alice`", "~~~\n@alice\n~~~"]) {
    expect(resolveMentions(body, members).userIds).toEqual([]);
  }
});
it("masks URLs and preserves CRLF token positions", () => {
  for (const body of ["https://example.org/@everyone", "https://example.org/?q=@everyone"]) {
    expect(hasBroadcastToken(body)).toBe(false);
  }
  expect(hasBroadcastToken("x\r\n@everyone")).toBe(true);
});
it("uses the direct snapshot rather than expanded broadcast IDs for suppression", () => {
  const prefs = [{ scope: "server", channelId: null, suppressMassMentions: true }];
  const message = {
    channelId: "c",
    mentionEveryone: true,
    mentionUserIds: ["me"],
    broadcastDirectUserIds: [],
  };
  expect(suppressesBroadcast(message, "me", prefs)).toBe(true);
  expect(suppressesBroadcast({ ...message, broadcastDirectUserIds: ["me"] }, "me", prefs)).toBe(
    false,
  );
});
