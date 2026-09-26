import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest } from "./helpers";

const SAFETY = "1234567890".repeat(6);

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

describe("devices approval", () => {
  it("bootstraps the first device, then requires a verified approver", async () => {
    const t = newTest();
    const asUser = t.withIdentity({ subject: "user-1" });
    const first = await addDevice(t, "user-1", "identity-1");
    const second = await addDevice(t, "user-1", "identity-2");

    const bootstrapped = await asUser.mutation(api.devices.approve, {
      deviceId: first,
      method: "safety_number",
      safetyNumber: SAFETY,
    });
    expect(bootstrapped).toEqual({ approved: true, alreadyVerified: false });

    // A second device can no longer bootstrap: a trust root now exists.
    await expect(
      asUser.mutation(api.devices.approve, {
        deviceId: second,
        method: "safety_number",
        safetyNumber: SAFETY,
      }),
    ).rejects.toThrow("existing verified device");

    const approved = await asUser.mutation(api.devices.approve, {
      deviceId: second,
      method: "qr",
      safetyNumber: SAFETY,
      approverDeviceId: first,
    });
    expect(approved.approved).toBe(true);

    const devices = await asUser.query(api.devices.list, {});
    expect(devices.every((device) => device.verifiedAt !== null)).toBe(true);
    expect(await asUser.query(api.devices.hasVerifiedDevice, {})).toBe(true);

    const trail = await asUser.query(api.devices.approvals, {});
    expect(trail).toHaveLength(2);
    expect(trail[0]?.method).toBe("qr");
  });

  it("requires 60 digits and rejects unverified approvers", async () => {
    const t = newTest();
    const asUser = t.withIdentity({ subject: "user-1" });
    const first = await addDevice(t, "user-1", "identity-1");
    const second = await addDevice(t, "user-1", "identity-2");
    await asUser.mutation(api.devices.approve, {
      deviceId: first,
      method: "safety_number",
      safetyNumber: SAFETY,
    });

    await expect(
      asUser.mutation(api.devices.approve, {
        deviceId: second,
        method: "safety_number",
        safetyNumber: "123",
        approverDeviceId: first,
      }),
    ).rejects.toThrow("60 digits");

    await expect(
      asUser.mutation(api.devices.approve, {
        deviceId: second,
        method: "safety_number",
        safetyNumber: SAFETY,
        approverDeviceId: second,
      }),
    ).rejects.toThrow("not verified");
  });

  it("never approves another user's device", async () => {
    const t = newTest();
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const other = await addDevice(t, "user-2", "identity-2");
    await expect(
      asUser1.mutation(api.devices.approve, {
        deviceId: other,
        method: "safety_number",
        safetyNumber: SAFETY,
      }),
    ).rejects.toThrow("Unknown device");
  });

  it("revokes a device and records the sharing keys", async () => {
    const t = newTest();
    const asUser = t.withIdentity({ subject: "user-1" });
    const first = await addDevice(t, "user-1", "identity-1");
    const second = await addDevice(t, "user-1", "identity-2", "sharing-2");
    await asUser.mutation(api.devices.approve, {
      deviceId: first,
      method: "safety_number",
      safetyNumber: SAFETY,
    });
    await asUser.mutation(api.devices.approve, {
      deviceId: second,
      method: "qr",
      safetyNumber: SAFETY,
      approverDeviceId: first,
    });

    const keys = await asUser.query(api.devices.sharingKeys, { deviceIds: [second] });
    expect(keys).toEqual([{ deviceId: second, userId: "user-1", sharingKey: "sharing-2" }]);

    await asUser.mutation(api.devices.revoke, {
      deviceId: second,
      approverDeviceId: first,
    });
    const devices = await asUser.query(api.devices.list, {});
    expect(devices.find((device) => device.id === second)?.verifiedAt).toBeNull();
  });
});
