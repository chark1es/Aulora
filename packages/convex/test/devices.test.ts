import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

describe("devices.upsert", () => {
  it("requires authentication", async () => {
    const t = newTest();
    await expect(
      t.mutation(api.devices.upsert, { platform: "web", identityKey: "pub-1" }),
    ).rejects.toThrow();
  });

  it("creates once and refreshes the same identity", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const asUser = t.withIdentity({ subject: "user-1" });

    const first = await asUser.mutation(api.devices.upsert, {
      platform: "web",
      identityKey: "pub-1",
    });
    const second = await asUser.mutation(api.devices.upsert, {
      platform: "web",
      identityKey: "pub-1",
      pushToken: "token-1",
    });
    expect(second.deviceId).toBe(first.deviceId);

    const devices = await asUser.query(api.devices.list, {});
    expect(devices).toHaveLength(1);
    expect(devices[0]?.identityKey).toBe("pub-1");
  });

  it("keeps distinct identities as separate devices and scopes the list to the caller", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const asUser1 = t.withIdentity({ subject: "user-1" });
    const asUser2 = t.withIdentity({ subject: "user-2" });

    await asUser1.mutation(api.devices.upsert, { platform: "web", identityKey: "a" });
    await asUser1.mutation(api.devices.upsert, { platform: "web", identityKey: "b" });
    await asUser2.mutation(api.devices.upsert, { platform: "web", identityKey: "c" });

    expect(await asUser1.query(api.devices.list, {})).toHaveLength(2);
    expect(await asUser2.query(api.devices.list, {})).toHaveLength(1);
  });
});
