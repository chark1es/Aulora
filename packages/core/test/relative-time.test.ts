import { describe, expect, it } from "vitest";
import { timeAgo } from "../src/relative-time";

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  it("buckets elapsed time like the clients always have", () => {
    expect(timeAgo(NOW, NOW)).toBe("just now");
    expect(timeAgo(NOW - 59 * 1000, NOW)).toBe("just now");
    expect(timeAgo(NOW - MINUTE, NOW)).toBe("1m ago");
    expect(timeAgo(NOW - 59 * MINUTE, NOW)).toBe("59m ago");
    expect(timeAgo(NOW - HOUR, NOW)).toBe("1h ago");
    expect(timeAgo(NOW - 23 * HOUR, NOW)).toBe("23h ago");
    expect(timeAgo(NOW - DAY, NOW)).toBe("1d ago");
    expect(timeAgo(NOW - 6 * DAY, NOW)).toBe("6d ago");
  });

  it("never reports a negative age for a clock that runs ahead", () => {
    expect(timeAgo(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });

  it("hands anything older than a week to the caller's absolute formatter", () => {
    expect(timeAgo(NOW - 7 * DAY, NOW, { formatAbsolute: () => "Oct 11" })).toBe("Oct 11");
  });
});
