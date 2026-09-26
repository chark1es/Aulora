import { Permission } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedChannel, seedDevice, seedWorkspace } from "./helpers";

describe("mls key packages", () => {
  it("publishes, lists and consumes KeyPackages once", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const deviceId = await seedDevice(t, "user-1");
    const asUser1 = t.withIdentity({ subject: "user-1" });

    await asUser1.mutation(api.mls.publishKeyPackage, { deviceId, keyPackage: "a2V5LTE=" });
    await asUser1.mutation(api.mls.publishKeyPackage, { deviceId, keyPackage: "a2V5LTI=" });

    const unused = await asUser1.query(api.mls.listUnused, { deviceId });
    expect(unused.map((row) => row.keyPackage)).toEqual(["a2V5LTE=", "a2V5LTI="]);

    const taken = await asUser1.mutation(api.mls.consume, { deviceId, count: 1 });
    expect(taken).toEqual(["a2V5LTE="]);
    expect(await asUser1.query(api.mls.listUnused, { deviceId })).toHaveLength(1);

    const rest = await asUser1.mutation(api.mls.consume, { deviceId, count: 5 });
    expect(rest).toEqual(["a2V5LTI="]);
    expect(await asUser1.mutation(api.mls.consume, { deviceId })).toEqual([]);
  });

  it("refuses to consume another user's device", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }, { userId: "user-2" }] });
    const deviceId = await seedDevice(t, "user-1");
    const asUser2 = t.withIdentity({ subject: "user-2" });
    await expect(asUser2.mutation(api.mls.consume, { deviceId })).rejects.toThrow("Unknown device");
  });
});

describe("mls commits", () => {
  it("orders commits by epoch and tracks the current epoch", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });

    await asUser1.mutation(api.mls.appendCommit, {
      channelId,
      epoch: 2,
      commitCiphertext: "Y29tbWl0LTI=",
      welcomeCiphertext: "d2VsY29tZS0y",
    });
    await asUser1.mutation(api.mls.appendCommit, {
      channelId,
      epoch: 1,
      commitCiphertext: "Y29tbWl0LTE=",
    });
    await asUser1.mutation(api.mls.appendCommit, {
      channelId,
      epoch: 3,
      commitCiphertext: "Y29tbWl0LTM=",
    });

    const commits = await asUser1.query(api.mls.listCommits, { channelId });
    expect(commits.map((commit) => commit.epoch)).toEqual([1, 2, 3]);
    expect(commits[1]?.welcomeCiphertext).toBe("d2VsY29tZS0y");

    const afterOne = await asUser1.query(api.mls.listCommits, { channelId, afterEpoch: 1 });
    expect(afterOne.map((commit) => commit.epoch)).toEqual([2, 3]);

    expect(await asUser1.query(api.mls.currentEpoch, { channelId })).toBe(3);
  });

  it("requires ViewChannel to append a commit", async () => {
    const t = newTest();
    await seedWorkspace(t, {
      everyonePermissions: Permission.ReadHistory,
      members: [{ userId: "user-1" }],
    });
    const channelId = await seedChannel(t);
    const asUser1 = t.withIdentity({ subject: "user-1" });
    await expect(
      asUser1.mutation(api.mls.appendCommit, {
        channelId,
        epoch: 1,
        commitCiphertext: "Y29tbWl0",
      }),
    ).rejects.toThrow("Missing permission");
  });
});
