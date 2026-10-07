import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace } from "./helpers";

afterEach(() => {
  delete process.env.UPLOAD_MAX_BYTES;
});

async function ownerTest() {
  const t = newTest();
  const { serverId } = await seedWorkspace(t, {
    ownerId: "owner-1",
    members: [{ userId: "owner-1" }, { userId: "user-2" }],
  });
  return {
    t,
    serverId,
    asOwner: t.withIdentity({ subject: "owner-1" }),
    asUser: t.withIdentity({ subject: "user-2" }),
  };
}

describe("instance admin authority", () => {
  it("allows the owner and rejects everyone else", async () => {
    const { asOwner, asUser } = await ownerTest();
    const settings = await asOwner.query(api.instance.settings, {});
    expect(settings.settings).toMatchObject({ storageQuotaBytes: 0, backupsEnabled: true });

    await expect(asUser.query(api.instance.settings, {})).rejects.toThrow("Instance admin only");
    await expect(
      asUser.mutation(api.instance.updateStorage, {
        storageQuotaBytes: 100,
        maxUploadBytes: 100,
      }),
    ).rejects.toThrow("Instance admin only");
  });
});

describe("instance.updateStorage", () => {
  it("persists a valid quota and caps", async () => {
    const { asOwner } = await ownerTest();
    const saved = await asOwner.mutation(api.instance.updateStorage, {
      storageQuotaBytes: 10 * 1024 * 1024 * 1024,
      maxUploadBytes: 50 * 1024 * 1024,
    });
    expect(saved.storageQuotaBytes).toBe(10 * 1024 * 1024 * 1024);
    const read = await asOwner.query(api.instance.settings, {});
    expect(read.settings.maxUploadBytes).toBe(50 * 1024 * 1024);
  });

  it("rejects a max upload above the quota and bad integers", async () => {
    const { asOwner } = await ownerTest();
    await expect(
      asOwner.mutation(api.instance.updateStorage, {
        storageQuotaBytes: 1024,
        maxUploadBytes: 2048,
      }),
    ).rejects.toThrow("cannot exceed the storage quota");
    await expect(
      asOwner.mutation(api.instance.updateStorage, {
        storageQuotaBytes: -1,
        maxUploadBytes: 1024,
      }),
    ).rejects.toThrow("non-negative integer");
    await expect(
      asOwner.mutation(api.instance.updateStorage, {
        storageQuotaBytes: 0,
        maxUploadBytes: 10,
      }),
    ).rejects.toThrow("at least 1 KiB");
  });
});

describe("effective max upload cap", () => {
  it("defaults to the env/default and prefers the stored instance setting", async () => {
    const { t, asOwner } = await ownerTest();

    // No instanceSettings row and no env override -> built-in 25 MiB default.
    delete process.env.UPLOAD_MAX_BYTES;
    expect((await t.query(api.server.publicConfig)).uploads.maxBytes).toBe(25 * 1024 * 1024);

    // Env overrides the default while no row exists.
    process.env.UPLOAD_MAX_BYTES = String(1024 * 1024);
    expect((await t.query(api.server.publicConfig)).uploads.maxBytes).toBe(1024 * 1024);

    // Once the operator saves a setting, it wins over the env value.
    delete process.env.UPLOAD_MAX_BYTES;
    await asOwner.mutation(api.instance.updateStorage, {
      storageQuotaBytes: 0,
      maxUploadBytes: 50 * 1024 * 1024,
    });
    expect((await t.query(api.server.publicConfig)).uploads.maxBytes).toBe(50 * 1024 * 1024);
  });
});

describe("instance.updatePushRelay", () => {
  it("normalizes the URL and stores the server id", async () => {
    const { asOwner } = await ownerTest();
    const saved = await asOwner.mutation(api.instance.updatePushRelay, {
      enabled: true,
      url: "https://relay.example.com/",
      serverId: "acme-1",
    });
    expect(saved.pushRelayUrl).toBe("https://relay.example.com");
    expect(saved.serverId).toBe("acme-1");
    expect(saved.pushRelayEnabled).toBe(true);
  });

  it("rejects a non-http URL", async () => {
    const { asOwner } = await ownerTest();
    await expect(
      asOwner.mutation(api.instance.updatePushRelay, { enabled: true, url: "ftp://relay" }),
    ).rejects.toThrow("absolute http(s) URL");
  });
});

describe("instance.overview", () => {
  it("reports counts, storage and license state without secrets", async () => {
    const { t, asOwner } = await ownerTest();
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(10)]));
      await ctx.db.insert("files", {
        storageId,
        sealedStorageId: storageId,
        uploaderId: "owner-1",
        sizeBytes: 2048,
        keyVersion: "1",
      });
    });

    const overview = await asOwner.query(api.instance.overview, {});
    expect(overview.counts.members).toBe(2);
    expect(overview.storage.usedBytes).toBe(2048);
    expect(overview.license.state).toBe("unlicensed");
    expect(overview.auth.local.enabled).toBe(true);
    expect(JSON.stringify(overview)).not.toContain("clientSecret");
  });
});
