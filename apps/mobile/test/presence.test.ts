import { describe, expect, it } from "vitest";
import { isActivePresence, presenceLabel, typingLabel } from "../src/lib/presence";

describe("presenceLabel", () => {
  it("maps each status and falls back to offline", () => {
    expect(presenceLabel("online")).toBe("Online");
    expect(presenceLabel("idle")).toBe("Idle");
    expect(presenceLabel("dnd")).toBe("Do not disturb");
    expect(presenceLabel("offline")).toBe("Offline");
    expect(presenceLabel("nonsense")).toBe("Offline");
  });
});

describe("isActivePresence", () => {
  it("is true for every non-offline status", () => {
    expect(isActivePresence("online")).toBe(true);
    expect(isActivePresence("idle")).toBe(true);
    expect(isActivePresence("dnd")).toBe(true);
    expect(isActivePresence("offline")).toBe(false);
  });
});

describe("typingLabel", () => {
  const now = 10_000;
  const names: Record<string, string> = { a: "Ada", b: "Bo", c: "Cy" };
  const nameOf = (userId: string) => names[userId] ?? userId;

  it("returns null for no typers, expired typers, or only yourself", () => {
    expect(typingLabel([], "a", nameOf, now)).toBeNull();
    expect(typingLabel([{ userId: "b", expiresAt: now - 1 }], "a", nameOf, now)).toBeNull();
    expect(typingLabel([{ userId: "a", expiresAt: now + 1 }], "a", nameOf, now)).toBeNull();
  });

  it("formats one, two and many typers", () => {
    expect(typingLabel([{ userId: "b", expiresAt: now + 1 }], "a", nameOf, now)).toBe(
      "Bo is typing…",
    );
    expect(
      typingLabel(
        [
          { userId: "b", expiresAt: now + 1 },
          { userId: "c", expiresAt: now + 1 },
        ],
        "a",
        nameOf,
        now,
      ),
    ).toBe("Bo and Cy are typing…");
    expect(
      typingLabel(
        [
          { userId: "b", expiresAt: now + 1 },
          { userId: "c", expiresAt: now + 1 },
          { userId: "d", expiresAt: now + 1 },
        ],
        "a",
        nameOf,
        now,
      ),
    ).toBe("3 people are typing…");
  });
});
