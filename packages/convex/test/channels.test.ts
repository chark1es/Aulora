import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "./setup";

const SERVER_SETTINGS = {
  signupEnabled: true,
  inviteOnly: true,
  allowedEmailDomains: [],
};

async function seedChannels(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("roles", {
      key: EVERYONE_ROLE_ID,
      name: EVERYONE_ROLE_ID,
      position: 0,
      permissions: Permission.ViewChannel | Permission.ReadHistory,
      hoisted: false,
      mentionable: true,
    });
    const publicId = await ctx.db.insert("channels", {
      kind: "text",
      nameCiphertext: "cHVibGlj",
      overrides: [],
      archived: false,
    });
    const secretId = await ctx.db.insert("channels", {
      kind: "text",
      nameCiphertext: "c2VjcmV0",
      overrides: [
        {
          targetId: EVERYONE_ROLE_ID,
          targetType: "role",
          allow: 0n,
          deny: Permission.ViewChannel,
        },
      ],
      archived: false,
    });
    await ctx.db.insert("members", {
      userId: "user-1",
      roleIds: [EVERYONE_ROLE_ID],
      joinedAt: Date.now(),
    });
    return { publicId, secretId };
  });
}

describe("channels.list", () => {
  it("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.channels.list)).rejects.toThrow();
  });

  it("hides channels without ViewChannel", async () => {
    const t = convexTest(schema, modules);
    const { publicId, secretId } = await seedChannels(t);

    const asUser = t.withIdentity({ subject: "user-1" });
    const visible = await asUser.query(api.channels.list);
    const ids = visible.map((channel) => channel.id);

    expect(ids).toContain(publicId);
    expect(ids).not.toContain(secretId);
  });

  it("shows every channel to the workspace owner", async () => {
    const t = convexTest(schema, modules);
    const { secretId } = await seedChannels(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("server", {
        name: "Acme",
        iconSeed: "seed",
        ownerId: "owner-1",
        settings: SERVER_SETTINGS,
      });
    });

    const asOwner = t.withIdentity({ subject: "owner-1" });
    const visible = await asOwner.query(api.channels.list);
    expect(visible.map((channel) => channel.id)).toContain(secretId);
  });
});
