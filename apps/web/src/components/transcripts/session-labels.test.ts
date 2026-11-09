import { describe, expect, it } from "vitest";
import { formatSessionLength, sessionTitle } from "./session-labels";

describe("session labels", () => {
  it("names a session by its channel and falls back for rooms and unknown channels", () => {
    const titles = new Map([["c1", "Lounge"]]);
    expect(sessionTitle("c1", titles)).toBe("Lounge");
    expect(sessionTitle("gone", titles)).toBe("Call");
    expect(sessionTitle(null, titles)).toBe("Scheduled room");
  });

  it("words the length of a session", () => {
    expect(formatSessionLength(0, null)).toBe("In progress");
    expect(formatSessionLength(0, 20_000)).toBe("Under a minute");
    expect(formatSessionLength(0, 12 * 60_000)).toBe("12 min");
    expect(formatSessionLength(0, 60 * 60_000)).toBe("1 h");
    expect(formatSessionLength(0, 65 * 60_000)).toBe("1 h 5 min");
  });
});
