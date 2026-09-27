import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

describe("devices.upsert", () => {
  it("requires authentication", async () => {
    const t = newTest();
    await expect(t.mutation(api.devices.upsert, { platform: "web" })).rejects.toThrow();
  });

  it("creates once and refreshes the same push token", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });

    const first = await asUser.mutation(api.devices.upsert, {
      platform: "web",
      pushToken: "token-1",
    });
    const second = await asUser.mutation(api.devices.upsert, {
      platform: "web",
      pushToken: "token-1",
    });
    expect(second.deviceId).toBe(first.deviceId);

    const devices = await asUser.query(api.devices.list, {});
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ platform: "web", pushToken: "token-1" });
  });

  it("keeps distinct push tokens separate and scopes the list to the caller", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    await asUser1.mutation(api.devices.upsert, { platform: "web", pushToken: "a" });
    await asUser1.mutation(api.devices.upsert, { platform: "web", pushToken: "b" });
    await asUser2.mutation(api.devices.upsert, { platform: "web", pushToken: "c" });

    expect(await asUser1.query(api.devices.list, {})).toHaveLength(2);
    expect(await asUser2.query(api.devices.list, {})).toHaveLength(1);
  });

  it("revokes one of the caller's devices", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });
    const { deviceId } = await asUser.mutation(api.devices.upsert, {
      platform: "web",
      pushToken: "token-1",
    });
    expect(await asUser.mutation(api.devices.revoke, { deviceId })).toBeNull();
    expect(await asUser.query(api.devices.list, {})).toHaveLength(0);
  });
});
