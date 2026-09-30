import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { sealString } from "../convex/lib/sse";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

let now = Date.UTC(2026, 9, 12);
beforeEach(() => {
  now = Date.UTC(2026, 9, 12);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());
async function licensed() {
  const t = newTest();
  await seedWorkspace(t, { members: [{ userId: "owner" }, { userId: "u1" }, { userId: "u2" }] });
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (!server) throw new Error("Missing server");
    await ctx.db.patch(server._id, {
      licenseKey: `AULORA2_${"a".repeat(43)}`,
      licenseValidation: {
        keyHash: "hash",
        licenseId: "license-1",
        billingModel: "monthly-active-users",
        state: "active",
        tier: "commercial",
        licensee: "Acme",
        issuedAt: now,
        expiresAt: now + 40 * 86400000,
        checkedAt: now,
        validUntil: now + 40 * 86400000,
        note: "valid",
        tags: [],
        seats: 1,
      },
    });
  });
  return t;
}
describe("licensed monthly active users", () => {
  it("counts repeated heartbeats and login events once per member, including invisible sessions", async () => {
    const t = await licensed();
    const user = t.withIdentity({ subject: "u1" });
    await user.mutation(api.presence.heartbeat, { status: "offline" });
    await user.mutation(api.presence.heartbeat, {});
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u2" });
    const rows = await t.run((ctx) => ctx.db.query("licenseUsageMonths").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: "2026-10", activeUsers: 2 });
  });
  it("starts a new distinct count at the UTC month boundary", async () => {
    const t = await licensed();
    now = Date.UTC(2026, 9, 31, 23, 59, 59);
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    now += 1000;
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    const rows = await t.run((ctx) => ctx.db.query("licenseUsageMonths").collect());
    expect(rows.map((r) => [r.month, r.activeUsers])).toEqual([
      ["2026-10", 1],
      ["2026-11", 1],
    ]);
  });
  it("does not record activity without an activated license or for nonmembers", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "u1" }] });
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    expect(await t.run((ctx) => ctx.db.query("licenseActivity").collect())).toHaveLength(0);
    const active = await licensed();
    await active.mutation(internal.licenseUsage.recordLogin, { userId: "not-a-member" });
    expect(await active.run((ctx) => ctx.db.query("licenseActivity").collect())).toHaveLength(0);
  });
  it("stops recording after the paid license expires", async () => {
    const t = await licensed();
    now += 41 * 86400000;
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    expect(await t.run((ctx) => ctx.db.query("licenseActivity").collect())).toHaveLength(0);
  });
  it("retains billing activity during a validation outage within the verified paid term", async () => {
    const t = await licensed();
    await t.run(async (ctx) => {
      const server = await ctx.db.query("server").first();
      if (!server?.licenseValidation) throw new Error("Missing proof");
      await ctx.db.patch(server._id, {
        licenseValidation: { ...server.licenseValidation, validUntil: now - 1 },
      });
    });
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    expect(
      (await t.run((ctx) => ctx.db.query("licenseUsageMonths").collect()))[0].activeUsers,
    ).toBe(1);
  });
  it("counts server-accepted message activity without needing presence", async () => {
    const t = await licensed();
    const channelId = await seedChannel(t);
    const user = t.withIdentity({ subject: "u1" });
    await user.mutation(api.messages.send, { channelId, body: "hello" });
    await user.mutation(api.messages.send, { channelId, body: "hello again" });
    expect(
      (await t.run((ctx) => ctx.db.query("licenseUsageMonths").collect()))[0].activeUsers,
    ).toBe(1);
  });
  it("keeps aggregate reports queued after key removal and deletes local identities only after final acknowledgment", async () => {
    const t = await licensed();
    await t.mutation(internal.licenseUsage.recordLogin, { userId: "u1" });
    await t.run(async (ctx) => {
      const server = await ctx.db.query("server").first();
      if (!server) throw new Error("Missing server");
      const ciphertext = await sealString(
        { scope: "license-report-key", recordId: "license-1" },
        `AULORA2_${"a".repeat(43)}`,
      );
      await ctx.db.insert("licenseReportKeys", {
        licenseId: "license-1",
        keyHash: "hash",
        ciphertext,
        instanceId: server._id,
      });
      await ctx.db.patch(server._id, { licenseKey: undefined, licenseValidation: undefined });
    });
    now = Date.UTC(2026, 10, 4);
    const groups = await t.query(internal.licenseUsage.reports, {});
    const report = groups[0]?.reports[0];
    if (!report) throw new Error("Missing queued report");
    expect(report).toMatchObject({ month: "2026-10", activeUsers: 1, final: true });
    expect(JSON.stringify(groups)).not.toContain('"userId"');
    expect(JSON.stringify(groups)).not.toContain("AULORA2_");
    const id = report.id;
    await t.mutation(internal.licenseUsage.acknowledge, { id, activeUsers: 2, final: true });
    await t.mutation(internal.licenseUsage.purgeIdentities, {
      licenseId: "license-1",
      month: "2026-10",
    });
    expect(await t.run((ctx) => ctx.db.query("licenseActivity").collect())).toHaveLength(1);
    await t.mutation(internal.licenseUsage.acknowledge, { id, activeUsers: 1, final: true });
    await t.mutation(internal.licenseUsage.purgeIdentities, {
      licenseId: "license-1",
      month: "2026-10",
    });
    expect(await t.run((ctx) => ctx.db.query("licenseActivity").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("licenseUsageMonths").collect())).toHaveLength(1);
    expect((await t.query(internal.licenseUsage.reports, {}))[0]?.reports).toHaveLength(0);
  });
  it("protects activity summaries from ordinary users", async () => {
    const t = await licensed();
    await expect(
      t.withIdentity({ subject: "u1" }).query(api.licenseUsage.summary),
    ).rejects.toThrow();
  });
});
