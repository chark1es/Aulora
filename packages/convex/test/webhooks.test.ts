import { EVERYONE_ROLE_ID, Permission, WEBHOOK_LIMITS, WEBHOOK_USER_ID_PREFIX } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

const asOwner = (t: Test) => t.withIdentity({ subject: "owner-1" });

async function setup() {
  const t = newTest();
  await seedWorkspace(t, {
    extraRoles: [{ key: "hooks", permissions: Permission.ManageWebhooks, position: 5 }],
    members: [{ userId: "manager-1", roleIds: [EVERYONE_ROLE_ID, "hooks"] }, { userId: "user-1" }],
  });
  const channelId = await seedChannel(t, { name: "alerts" });
  return { t, channelId };
}

async function createHook(t: Test, channelId: Id<"channels">, name = "Deploys") {
  return await asOwner(t).mutation(api.webhooks.create, { channelId, name });
}

function post(t: Test, webhookId: string, token: string, body: unknown) {
  return t.fetch(`/api/webhooks/${webhookId}/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function messagesIn(t: Test, channelId: Id<"channels">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("messages").collect()).filter((row) => row.channelId === channelId),
  );
}

describe("webhook management", () => {
  it("lets a role with ManageWebhooks create one and rejects everyone else", async () => {
    const { t, channelId } = await setup();
    const created = await t
      .withIdentity({ subject: "manager-1" })
      .mutation(api.webhooks.create, { channelId, name: "  CI  " });
    expect(created.token.startsWith("awh_")).toBe(true);

    await expect(
      t.withIdentity({ subject: "user-1" }).mutation(api.webhooks.create, { channelId, name: "x" }),
    ).rejects.toThrow("Missing permission");
    await expect(
      t.withIdentity({ subject: "user-1" }).query(api.webhooks.list, {}),
    ).rejects.toThrow("Missing permission");
  });

  it("stores only a hash of the secret and never lists it", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);

    const row = await t.run(async (ctx) => await ctx.db.get(webhookId));
    expect(row?.userId).toBe(`${WEBHOOK_USER_ID_PREFIX}${webhookId}`);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);

    const listed = await asOwner(t).query(api.webhooks.list, {});
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Deploys");
    expect(listed[0]?.tokenLast4).toBe(token.slice(-4));
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("validates names and the target channel", async () => {
    const { t, channelId } = await setup();
    await expect(
      asOwner(t).mutation(api.webhooks.create, { channelId, name: "   " }),
    ).rejects.toThrow("Webhook names must be");
    await expect(
      asOwner(t).mutation(api.webhooks.create, {
        channelId,
        name: "x".repeat(WEBHOOK_LIMITS.maxNameLength + 1),
      }),
    ).rejects.toThrow("Webhook names must be");

    const voice = await seedChannel(t, { kind: "voice" });
    await expect(
      asOwner(t).mutation(api.webhooks.create, { channelId: voice, name: "v" }),
    ).rejects.toThrow("text and announcement");
    const archived = await seedChannel(t, { archived: true });
    await expect(
      asOwner(t).mutation(api.webhooks.create, { channelId: archived, name: "a" }),
    ).rejects.toThrow("archived");
  });

  it("caps webhooks per channel", async () => {
    const { t, channelId } = await setup();
    for (let index = 0; index < WEBHOOK_LIMITS.maxPerChannel; index += 1) {
      await createHook(t, channelId, `hook ${index}`);
    }
    await expect(createHook(t, channelId, "one too many")).rejects.toThrow("at most");
  });

  it("renames, moves and audits", async () => {
    const { t, channelId } = await setup();
    const other = await seedChannel(t, { name: "ops" });
    const { webhookId } = await createHook(t, channelId);

    await asOwner(t).mutation(api.webhooks.update, {
      webhookId,
      name: "Releases",
      channelId: other,
    });
    const row = await t.run(async (ctx) => await ctx.db.get(webhookId));
    expect(row?.name).toBe("Releases");
    expect(row?.channelId).toBe(other);

    const actions = (await t.run(async (ctx) => await ctx.db.query("auditLog").collect())).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(["webhook.create", "webhook.update"]);
  });

  it("does not let a manager touch a webhook in a channel they cannot manage", async () => {
    const { t, channelId } = await setup();
    const locked = await seedChannel(t, {
      name: "locked",
      overrides: [
        {
          targetId: "hooks",
          targetType: "role",
          allow: 0n,
          deny: Permission.ManageWebhooks,
        },
      ],
    });
    const { webhookId } = await asOwner(t).mutation(api.webhooks.create, {
      channelId: locked,
      name: "secret",
    });
    await createHook(t, channelId, "open");

    const manager = t.withIdentity({ subject: "manager-1" });
    expect((await manager.query(api.webhooks.list, {})).map((hook) => hook.name)).toEqual(["open"]);
    await expect(manager.mutation(api.webhooks.rotateToken, { webhookId })).rejects.toThrow(
      "Missing permission",
    );
  });
});

describe("posting through the endpoint", () => {
  it("posts a message authored by the webhook", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);

    const response = await post(t, webhookId, token, { content: "  deploy finished  " });
    expect(response.status).toBe(200);

    const [message] = await messagesIn(t, channelId);
    expect(message?.authorId).toBe(`${WEBHOOK_USER_ID_PREFIX}${webhookId}`);
    expect(message?.mentionUserIds).toEqual([]);
    expect(message?.ciphertext).not.toContain("deploy finished");

    const readable = await asOwner(t).query(api.messages.list, {
      channelId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(readable.page.map((row) => row.body)).toEqual(["deploy finished"]);
    expect(readable.page[0]?.authorId).toBe(`${WEBHOOK_USER_ID_PREFIX}${webhookId}`);

    const used = await t.run(async (ctx) => await ctx.db.get(webhookId));
    expect(used?.lastUsedAt).toBeTypeOf("number");
  });

  it("accepts the Slack-style text field", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);
    expect((await post(t, webhookId, token, { text: "hi" })).status).toBe(200);
  });

  it("answers 404 for a wrong secret, a wrong id and a malformed path alike", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);
    const second = await createHook(t, channelId, "Other");

    expect((await post(t, webhookId, `${token}x`, { content: "a" })).status).toBe(404);
    expect((await post(t, second.webhookId, token, { content: "a" })).status).toBe(404);
    expect((await t.fetch("/api/webhooks/", { method: "POST", body: "{}" })).status).toBe(404);
    expect(await messagesIn(t, channelId)).toHaveLength(0);
  });

  it("rejects bad bodies without posting", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);

    expect((await post(t, webhookId, token, "not json")).status).toBe(400);
    expect((await post(t, webhookId, token, { content: "   " })).status).toBe(400);
    expect((await post(t, webhookId, token, [])).status).toBe(400);
    const tooLong = await post(t, webhookId, token, {
      content: "x".repeat(WEBHOOK_LIMITS.maxContentLength + 1),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "content_too_long" });
    const huge = await post(t, webhookId, token, {
      content: "x".repeat(WEBHOOK_LIMITS.maxBodyBytes),
    });
    expect(huge.status).toBe(413);
    expect(await messagesIn(t, channelId)).toHaveLength(0);
  });

  it("stops working after the secret is rotated or the webhook deleted", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);

    const rotated = await asOwner(t).mutation(api.webhooks.rotateToken, { webhookId });
    expect((await post(t, webhookId, token, { content: "old" })).status).toBe(404);
    expect((await post(t, webhookId, rotated.token, { content: "new" })).status).toBe(200);

    await asOwner(t).mutation(api.webhooks.remove, { webhookId });
    expect((await post(t, webhookId, rotated.token, { content: "gone" })).status).toBe(404);
    expect(await messagesIn(t, channelId)).toHaveLength(1);
  });

  it("keeps the author name of a deleted webhook and hides it from the manage list", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);
    await post(t, webhookId, token, { content: "hello" });
    await asOwner(t).mutation(api.webhooks.remove, { webhookId });

    expect(await asOwner(t).query(api.webhooks.list, {})).toEqual([]);
    const identities = await t
      .withIdentity({ subject: "user-1" })
      .query(api.webhooks.identities, {});
    expect(identities).toEqual([
      { userId: `${WEBHOOK_USER_ID_PREFIX}${webhookId}`, name: "Deploys" },
    ]);
    const row = await t.run(async (ctx) => await ctx.db.get(webhookId));
    expect(row?.tokenHash).toBeUndefined();
  });

  it("answers 409 once the channel is archived", async () => {
    const { t, channelId } = await setup();
    const { webhookId, token } = await createHook(t, channelId);
    await t.run(async (ctx) => {
      await ctx.db.patch(channelId, { archived: true });
    });
    expect((await post(t, webhookId, token, { content: "late" })).status).toBe(409);
  });

  it("rate limits a single webhook without affecting another", async () => {
    const { t, channelId } = await setup();
    const busy = await createHook(t, channelId, "busy");
    const quiet = await createHook(t, channelId, "quiet");

    const statuses: number[] = [];
    for (let index = 0; index < 32; index += 1) {
      statuses.push((await post(t, busy.webhookId, busy.token, { content: `m${index}` })).status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    expect((await post(t, quiet.webhookId, quiet.token, { content: "ok" })).status).toBe(200);
  });
});
