import {
  isWebhookUserId,
  parseWebhookPath,
  parseWebhookPayload,
  WEBHOOK_LIMITS,
  WEBHOOK_USER_ID_PREFIX,
  webhookUrl,
} from "@aulora/core";
import { describe, expect, it } from "vitest";

describe("webhook identity", () => {
  it("recognises webhook author ids and nothing else", () => {
    expect(isWebhookUserId(`${WEBHOOK_USER_ID_PREFIX}abc`)).toBe(true);
    expect(isWebhookUserId("bot_abc")).toBe(false);
    expect(isWebhookUserId("user-1")).toBe(false);
  });
});

describe("webhook URLs", () => {
  it("builds and parses the same path", () => {
    const url = webhookUrl("https://chat.example.com/", "id1", "awh_secret");
    expect(url).toBe("https://chat.example.com/api/webhooks/id1/awh_secret");
    expect(parseWebhookPath(new URL(url).pathname)).toEqual({ id: "id1", token: "awh_secret" });
  });

  it("rejects paths that are not exactly id and token", () => {
    expect(parseWebhookPath("/api/webhooks/")).toBeNull();
    expect(parseWebhookPath("/api/webhooks/id1")).toBeNull();
    expect(parseWebhookPath("/api/webhooks/id1/")).toBeNull();
    expect(parseWebhookPath("/api/webhooks//tok")).toBeNull();
    expect(parseWebhookPath("/api/webhooks/id1/tok/extra")).toBeNull();
    expect(parseWebhookPath("/api/auth/id1/tok")).toBeNull();
  });
});

describe("webhook payloads", () => {
  it("reads content and trims it", () => {
    expect(parseWebhookPayload({ content: "  hello  " })).toEqual({ ok: true, content: "hello" });
  });

  it("accepts text as a Slack-style alias, with content winning", () => {
    expect(parseWebhookPayload({ text: "hi" })).toEqual({ ok: true, content: "hi" });
    expect(parseWebhookPayload({ content: "a", text: "b" })).toEqual({ ok: true, content: "a" });
  });

  it("rejects anything without usable text", () => {
    for (const body of [
      null,
      "hi",
      3,
      [],
      {},
      { content: "   " },
      { content: 4 },
      { text: null },
    ]) {
      expect(parseWebhookPayload(body)).toEqual({ ok: false, error: "invalid_payload" });
    }
  });

  it("enforces the length limit on the trimmed text", () => {
    const longest = "x".repeat(WEBHOOK_LIMITS.maxContentLength);
    expect(parseWebhookPayload({ content: ` ${longest} ` }).ok).toBe(true);
    expect(parseWebhookPayload({ content: `${longest}x` })).toEqual({
      ok: false,
      error: "content_too_long",
    });
  });
});
