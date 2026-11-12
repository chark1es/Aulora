import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

afterEach(() => vi.useRealTimers());

it("keeps the public replay shim harmless and atomically claims each internal page once", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "message" });
  expect(await t.action(api.notifications.dispatchNow, { messageId })).toEqual({
    sent: 0,
    skipped: "noop",
  });
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(true);
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(false);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "page2" }),
  ).toBe(true);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "page2" }),
  ).toBe(false);
});

it("bounds claim retention and rejects expired delivery after claims are deleted", async () => {
  vi.useFakeTimers();
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "message" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 1501; i++)
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId,
        cursor: String(i),
      });
  });
  vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
  expect(await t.mutation(internal.notifications.pruneDeliveryClaims, {})).toBe(500);
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId })).toBe(false);
  expect(await t.query(internal.notifications.recipientPage, { messageId })).toEqual({
    recipients: [],
    cursor: null,
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    await t.run(async (ctx) => await ctx.db.query("notificationDeliveryClaims").collect()),
  ).toEqual([]);
  expect(await t.mutation(internal.notifications.pruneDeliveryClaims, {})).toBe(0);
});

it.each([false, true])("claims single-page broadcasts only (broadcast=%s)", async (broadcast) => {
  vi.useFakeTimers();
  const relay = await import("../convex/lib/pushRelay");
  const web = await import("../convex/lib/webPush");
  vi.spyOn(web, "vapidConfigFromEnv").mockReturnValue(null);
  vi.spyOn(relay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example",
    token: "synthetic",
    serverId: "s",
  });
  const send = vi.spyOn(relay, "sendWake").mockResolvedValue({ ok: true, status: 200 });
  try {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "viewer" }] });
    const channelId = await seedChannel(t, { memberIds: ["viewer"] });
    await t.run((ctx) =>
      ctx.db.insert("devices", {
        userId: "viewer",
        platform: "ios",
        lastSeen: 1,
        pushToken: "synthetic",
      }),
    );
    const messageId = await t.withIdentity({ subject: "owner-1" }).mutation(api.messages.send, {
      channelId,
      body: broadcast ? "@everyone" : "hello",
      mentionEveryone: broadcast,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(send).toHaveBeenCalledTimes(broadcast ? 1 : 2);
    expect(await t.run((ctx) => ctx.db.query("notificationDeliveryClaims").collect())).toHaveLength(
      broadcast ? 2 : 0,
    );
  } finally {
    vi.restoreAllMocks();
  }
});

it("recovers expired and legacy leases, fences stale workers, and retains recipient receipts", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  const key = { messageId, cursor: "recipient:member-1" };
  expect(
    await t.mutation(internal.notifications.claimDelivery, {
      ...key,
      leaseToken: "old",
      recoveryCursor: "",
    }),
  ).toBe(true);
  await t.run(async (ctx) => {
    const row = await ctx.db.query("notificationDeliveryClaims").first();
    if (row === null) throw new Error("Missing claim");
    await ctx.db.patch(row._id, { leaseUntil: 1 });
  });
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(
    await t.mutation(internal.notifications.claimDelivery, { ...key, leaseToken: "new" }),
  ).toBe(true);
  await t.mutation(internal.notifications.completeDelivery, { ...key, leaseToken: "old" });
  expect(await t.query(internal.notifications.deliveryCompleted, key)).toBe(false);
  await t.mutation(internal.notifications.completeDelivery, { ...key, leaseToken: "new" });
  expect(await t.query(internal.notifications.deliveryCompleted, key)).toBe(true);
  expect(
    await t.mutation(internal.notifications.claimDelivery, { ...key, leaseToken: "retry" }),
  ).toBe(false);
  await t.run(async (ctx) => {
    await ctx.db.insert("notificationDeliveryClaims", { messageId, cursor: "legacy" });
  });
  expect(
    await t.mutation(internal.notifications.claimDelivery, { messageId, cursor: "legacy" }),
  ).toBe(true);
});

it("retries a failed recipient after lease expiry without repeating completed recipients", async () => {
  vi.useFakeTimers();
  const relay = await import("../convex/lib/pushRelay");
  const web = await import("../convex/lib/webPush");
  vi.spyOn(web, "vapidConfigFromEnv").mockReturnValue(null);
  vi.spyOn(relay, "pushRelayConfigFromEnv").mockReturnValue({
    url: "https://relay.example",
    token: "synthetic",
    serverId: "s",
  });
  const attempts = new Map<string, number>();
  vi.spyOn(relay, "sendWake").mockImplementation((payload) => {
    const count = (attempts.get(payload.token) ?? 0) + 1;
    attempts.set(payload.token, count);
    return Promise.resolve({
      ok: payload.token !== "retry" || count > 1,
      status: payload.token === "retry" && count === 1 ? 503 : 200,
    });
  });
  try {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "done" }, { userId: "retry" }] });
    const channelId = await seedChannel(t, { memberIds: ["done", "retry"] });
    await t.run(async (ctx) => {
      for (const userId of ["done", "retry"])
        await ctx.db.insert("devices", { userId, platform: "ios", lastSeen: 1, pushToken: userId });
    });
    const messageId = await t
      .withIdentity({ subject: "owner-1" })
      .mutation(api.messages.send, { channelId, body: "@everyone", mentionEveryone: true });
    await t.action(internal.notifications.dispatchForMessage, { messageId });
    expect(attempts).toEqual(
      new Map([
        ["done", 1],
        ["retry", 1],
      ]),
    );
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await t.mutation(internal.notifications.recoverDeliveryLeases, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(attempts).toEqual(
      new Map([
        ["done", 1],
        ["retry", 2],
      ]),
    );
    expect(await t.query(internal.notifications.deliveryCompleted, { messageId, cursor: "" })).toBe(
      true,
    );
  } finally {
    vi.restoreAllMocks();
  }
});

it("advances recovery cursors so a failing batch cannot starve later leases", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  await t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("notificationDeliveryClaims", {
        messageId,
        cursor: `page-${i}`,
        leaseUntil: 1,
        retryAt: 1,
      });
  });
  const progressed = () =>
    t.run(
      async (ctx) =>
        (await ctx.db.query("notificationDeliveryClaims").collect()).filter(
          (r) => (r.retryAt ?? 0) > 1,
        ).length,
    );
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(await progressed()).toBe(100);
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  expect(await progressed()).toBe(101);
});

it("never adds a ping on edit and redacts deleted broadcast metadata", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const client = t.withIdentity({ subject: "owner-1" });
  const ordinary = await client.mutation(api.messages.send, { channelId, body: "ordinary" });
  await client.mutation(api.messages.edit, { messageId: ordinary, body: "@everyone @here" });
  const edited = await t.run((ctx) => ctx.db.get(ordinary));
  expect(edited?.mentionEveryone).toBeUndefined();
  expect(edited?.mentionHere).toBeUndefined();
  const broadcast = await client.mutation(api.messages.send, {
    channelId,
    body: "@everyone",
    mentionEveryone: true,
  });
  await client.mutation(api.messages.remove, { messageId: broadcast });
  const page = await client.query(api.messages.list, {
    channelId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.find((row) => row.id === broadcast)).toMatchObject({
    body: "",
    mentionEveryone: false,
    mentionHere: false,
    mentionUserIds: [],
    mentionChannelIds: [],
    mentionCategoryIds: [],
  });
  expect(await t.mutation(internal.notifications.claimDelivery, { messageId: broadcast })).toBe(
    false,
  );
});

it("stops re-driving permanently failing delivery pages and receipts at twelve attempts", async () => {
  const t = newTest();
  await seedWorkspace(t);
  const channelId = await seedChannel(t);
  const messageId = await t
    .withIdentity({ subject: "owner-1" })
    .mutation(api.messages.send, { channelId, body: "hello" });
  for (const cursor of ["page", "recipient:member-1"]) {
    for (let attempt = 1; attempt <= 12; attempt++) {
      expect(await t.mutation(internal.notifications.claimDelivery, { messageId, cursor })).toBe(
        true,
      );
      await t.run(async (ctx) => {
        const row = (await ctx.db.query("notificationDeliveryClaims").take(100)).find(
          (entry) => entry.messageId === messageId && entry.cursor === cursor,
        );
        if (row === undefined) throw new Error("Missing claim");
        await ctx.db.patch(row._id, { leaseUntil: 1, retryAt: 1 });
      });
    }
    expect(await t.mutation(internal.notifications.claimDelivery, { messageId, cursor })).toBe(
      false,
    );
  }
  await t.mutation(internal.notifications.recoverDeliveryLeases, {});
  for (const cursor of ["page", "recipient:member-1"]) {
    expect(await t.query(internal.notifications.deliveryCompleted, { messageId, cursor })).toBe(
      true,
    );
  }
});
