import { describe, expect, it } from "vitest";
import {
  clampOpenLeadMinutes,
  clampRetentionDays,
  guestLinkUrl,
  isTranscriptionModelId,
  normalizeGuestText,
  parseTranscriptionSpeakerKey,
  scheduledCallNotOpen,
  scheduledCallOpensAt,
  transcriptionSpeakerKey,
} from "../src/index";

describe("guest call text normalization", () => {
  it("normalizes unicode, strips controls and collapses whitespace", () => {
    expect(normalizeGuestText("  Alex\u202e\u0000   Visitor  ")).toBe("Alex Visitor");
    expect(normalizeGuestText("Ａｌｉｃｅ")).toBe("Alice");
    expect(normalizeGuestText("\u200b\u200b")).toBe("");
  });

  it("builds a fragment link so the token never reaches a server log", () => {
    expect(guestLinkUrl("https://chat.example.com/", "agu_abc")).toBe(
      "https://chat.example.com/call/guest#agu_abc",
    );
  });
});

describe("scheduled call time helpers", () => {
  it("computes the open time and enforces the window", () => {
    const startsAt = 1_000_000;
    expect(scheduledCallOpensAt(startsAt, 5)).toBe(startsAt - 300_000);
  });

  it("returns the typed error payload with the open time", () => {
    const payload = scheduledCallNotOpen(1_000_000, 10);
    expect(payload.code).toBe("ScheduledCallNotOpen");
    expect(payload.startsAt).toBe(1_000_000);
    expect(payload.opensAt).toBe(400_000);
    expect(payload.message).toContain("hasn't started");
  });

  it("clamps the open lead", () => {
    expect(clampOpenLeadMinutes(-5)).toBe(0);
    expect(clampOpenLeadMinutes(999)).toBe(120);
    expect(clampOpenLeadMinutes(Number.NaN)).toBe(5);
  });
});

describe("transcription helpers", () => {
  it("accepts only allowlisted models", () => {
    expect(isTranscriptionModelId("large-v3-turbo")).toBe(true);
    expect(isTranscriptionModelId("https://evil.example/model")).toBe(false);
    expect(isTranscriptionModelId("large-v3")).toBe(false);
  });

  it("round-trips speaker keys", () => {
    expect(transcriptionSpeakerKey("user", "u1")).toBe("user:u1");
    expect(transcriptionSpeakerKey("guest", "g1")).toBe("guest:g1");
    expect(parseTranscriptionSpeakerKey("user:u1")).toEqual({ kind: "user", id: "u1" });
    expect(parseTranscriptionSpeakerKey("bot:u1")).toBeNull();
    expect(parseTranscriptionSpeakerKey("user:")).toBeNull();
  });

  it("clamps retention days", () => {
    expect(clampRetentionDays(-1)).toBe(0);
    expect(clampRetentionDays(30)).toBe(30);
    expect(clampRetentionDays(99_999)).toBe(3650);
    expect(clampRetentionDays(Number.POSITIVE_INFINITY)).toBe(30);
  });
});

describe("guest token shape", () => {
  it("accepts the 64-hex tokens the server mints and rejects look-alikes", async () => {
    const { GUEST_LINK_TOKEN_PREFIX, GUEST_SESSION_TOKEN_PREFIX, isWellFormedGuestToken } =
      await import("../src/guest-calls");
    const body = "0123456789abcdef".repeat(4);
    expect(
      isWellFormedGuestToken(`${GUEST_LINK_TOKEN_PREFIX}${body}`, GUEST_LINK_TOKEN_PREFIX),
    ).toBe(true);
    expect(
      isWellFormedGuestToken(`${GUEST_LINK_TOKEN_PREFIX}${body}`, GUEST_SESSION_TOKEN_PREFIX),
    ).toBe(false);
    expect(
      isWellFormedGuestToken(
        `${GUEST_LINK_TOKEN_PREFIX}${"a".repeat(31)}`,
        GUEST_LINK_TOKEN_PREFIX,
      ),
    ).toBe(false);
    expect(
      isWellFormedGuestToken(`${GUEST_LINK_TOKEN_PREFIX}${body}!`, GUEST_LINK_TOKEN_PREFIX),
    ).toBe(false);
  });
});
