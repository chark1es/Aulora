import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bot } from "../src/bot.js";
import type { BotOptions } from "../src/config.js";
import { AuloraError } from "../src/errors.js";
import { FakeAulora, FakeConvexError } from "./fakeServer.js";
import { int64 } from "./helpers.js";

function makeBot(fake: FakeAulora, overrides: Partial<BotOptions> = {}): Bot {
  return new Bot({
    token: "abt_test",
    siteUrl: fake.url,
    convexUrl: fake.url,
    ...overrides,
  });
}

describe("Convex client", () => {
  let fake: FakeAulora;

  beforeEach(async () => {
    fake = new FakeAulora();
    await fake.start();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("exchanges the API token and sends the JWT as a Bearer header", async () => {
    const bot = makeBot(fake);

    await bot.call("channels:list", {});

    expect(fake.tokenRequests).toBe(1);
    expect(fake.tokenAuthorizations).toEqual(["Bot abt_test"]);
    expect(fake.calls[0]?.authorization).toBe("Bearer jwt-1");
    expect(fake.calls[0]?.path).toBe("channels:list");
  });

  it("refreshes the JWT when it is within five minutes of expiry", async () => {
    fake.tokenExpiresInMs = 60_000;
    const bot = makeBot(fake);

    await bot.call("channels:list", {});
    await bot.call("channels:list", {});

    expect(fake.tokenRequests).toBe(2);
    expect(fake.calls[1]?.authorization).toBe("Bearer jwt-2");
  });

  it("refreshes once and replays the call after an authentication failure", async () => {
    fake.apiFailures.push({
      path: "channels:list",
      status: 401,
      body: { status: "error", errorMessage: "Unauthenticated" },
      remaining: 1,
    });
    const bot = makeBot(fake);

    await bot.call("channels:list", {});

    expect(fake.tokenRequests).toBe(2);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.authorization).toBe("Bearer jwt-1");
    expect(fake.calls[1]?.authorization).toBe("Bearer jwt-2");
  });

  it("maps a Convex error body to AuloraError with the server message", async () => {
    fake.handlers.set("messages:send", () => {
      throw new FakeConvexError("Missing permission", { code: "FORBIDDEN" });
    });
    const bot = makeBot(fake);

    const failure = bot.call("messages:send", { channelId: "chan_1", body: "hi" }, "mutation");

    await expect(failure).rejects.toBeInstanceOf(AuloraError);
    await expect(failure).rejects.toMatchObject({
      message: "Missing permission",
      code: "FORBIDDEN",
      data: { code: "FORBIDDEN" },
    });
  });

  it("maps token endpoint failures to AuloraError", async () => {
    fake.tokenFailures.push({
      status: 401,
      body: { error: "invalid_token" },
      remaining: 1,
    });
    const bot = makeBot(fake);

    await expect(bot.call("channels:list", {})).rejects.toMatchObject({
      name: "AuloraError",
      code: "invalid_token",
      status: 401,
    });
  });

  it("retries queries on 5xx with backoff but does not retry mutations", async () => {
    fake.apiFailures.push({
      path: "channels:list",
      status: 500,
      body: { status: "error", errorMessage: "boom" },
      remaining: 1,
    });
    const bot = makeBot(fake);

    await bot.call("channels:list", {});
    expect(fake.calls).toHaveLength(2);

    fake.apiFailures.push({
      path: "messages:edit",
      status: 500,
      body: { status: "error", errorMessage: "boom" },
      remaining: 1,
    });
    await expect(
      bot.call("messages:edit", { messageId: "msg_1" }, "mutation"),
    ).rejects.toMatchObject({ code: "http_error", status: 500 });
    expect(fake.calls.filter((call) => call.path === "messages:edit")).toHaveLength(1);
  });

  it("retries queries after a network failure", async () => {
    fake.apiFailures.push({ path: "channels:list", network: true, remaining: 1 });
    const bot = makeBot(fake);

    await bot.call("channels:list", {});

    expect(fake.calls).toHaveLength(2);
  });

  it("decodes int64 values in responses without breaking the page shape", async () => {
    const channel = {
      id: "chan_1",
      kind: "text",
      categoryId: null,
      name: "general",
      topic: null,
      archived: false,
      isPrivate: false,
      overrides: [{ targetId: "role_1", targetType: "role", allow: int64(5n), deny: int64(0n) }],
      position: 0,
      hidden: false,
      muted: false,
      pinned: false,
      pinnedAt: null,
    };
    fake.handlers.set("channels:list", () => ({
      page: [channel],
      isDone: true,
      continueCursor: "",
    }));
    const bot = makeBot(fake);

    const channels = await bot.channels.list();

    expect(channels[0]?.overrides[0]?.allow).toBe(5n);
    expect(channels[0]?.overrides[0]?.deny).toBe(0n);
    expect(channels[0]?.name).toBe("general");
  });

  it("rejects invalid configuration before any network call", () => {
    expect(() => new Bot({ token: "", siteUrl: "http://x", convexUrl: "http://x" })).toThrow(
      AuloraError,
    );
    expect(() => new Bot({ token: "t", siteUrl: "not a url", convexUrl: "http://x" })).toThrow(
      /absolute URL/,
    );
  });
});
