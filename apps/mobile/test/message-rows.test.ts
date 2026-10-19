import type { MessagePayload } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { buildMessageRows, groupReactions } from "../src/lib/message-rows";

const NOON = new Date(2026, 8, 30, 12, 0, 0).getTime();
const MINUTE = 60_000;

function message(id: string, authorId: string, at: number, extra: Partial<MessagePayload> = {}) {
  return {
    id,
    channelId: "c1",
    authorId,
    body: id,
    threadRootId: null,
    attachmentIds: [],
    mentionUserIds: [],
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: at,
    ...extra,
  } satisfies MessagePayload;
}

/** The rows in the order they read on screen, oldest first, as `kind:id:grouped`. */
function shape(messages: readonly MessagePayload[]): string[] {
  return buildMessageRows(messages)
    .reverse()
    .map((row) => {
      if (row.kind === "day") return "day";
      if (row.kind === "system") return `system:${row.key}`;
      return `${row.message.id}:${row.grouped}`;
    });
}

describe("buildMessageRows", () => {
  it("returns rows newest first with the day separator after its messages", () => {
    const rows = buildMessageRows([message("a", "u1", NOON), message("b", "u2", NOON + MINUTE)]);
    expect(rows.map((row) => row.key)).toEqual(["b", "a", expect.stringMatching(/^day-/)]);
  });

  it("groups consecutive messages from one author inside the window", () => {
    expect(
      shape([
        message("a", "u1", NOON),
        message("b", "u1", NOON + MINUTE),
        message("c", "u2", NOON + 2 * MINUTE),
        message("d", "u1", NOON + 3 * MINUTE),
      ]),
    ).toEqual(["day", "a:false", "b:true", "c:false", "d:false"]);
  });

  it("starts a new block after the window, on a new day, or for a reply", () => {
    expect(
      shape([
        message("a", "u1", NOON),
        message("late", "u1", NOON + 6 * MINUTE),
        message("reply", "u1", NOON + 7 * MINUTE, { replyToId: "a" }),
        message("next-day", "u1", NOON + 24 * 60 * MINUTE),
      ]),
    ).toEqual(["day", "a:false", "late:false", "reply:false", "day", "next-day:false"]);
  });

  it("omits deleted messages and groups the remaining rows", () => {
    expect(
      shape([
        message("a", "u1", NOON),
        message("gone", "u1", NOON + MINUTE, { deletedAt: NOON + 2 * MINUTE }),
        message("after", "u1", NOON + 2 * MINUTE),
      ]),
    ).toEqual(["day", "a:false", "after:true"]);
  });

  it("handles an empty conversation", () => {
    expect(buildMessageRows([])).toEqual([]);
  });

  it("renders a pin notice as a standalone system row that breaks the author block", () => {
    const rows = buildMessageRows([
      message("a", "u1", NOON, { pinnedAt: NOON }),
      message("notice", "u1", NOON + MINUTE, {
        body: "",
        systemKind: "pin",
        systemActorId: "u1",
        systemTargetId: "a",
      }),
      message("after", "u1", NOON + 2 * MINUTE),
    ]);
    // Newest first: `after` must not group with the notice, and the notice is
    // its own row rather than a message bubble.
    expect(
      shape([
        message("a", "u1", NOON, { pinnedAt: NOON }),
        message("notice", "u1", NOON + MINUTE, {
          body: "",
          systemKind: "pin",
          systemActorId: "u1",
          systemTargetId: "a",
        }),
        message("after", "u1", NOON + 2 * MINUTE),
      ]),
    ).toEqual(["day", "a:false", "system:notice", "after:false"]);
    const notice = rows.find((row) => row.kind === "system");
    expect(notice).toMatchObject({ kind: "system", actorId: "u1", targetId: "a" });
  });
});

describe("groupReactions", () => {
  it("counts per emoji and marks the viewer's own", () => {
    expect(
      groupReactions(
        [
          { userId: "u1", emoji: "👍" },
          { userId: "me", emoji: "👍" },
          { userId: "u2", emoji: "🎉" },
        ],
        "me",
      ),
    ).toEqual([
      { emoji: "👍", count: 2, mine: true },
      { emoji: "🎉", count: 1, mine: false },
    ]);
  });
});
