import { describe, expect, it } from "vitest";
import {
  normalizeChannelSummary,
  normalizeMessagePayloads,
  normalizeStoredFile,
} from "../src/chat/normalize";

describe("normalizeChannelSummary", () => {
  it("keeps absent optional fields absent", () => {
    expect(
      normalizeChannelSummary({
        id: "c1",
        kind: "text",
        categoryId: null,
        name: "general",
        topic: null,
        archived: false,
      }),
    ).toEqual({
      id: "c1",
      kind: "text",
      categoryId: null,
      name: "general",
      topic: null,
      archived: false,
    });
  });

  it("carries every optional field the server sent", () => {
    const summary = normalizeChannelSummary({
      id: "c1",
      kind: "dm",
      categoryId: null,
      name: null,
      topic: null,
      archived: false,
      isPrivate: true,
      position: 3,
      memberIds: ["a", "b"],
      hidden: false,
      muted: true,
      pinned: true,
      pinnedAt: 10,
      overrides: [{ targetId: "r1", targetType: "role", allow: 1n, deny: 0n }],
    });
    expect(summary.isPrivate).toBe(true);
    expect(summary.position).toBe(3);
    expect(summary.memberIds).toEqual(["a", "b"]);
    expect(summary.hidden).toBe(false);
    expect(summary.muted).toBe(true);
    expect(summary.pinned).toBe(true);
    expect(summary.pinnedAt).toBe(10);
    expect(summary.overrides).toHaveLength(1);
  });
});

describe("normalizeStoredFile", () => {
  it("turns an absent thumbnail into null", () => {
    const file = normalizeStoredFile({
      id: "f1",
      uploaderId: "u1",
      sizeBytes: 10,
      name: "a.png",
      mime: "image/png",
      dimensions: null,
      blurhash: null,
      url: "https://example.test/a.png",
    });
    expect(file.thumbnailUrl).toBeNull();
  });
});

describe("normalizeMessagePayloads", () => {
  it("fills absent marker flags on a page and its messages", () => {
    const normalized = normalizeMessagePayloads({
      page: [
        { id: "m1", mentionUserIds: ["u1"] },
        { id: "m2", mentionUserIds: [], mentionEveryone: true, mentionHere: true },
      ],
      isDone: true,
      continueCursor: "",
    });
    expect(normalized.page[0]).toMatchObject({ mentionEveryone: false, mentionHere: false });
    expect(normalized.page[1]).toMatchObject({ mentionEveryone: true, mentionHere: true });
  });

  it("leaves values without messages alone", () => {
    expect(normalizeMessagePayloads(null)).toBeNull();
    expect(normalizeMessagePayloads("text")).toBe("text");
    expect(normalizeMessagePayloads({ ok: true })).toEqual({ ok: true });
  });
});
