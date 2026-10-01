import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_LIMIT,
  notificationContent,
  shouldNotify,
} from "../src/lib/notifications-format";

describe("notificationContent", () => {
  it("titles with the channel and trims the body", () => {
    expect(notificationContent("general", "  hello  ")).toEqual({
      title: "#general",
      body: "hello",
    });
  });

  it("falls back to a generic title and truncates long bodies", () => {
    const long = "x".repeat(NOTIFICATION_BODY_LIMIT + 50);
    const content = notificationContent(undefined, long);
    expect(content.title).toBe("New message");
    expect(content.body.length).toBe(NOTIFICATION_BODY_LIMIT + 1);
    expect(content.body.endsWith("…")).toBe(true);
  });

  it("marks mentions and honours a custom limit", () => {
    expect(notificationContent("general", "hi", { mention: true }).title).toBe(
      "Mention in #general",
    );
    expect(notificationContent("general", "abcdef", { limit: 3 }).body).toBe("abc…");
  });
});

describe("shouldNotify", () => {
  const base = { id: "m1", authorId: "b", createdAt: 5_000, text: "hi" };

  it("notifies for another author's fresh message with text", () => {
    expect(shouldNotify(base, "a", 1_000)).toBe(true);
  });

  it("skips your own messages, history and empty text", () => {
    expect(shouldNotify({ ...base, authorId: "a" }, "a", 1_000)).toBe(false);
    expect(shouldNotify(base, "a", 6_000)).toBe(false);
    expect(shouldNotify({ ...base, text: "   " }, "a", 1_000)).toBe(false);
    expect(shouldNotify({ ...base, text: undefined }, "a", 1_000)).toBe(false);
  });
});
