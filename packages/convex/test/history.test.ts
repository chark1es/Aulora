import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace } from "./helpers";

async function addDevice(
  t: ReturnType<typeof newTest>,
  userId: string,
  identityKey: string,
  sharingKey?: string,
): Promise<Id<"devices">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("devices", {
      userId,
      platform: "web",
      identityKey,
      lastSeen: Date.now(),
      ...(sharingKey !== undefined ? { sharingKey } : {}),
    });
  });
}

describe("history archives", () => {
  it("stores one snapshot per epoch and lists it for members", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });

    const first = await asUser.mutation(api.history.putArchive, {
      channelId,
      epoch: 2,
      archiveCiphertext: "cipher-2",
    });
    expect(first.updated).toBe(false);
    const again = await asUser.mutation(api.history.putArchive, {
      channelId,
      epoch: 2,
      archiveCiphertext: "cipher-2b",
    });
    expect(again.updated).toBe(true);

    const archives = await asUser.query(api.history.listArchives, { channelId });
    expect(archives).toEqual([{ epoch: 2, archiveCiphertext: "cipher-2b" }]);
  });

  it("requires ViewChannel", async () => {
    const t = newTest();
    await seedWorkspace(t, { everyonePermissions: 0n, members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1"] });
    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.query(api.history.listArchives, { channelId })).rejects.toThrow(
      "Missing permission",
    );
  });
});

describe("history sharing", () => {
  it("requests, shares and consumes a bundle for a new device", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const newDevice = await addDevice(t, "user-2", "identity-2", "sharing-2");
    const asUser2 = t.withIdentity({ subject: "user-2" });
    const asUser1 = t.withIdentity({ subject: "user-1" });

    await asUser2.mutation(api.history.requestHistory, {
      channelId,
      deviceId: newDevice,
    });
    const requests = await asUser1.query(api.history.listRequests, { channelId });
    expect(requests.map((row) => row.deviceId)).toEqual([newDevice]);

    await asUser1.mutation(api.history.shareBundle, {
      channelId,
      recipientDeviceId: newDevice,
      envelope: "aulora-history-v1.envelope",
    });

    const bundles = await asUser2.query(api.history.listBundles, { deviceId: newDevice });
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0];
    if (!bundle) {
      throw new Error("expected a history bundle");
    }
    expect(bundle.envelope).toBe("aulora-history-v1.envelope");

    await asUser2.mutation(api.history.markBundleConsumed, { bundleId: bundle.id });
    expect(await asUser1.query(api.history.listRequests, { channelId })).toHaveLength(0);
  });

  it("refuses to send a bundle to a non-member", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      members: [{ userId: "user-1" }, { userId: "user-2" }, { userId: "outsider" }],
    });
    const channelId = await seedChannel(t, { memberIds: ["user-1", "user-2"] });
    const outsiderDevice = await addDevice(t, "outsider", "identity-3", "sharing-3");
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser1.mutation(api.history.shareBundle, {
        channelId,
        recipientDeviceId: outsiderDevice,
        envelope: "envelope",
      }),
    ).rejects.toThrow("not a channel member");
  });
});
