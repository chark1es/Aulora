import { EVERYONE_ROLE_ID } from "@aulora/core";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { modules } from "./setup";

afterEach(() => {
  delete process.env.SETUP_TOKEN;
});

const OWNER = {
  name: "Acme",
  email: "owner@example.com",
  password: "correct-horse-battery",
};

describe("setup.finalize", () => {
  it("creates the server singleton, the @everyone role and the owner member", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(internal.setupState.finalize, {
      name: "Acme",
      ownerId: "owner-1",
    });

    const server = await t.run(async (ctx) => await ctx.db.get(result.serverId));
    expect(server).toMatchObject({ name: "Acme", ownerId: "owner-1" });

    const role = await t.run(async (ctx) => await ctx.db.get(result.roleId));
    expect(role).toMatchObject({ key: EVERYONE_ROLE_ID, name: EVERYONE_ROLE_ID, position: 0 });

    const member = await t.run(
      async (ctx) =>
        await ctx.db
          .query("members")
          .withIndex("by_user", (q) => q.eq("userId", "owner-1"))
          .unique(),
    );
    expect(member?.roleIds).toContain(EVERYONE_ROLE_ID);

    const status = await t.query(api.setup.status);
    expect(status).toEqual({ initialized: true, name: "Acme" });
  });

  it("refuses a second initialization", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1" });
    await expect(
      t.mutation(internal.setupState.finalize, { name: "Other", ownerId: "owner-2" }),
    ).rejects.toThrow("already initialized");
  });
});

describe("setup.initialize", () => {
  it("refuses when SETUP_TOKEN is not configured", async () => {
    delete process.env.SETUP_TOKEN;
    const t = convexTest(schema, modules);
    await expect(t.action(api.setup.initialize, { token: "anything", ...OWNER })).rejects.toThrow(
      "Invalid setup token",
    );
  });

  it("refuses a wrong token", async () => {
    process.env.SETUP_TOKEN = "correct-token";
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.setup.initialize, { token: "wrong-token", ...OWNER }),
    ).rejects.toThrow("Invalid setup token");
  });

  it("accepts the correct token but refuses once initialized", async () => {
    process.env.SETUP_TOKEN = "correct-token";
    const t = convexTest(schema, modules);
    await t.mutation(internal.setupState.finalize, { name: "Acme", ownerId: "owner-1" });
    await expect(
      t.action(api.setup.initialize, { token: "correct-token", ...OWNER }),
    ).rejects.toThrow("already initialized");
  });
});
