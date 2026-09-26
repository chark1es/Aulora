import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seedWorkspace, storeBlob } from "./helpers";

afterEach(() => {
  delete process.env.UPLOAD_MAX_BYTES;
  delete process.env.UPLOAD_RATE_LIMIT;
});

async function setup(everyonePermissions?: bigint) {
  const t = newTest();
  await seedWorkspace(t, {
    ...(everyonePermissions !== undefined ? { everyonePermissions } : {}),
    members: [{ userId: "user-1" }],
  });
  return { t, asUser1: t.withIdentity({ subject: "user-1" }) };
}

describe("files", () => {
  it("generates an upload URL and records opaque metadata", async () => {
    const { t, asUser1 } = await setup();
    const uploadUrl = await asUser1.mutation(api.files.generateUploadUrl, {});
    expect(uploadUrl).toMatch(/^https?:\/\//);

    const storageId = await storeBlob(t, 16);
    const fileId = await asUser1.mutation(api.files.record, {
      storageId,
      sizeBytes: 16,
      nameCiphertext: "bmFtZQ==",
      mimeCiphertext: "aW1hZ2UvcG5n",
    });
    const file = await asUser1.query(api.files.get, { fileId });
    expect(file).toMatchObject({
      uploaderId: "user-1",
      sizeBytes: 16,
      nameCiphertext: "bmFtZQ==",
      mimeCiphertext: "aW1hZ2UvcG5n",
    });
    expect(typeof file?.url).toBe("string");
  });

  it("enforces the upload size cap against the stored size", async () => {
    process.env.UPLOAD_MAX_BYTES = "8";
    const { t, asUser1 } = await setup();
    const storageId = await storeBlob(t, 16);
    await expect(asUser1.mutation(api.files.record, { storageId, sizeBytes: 16 })).rejects.toThrow(
      "size cap",
    );
  });

  it("rate limits uploads per user", async () => {
    process.env.UPLOAD_RATE_LIMIT = "1";
    const { asUser1 } = await setup();
    await asUser1.mutation(api.files.generateUploadUrl, {});
    await expect(asUser1.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("requires AttachFiles", async () => {
    const { t, asUser1 } = await setup(Permission.ViewChannel | Permission.ReadHistory);
    await expect(asUser1.mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
      "Missing permission",
    );
    const storageId = await storeBlob(t, 8);
    await expect(asUser1.mutation(api.files.record, { storageId, sizeBytes: 8 })).rejects.toThrow(
      "Missing permission",
    );
  });
});
