import { describe, expect, it } from "vitest";
import { computeActivityStatus, IDLE_AFTER_MS } from "../lib/use-presence-heartbeat";

describe("computeActivityStatus", () => {
  const now = 1_000_000;

  it("is online when visible and recently active", () => {
    expect(
      computeActivityStatus({
        hidden: false,
        now,
        lastActive: now - 1_000,
        idleAfterMs: IDLE_AFTER_MS,
      }),
    ).toBe("online");
  });

  it("is idle while the tab is hidden even if just active", () => {
    expect(
      computeActivityStatus({
        hidden: true,
        now,
        lastActive: now,
        idleAfterMs: IDLE_AFTER_MS,
      }),
    ).toBe("idle");
  });

  it("is idle once the last activity is older than the threshold", () => {
    expect(
      computeActivityStatus({
        hidden: false,
        now,
        lastActive: now - IDLE_AFTER_MS - 1,
        idleAfterMs: IDLE_AFTER_MS,
      }),
    ).toBe("idle");
  });
});
