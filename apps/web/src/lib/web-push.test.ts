import { afterEach, describe, expect, it } from "vitest";
import { decodeBase64Url, isWebPushSupported, serializeSubscription } from "./web-push";

const globalWithTauri = globalThis as { __TAURI__?: unknown };

afterEach(() => {
  delete globalWithTauri.__TAURI__;
});

describe("decodeBase64Url", () => {
  it("decodes base64 and base64url into bytes", () => {
    expect(Array.from(decodeBase64Url("SGVsbG8"))).toEqual([72, 101, 108, 108, 111]);
    // URL-safe alphabet plus missing padding.
    expect(Array.from(decodeBase64Url("_-8"))).toEqual([255, 239]);
  });

  it("round-trips a 65-byte uncompressed VAPID point", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    for (let index = 1; index < bytes.length; index += 1) {
      bytes[index] = index;
    }
    const encoded = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(Array.from(decodeBase64Url(encoded))).toEqual(Array.from(bytes));
  });
});

describe("serializeSubscription", () => {
  it("keeps only the endpoint and keys the dispatcher needs", () => {
    const json = serializeSubscription({
      endpoint: "https://push.example.com/x",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(json).not.toBeNull();
    expect(JSON.parse(json as string)).toEqual({
      endpoint: "https://push.example.com/x",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("returns null when the subscription is incomplete", () => {
    expect(serializeSubscription({ endpoint: "https://push.example.com/x" })).toBeNull();
    expect(serializeSubscription({ endpoint: "", keys: { p256dh: "p", auth: "a" } })).toBeNull();
  });
});

describe("isWebPushSupported", () => {
  it("is false in jsdom without PushManager", () => {
    delete globalWithTauri.__TAURI__;
    expect(isWebPushSupported()).toBe(false);
  });

  it("is false inside the desktop shell", () => {
    globalWithTauri.__TAURI__ = { core: { invoke: () => Promise.resolve() } };
    expect(isWebPushSupported()).toBe(false);
  });
});
