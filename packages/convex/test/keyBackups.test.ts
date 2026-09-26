import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest } from "./helpers";

describe("keyBackups", () => {
  it("round-trips one backup per user and replaces it", async () => {
    const t = newTest();
    const asUser = t.withIdentity({ subject: "user-1" });
    expect(await asUser.query(api.keyBackups.get, {})).toBeNull();

    await asUser.mutation(api.keyBackups.put, {
      backupCiphertext: "aulora-backup-v1.abc",
      kdfParams: JSON.stringify({ algorithm: "argon2id", salt: "s", t: 3, m: 65536, p: 1 }),
    });
    const first = await asUser.query(api.keyBackups.get, {});
    expect(first?.backupCiphertext).toBe("aulora-backup-v1.abc");

    const replaced = await asUser.mutation(api.keyBackups.put, {
      backupCiphertext: "aulora-backup-v1.def",
      kdfParams: first?.kdfParams ?? "{}",
    });
    expect(replaced.updated).toBe(true);
    const second = await asUser.query(api.keyBackups.get, {});
    expect(second?.backupCiphertext).toBe("aulora-backup-v1.def");

    await asUser.mutation(api.keyBackups.remove, {});
    expect(await asUser.query(api.keyBackups.get, {})).toBeNull();
  });

  it("scopes backups to the caller", async () => {
    const t = newTest();
    await t
      .withIdentity({ subject: "user-1" })
      .mutation(api.keyBackups.put, { backupCiphertext: "v1.one", kdfParams: "{}" });
    const asUser2 = t.withIdentity({ subject: "user-2" });
    expect(await asUser2.query(api.keyBackups.get, {})).toBeNull();
  });

  it("rejects an empty backup", async () => {
    const t = newTest();
    await expect(
      t
        .withIdentity({ subject: "user-1" })
        .mutation(api.keyBackups.put, { backupCiphertext: "", kdfParams: "{}" }),
    ).rejects.toThrow("must not be empty");
  });
});
