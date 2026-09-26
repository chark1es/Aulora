import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

afterEach(() => {
  delete process.env.BACKUP_TOKEN;
});

async function ownerTest() {
  const t = newTest();
  await seedWorkspace(t, {
    ownerId: "owner-1",
    members: [{ userId: "owner-1" }, { userId: "user-2" }],
  });
  return {
    t,
    asOwner: t.withIdentity({ subject: "owner-1" }),
    asUser: t.withIdentity({ subject: "user-2" }),
  };
}

describe("backups.request", () => {
  it("queues a manual run for the owner and lists it", async () => {
    const { asOwner } = await ownerTest();
    const id = await asOwner.mutation(api.backups.request, {});
    expect(typeof id).toBe("string");

    const rows = await asOwner.query(api.backups.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "manual", status: "requested" });
  });

  it("rejects a non-owner", async () => {
    const { asUser } = await ownerTest();
    await expect(asUser.mutation(api.backups.request, {})).rejects.toThrow("Instance admin only");
    await expect(asUser.query(api.backups.list, {})).rejects.toThrow("Instance admin only");
  });
});

describe("backups.record", () => {
  it("refuses when no token is configured or the token is wrong", async () => {
    const { t } = await ownerTest();
    await expect(
      t.mutation(api.backups.record, { token: "x", status: "succeeded", startedAt: 1 }),
    ).rejects.toThrow("Invalid backup token");

    process.env.BACKUP_TOKEN = "runner-token";
    await expect(
      t.mutation(api.backups.record, { token: "wrong", status: "succeeded", startedAt: 1 }),
    ).rejects.toThrow("Invalid backup token");
  });

  it("records a successful run for a valid token", async () => {
    process.env.BACKUP_TOKEN = "runner-token";
    const { t, asOwner } = await ownerTest();
    const result = await t.mutation(api.backups.record, {
      token: "runner-token",
      status: "succeeded",
      startedAt: 1,
      finishedAt: 2,
      sizeBytes: 4096,
      location: "backups/2026-09-26/",
      message: "export + dump uploaded",
    });
    expect(result.ok).toBe(true);

    const rows = await asOwner.query(api.backups.list, {});
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      sizeBytes: 4096,
      location: "backups/2026-09-26/",
    });
  });
});

describe("backups.nightly", () => {
  it("records the nightly intent while backups are enabled", async () => {
    const { t, asOwner } = await ownerTest();
    await t.mutation(internal.backups.nightly, {});
    const rows = await asOwner.query(api.backups.list, {});
    expect(rows[0]).toMatchObject({ trigger: "cron", status: "requested" });
  });

  it("does nothing once the owner disables backups", async () => {
    const { t, asOwner } = await ownerTest();
    await asOwner.mutation(api.instance.updateBackups, { enabled: false });
    const result = await t.mutation(internal.backups.nightly, {});
    expect(result).toBeNull();
    expect(await asOwner.query(api.backups.list, {})).toHaveLength(0);
  });
});
