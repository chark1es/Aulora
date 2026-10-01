import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

const ENV_KEYS = [
  "AULORA_UPDATE_MANIFEST_URL",
  "AULORA_UPDATE_GITHUB_REPO",
  "AULORA_UPDATE_CHANNEL",
  "AULORA_AUTO_UPDATE",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("updates.check", () => {
  it("is limited to the instance admin", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.action(api.updates.check, {})).rejects.toThrow("Instance admin");
  });

  it("reports a configuration error without calling the network", async () => {
    process.env.AULORA_UPDATE_MANIFEST_URL = "http://example.com/latest.json";
    process.env.AULORA_AUTO_UPDATE = "true";
    const t = newTest();
    await seedWorkspace(t);
    const asOwner = t.withIdentity({ subject: "owner-1" });
    const result = await asOwner.action(api.updates.check, {});
    expect(result).toMatchObject({
      updateAvailable: false,
      apply: "none",
      autoUpdate: true,
      error: "Update manifest URL must use https.",
    });
    expect(result.currentVersion).toBe(result.sourceVersion);
  });
});

const hostStatus = {
  currentVersion: "0.1.0",
  latestVersion: "0.2.0",
  updateAvailable: true,
  notes: "New release",
  error: null,
  autoUpdate: false,
  phase: "idle" as const,
  checkedAt: Date.now(),
};

describe("workspace update requests", () => {
  it("limits status and every operation to the owner", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "member" }] });
    const member = t.withIdentity({ subject: "member" });
    await expect(member.query(api.updates.status, {})).rejects.toThrow("Instance admin");
    for (const command of ["check", "download", "restart"] as const) {
      await expect(member.mutation(api.updates.request, { command })).rejects.toThrow(
        "Instance admin",
      );
    }
    await expect(member.query(api.updates.version, {})).rejects.toThrow("Instance admin");
  });

  it("requires a live watcher and a downloaded release before restart", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const owner = t.withIdentity({ subject: "owner-1" });
    await expect(owner.mutation(api.updates.request, { command: "download" })).rejects.toThrow(
      "watcher is offline",
    );
    await t.mutation(internal.updates.hostReport, { status: hostStatus });
    await expect(owner.mutation(api.updates.request, { command: "restart" })).rejects.toThrow(
      "Download the update",
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.query("workspaceUpdate").first();
      if (row) await ctx.db.patch(row._id, { hostSeenAt: Date.now() - 31_000 });
    });
    await expect(owner.mutation(api.updates.request, { command: "download" })).rejects.toThrow(
      "watcher is offline",
    );
  });

  it("queues one operation, claims it once, and requires ready state to install", async () => {
    const t = newTest();
    await seedWorkspace(t);
    const owner = t.withIdentity({ subject: "owner-1" });
    await t.mutation(internal.updates.hostReport, { status: hostStatus });
    await owner.mutation(api.updates.request, { command: "download" });
    await expect(owner.mutation(api.updates.request, { command: "download" })).rejects.toThrow(
      "already in progress",
    );
    expect(await t.mutation(internal.updates.hostPoll, {})).toBe("download");
    expect(await t.mutation(internal.updates.hostPoll, {})).toBeNull();
    await t.mutation(internal.updates.hostReport, { status: { ...hostStatus, phase: "ready" } });
    await owner.mutation(api.updates.request, { command: "restart" });
    expect(await t.mutation(internal.updates.hostPoll, {})).toBe("restart");
    await t.mutation(internal.updates.hostReport, {
      status: { ...hostStatus, currentVersion: "0.2.0", updateAvailable: false },
    });
    expect(await owner.query(api.updates.status, {})).toMatchObject({
      currentVersion: "0.2.0",
      updateAvailable: false,
      phase: "idle",
    });
  });
});
