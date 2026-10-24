import type { ChannelSummary } from "@aulora/core";
import { describe, expect, it } from "vitest";
import {
  describeLastUsed,
  postableChannels,
  validateWebhookName,
  webhookChannelLabel,
} from "../components/admin/webhooks/webhook-format";

const channel = (overrides: Partial<ChannelSummary>): ChannelSummary => ({
  id: "c",
  kind: "text",
  categoryId: null,
  name: "general",
  topic: null,
  archived: false,
  ...overrides,
});

describe("webhook format helpers", () => {
  it("offers only live text and announcement channels", () => {
    const list = [
      channel({ id: "a" }),
      channel({ id: "b", kind: "announcement" }),
      channel({ id: "c", kind: "voice" }),
      channel({ id: "d", kind: "dm" }),
      channel({ id: "e", archived: true }),
    ];
    expect(postableChannels(list).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("labels a channel by supplied name, then its own, then a fallback", () => {
    const list = [channel({ id: "a", name: "alerts" })];
    expect(webhookChannelLabel("a", list, new Map([["a", "renamed"]]))).toBe("#renamed");
    expect(webhookChannelLabel("a", list, undefined)).toBe("#alerts");
    expect(webhookChannelLabel("zzz", list, undefined)).toBe("Unknown channel");
  });

  it("validates names like the server", () => {
    expect(validateWebhookName("  ")).not.toBeNull();
    expect(validateWebhookName("x".repeat(81))).not.toBeNull();
    expect(validateWebhookName(" ok ")).toBeNull();
  });

  it("describes recent use", () => {
    const now = 10 * 86_400_000;
    expect(describeLastUsed(null, now)).toBe("Never used");
    expect(describeLastUsed(now - 5_000, now)).toBe("Used just now");
    expect(describeLastUsed(now - 5 * 60_000, now)).toBe("Used 5 min ago");
    expect(describeLastUsed(now - 3 * 3_600_000, now)).toBe("Used 3 h ago");
    expect(describeLastUsed(now - 2 * 86_400_000, now)).toBe("Used 2 d ago");
  });
});
