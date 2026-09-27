import { Permission } from "@aulora/core";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isSealed, openBytes, openString } from "../convex/lib/sse";
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

function tokenFromUrl(url: string): string {
  const parsed = new URL(url, "http://localhost");
  const token = parsed.searchParams.get("token");
  if (token === null) {
    throw new Error("URL did not carry a download token");
  }
  return token;
}

describe("files", () => {
  it("seals uploaded bytes and metadata and serves decrypted bytes", async () => {
    const { t, asUser1 } = await setup();
    const uploadUrl = await asUser1.mutation(api.files.generateUploadUrl, {});
    expect(uploadUrl).toMatch(/^https?:\/\//);

    const storageId = await storeBlob(t, 16);
    const fileId = await asUser1.action(api.files.finalize, {
      storageId,
      name: "name",
      mime: "image/png",
      sizeBytes: 16,
      dimensions: "1x1",
    });

    const file = await asUser1.query(api.files.get, { fileId });
    expect(file).toMatchObject({
      uploaderId: "user-1",
      sizeBytes: 16,
      name: "name",
      mime: "image/png",
      dimensions: "1x1",
    });
    expect(typeof file?.url).toBe("string");

    // The row holds sealed metadata and the sealed blob, not the plaintext.
    const row = await t.run(async (ctx) => await ctx.db.get(fileId));
    if (row === null) {
      throw new Error("file row missing");
    }
    expect(isSealed(row.nameCiphertext ?? "")).toBe(true);
    await expect(openString({ scope: "file.name" }, row.nameCiphertext ?? "")).resolves.toBe(
      "name",
    );

    const sealedBytes = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(row.storageId);
      return blob === null ? null : Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    if (sealedBytes === null) {
      throw new Error("sealed bytes missing");
    }
    expect(sealedBytes.some((byte) => byte !== 0)).toBe(true);
    await expect(
      openBytes(
        { scope: "file.bytes", recordId: row.sealedStorageId },
        new Uint8Array(sealedBytes),
      ),
    ).resolves.toEqual(new Uint8Array(16));

    // The original plaintext upload is gone.
    const original = await t.run(async (ctx) => await ctx.storage.get(storageId));
    expect(original).toBeNull();

    // The signed URL yields the decrypted bytes.
    const { bytes } = await asUser1.action(api.files.download, {
      token: tokenFromUrl(file?.url ?? ""),
    });
    expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(new Uint8Array(16)));
  });

  it("returns plaintext metadata for a batch of files", async () => {
    const { t, asUser1 } = await setup();
    const ids: Id<"files">[] = [];
    for (let i = 0; i < 2; i += 1) {
      const storageId = await storeBlob(t, 8);
      ids.push(
        await asUser1.action(api.files.finalize, {
          storageId,
          name: `file-${i}`,
          mime: "text/plain",
          sizeBytes: 8,
        }),
      );
    }
    const views = await asUser1.query(api.files.getMany, { fileIds: ids });
    expect(views.map((view) => view.name).sort()).toEqual(["file-0", "file-1"]);
  });

  it("enforces the upload size cap against the stored size", async () => {
    process.env.UPLOAD_MAX_BYTES = "8";
    const { t, asUser1 } = await setup();
    const storageId = await storeBlob(t, 16);
    await expect(
      asUser1.action(api.files.finalize, {
        storageId,
        name: "big",
        mime: "application/octet-stream",
        sizeBytes: 16,
      }),
    ).rejects.toThrow("size cap");
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
    await expect(
      asUser1.action(api.files.finalize, {
        storageId,
        name: "nope",
        mime: "text/plain",
        sizeBytes: 8,
      }),
    ).rejects.toThrow("Missing permission");
  });
});
