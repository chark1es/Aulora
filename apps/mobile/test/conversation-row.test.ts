import { describe, expect, it } from "vitest";
import { rowAccessibilityLabel } from "../src/lib/conversation-row";

describe("rowAccessibilityLabel", () => {
  it("reads the title and plain unread state", () => {
    expect(
      rowAccessibilityLabel("design", { unread: true, unreadCount: 2, mentionCount: 0 }, false),
    ).toBe("design, unread");
  });

  it("names the mention count and keeps singular mentions singular", () => {
    expect(
      rowAccessibilityLabel("general", { unread: true, unreadCount: 1, mentionCount: 1 }, false),
    ).toBe("general, unread, 1 mention");
    expect(
      rowAccessibilityLabel("general", { unread: true, unreadCount: 4, mentionCount: 4 }, false),
    ).toBe("general, unread, 4 mentions");
  });

  it("keeps muted independent of unread", () => {
    expect(rowAccessibilityLabel("random", undefined, true)).toBe("random, muted");
    expect(
      rowAccessibilityLabel("random", { unread: true, unreadCount: 3, mentionCount: 2 }, true),
    ).toBe("random, muted, unread, 2 mentions");
  });
});
