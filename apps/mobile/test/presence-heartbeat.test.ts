import { describe, expect, it } from "vitest";
import { heartbeatStatusForAppState } from "../src/lib/presence-heartbeat";

describe("heartbeatStatusForAppState", () => {
  it("heartbeats online while the app is active", () => {
    expect(heartbeatStatusForAppState("active")).toBe("online");
  });

  it("heartbeats idle when the app is not in the foreground", () => {
    expect(heartbeatStatusForAppState("background")).toBe("idle");
    expect(heartbeatStatusForAppState("inactive")).toBe("idle");
  });

  it("falls back to idle for any other state", () => {
    expect(heartbeatStatusForAppState("unknown")).toBe("idle");
    expect(heartbeatStatusForAppState("extension")).toBe("idle");
  });
});
