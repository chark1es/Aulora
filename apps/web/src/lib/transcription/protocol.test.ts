import { describe, expect, it } from "vitest";
import {
  backoffMs,
  buildAuthFrame,
  classifyClose,
  END_FRAME,
  parseServerMessage,
  transcribeSocketUrl,
} from "./protocol";

describe("frames", () => {
  it("builds the auth and end frames exactly as the protocol specifies", () => {
    expect(JSON.parse(buildAuthFrame("abc.def"))).toEqual({ type: "auth", token: "abc.def" });
    expect(JSON.parse(END_FRAME)).toEqual({ type: "end" });
  });

  it("recognises ready and ignores everything else", () => {
    expect(
      parseServerMessage(JSON.stringify({ type: "ready", sessionId: "s1", speakerKey: "user:u" })),
    ).toEqual({ type: "ready", sessionId: "s1", speakerKey: "user:u" });
    expect(parseServerMessage(JSON.stringify({ type: "ready" }))).toEqual({ type: "other" });
    expect(parseServerMessage("not json")).toEqual({ type: "other" });
    expect(parseServerMessage(new ArrayBuffer(4))).toEqual({ type: "other" });
  });
});

describe("transcribeSocketUrl", () => {
  it("maps the site origin to the websocket endpoint", () => {
    expect(transcribeSocketUrl("https://chat.example.com", "/transcribe/")).toBe(
      "wss://chat.example.com/transcribe/ws",
    );
    expect(transcribeSocketUrl("http://localhost:8080", "/transcribe/")).toBe(
      "ws://localhost:8080/transcribe/ws",
    );
  });

  it("refuses other schemes and bad origins", () => {
    expect(transcribeSocketUrl("javascript:alert(1)", "/transcribe/")).toBeNull();
    expect(transcribeSocketUrl("tauri://localhost", "/transcribe/")).toBeNull();
    expect(transcribeSocketUrl("", "/transcribe/")).toBeNull();
  });
});

describe("classifyClose", () => {
  it("treats a normal close as idle and a drop as retryable", () => {
    expect(classifyClose(1000)).toEqual({ kind: "idle" });
    expect(classifyClose(1006)).toEqual({ kind: "retry" });
    expect(classifyClose(1011)).toEqual({ kind: "retry" });
    expect(classifyClose(4401)).toEqual({ kind: "retry" });
    expect(classifyClose(4408)).toEqual({ kind: "retry" });
  });

  it("retries an identity that is already streaming (the transcriber evicts the older stream)", () => {
    expect(classifyClose(4429)).toEqual({ kind: "retry", conflict: true });
  });

  it("treats 4410 (replaced by a newer connection) as terminal for that socket: not retry, not idle", () => {
    expect(classifyClose(4410)).toEqual({ kind: "replaced" });
  });

  it("treats 4411 (the session ended) as terminal and not an error: no retry, no idle reconnect", () => {
    expect(classifyClose(4411)).toEqual({ kind: "ended" });
  });

  it("stops on errors that retrying cannot fix", () => {
    for (const code of [4400, 4503]) {
      expect(classifyClose(code).kind).toBe("stop");
    }
  });
});

describe("backoffMs", () => {
  it("grows exponentially with jitter and caps at 30 s", () => {
    const low = () => 0;
    const high = () => 0.999;
    expect(backoffMs(0, low)).toBe(500);
    expect(backoffMs(0, high)).toBe(1000);
    expect(backoffMs(3, high)).toBeGreaterThan(7_900);
    expect(backoffMs(3, high)).toBeLessThanOrEqual(8_000);
    expect(backoffMs(20, high)).toBeGreaterThan(29_900);
    expect(backoffMs(20, high)).toBeLessThanOrEqual(30_000);
    expect(backoffMs(20, low)).toBe(15_000);
  });
});
