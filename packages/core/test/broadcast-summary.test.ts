import { expect, it, vi } from "vitest";
import { summaryMentionIncreased } from "../src/chat/broadcast-feedback";
import { orderMentionSuggestions } from "../src/chat/mention-suggestions";
import { sendThreadReply } from "../src/chat/thread-send";

it("suppresses only mass cues, including when a direct cue replaces a mass cue", () => {
  expect(summaryMentionIncreased({ mentionCount: 1, massMentionCount: 1 }, undefined, true)).toBe(
    false,
  );
  expect(
    summaryMentionIncreased(
      { mentionCount: 2, massMentionCount: 1 },
      { mentionCount: 1, massMentionCount: 1 },
      true,
    ),
  ).toBe(true);
  expect(
    summaryMentionIncreased(
      { mentionCount: 2, massMentionCount: 0 },
      { mentionCount: 2, massMentionCount: 1 },
      true,
    ),
  ).toBe(true);
  expect(summaryMentionIncreased({ mentionCount: 1 }, undefined, true)).toBe(false);
});

it("always sends the thread reply before the optional channel copy and isolates copy errors", async () => {
  const order: string[] = [];
  const onError = vi.fn();
  await sendThreadReply(
    async () => {
      order.push("reply");
    },
    async () => {
      order.push("copy");
      throw new Error("offline");
    },
    onError,
  );
  expect(order).toEqual(["reply", "copy"]);
  expect(onError).toHaveBeenCalledOnce();
});

it("orders both clients' autocomplete groups before limiting results", () => {
  expect(
    orderMentionSuggestions([
      { key: "user:a" },
      { key: "role:b" },
      { key: "everyone" },
      { key: "here" },
      { key: "role:a" },
    ]).map((r) => r.key),
  ).toEqual(["here", "everyone", "role:b", "role:a", "user:a"]);
});
