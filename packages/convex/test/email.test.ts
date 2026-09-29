import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { DEFAULT_EMAIL_FROM, parseEmailConfig, sendEmail } from "../convex/lib/email";
import { newTest, seedWorkspace } from "./helpers";

describe("email config", () => {
  it("parses an explicit provider and its endpoint", () => {
    expect(
      parseEmailConfig({
        AULORA_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "key",
        AULORA_EMAIL_FROM: "Aulora <no-reply@example.com>",
      }),
    ).toEqual({
      provider: "resend",
      from: "Aulora <no-reply@example.com>",
      resendApiKey: "key",
      smtpGatewayUrl: undefined,
    });

    expect(parseEmailConfig({ SMTP_GATEWAY_URL: "http://bridge/send" })).toMatchObject({
      provider: "smtp",
      smtpGatewayUrl: "http://bridge/send",
    });
  });

  it("infers `none` and falls back to a default sender", () => {
    expect(parseEmailConfig({})).toEqual({
      provider: "none",
      from: DEFAULT_EMAIL_FROM,
      resendApiKey: undefined,
      smtpGatewayUrl: undefined,
    });
  });

  it("degrades to `none` when a provider endpoint is missing", () => {
    expect(parseEmailConfig({ AULORA_EMAIL_PROVIDER: "resend" }).provider).toBe("none");
    expect(parseEmailConfig({ AULORA_EMAIL_PROVIDER: "smtp" }).provider).toBe("none");
  });

  it("no-ops and logs when unconfigured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await sendEmail(
      { to: "user@example.com", subject: "hi", text: "hello" },
      { env: {} },
    );
    expect(result).toEqual({ sent: false, provider: "none", skipped: "unconfigured" });
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it("posts to the Resend API when configured", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const result = await sendEmail(
      { to: "user@example.com", subject: "hi", text: "hello" },
      {
        env: {
          AULORA_EMAIL_PROVIDER: "resend",
          RESEND_API_KEY: "key",
          AULORA_EMAIL_FROM: "Aulora <no-reply@example.com>",
        },
        fetch: fetchImpl,
      },
    );
    expect(result).toEqual({ sent: true, provider: "resend" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
  });

  it("reports a failed send without throwing", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const result = await sendEmail(
      { to: "user@example.com", subject: "hi", text: "hello" },
      {
        env: { AULORA_EMAIL_PROVIDER: "smtp", SMTP_GATEWAY_URL: "http://bridge/send" },
        fetch: fetchImpl,
      },
    );
    expect(result).toEqual({ sent: false, provider: "smtp", skipped: "error" });
  });
});

describe("email.sendTest", () => {
  it("is instance-admin only and writes an audit row", async () => {
    const t = newTest();
    await seedWorkspace(t, { members: [{ userId: "user-1" }] });

    const asUser = t.withIdentity({ subject: "user-1" });
    await expect(asUser.action(api.email.sendTest, { to: "x@example.com" })).rejects.toThrow(
      "Instance admin",
    );

    const asOwner = t.withIdentity({ subject: "owner-1" });
    const result = await asOwner.action(api.email.sendTest, { to: "x@example.com" });
    expect(result).toMatchObject({ provider: "none" });

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.action === "email.sendTest" && row.actorId === "owner-1")).toBe(
      true,
    );
  });
});
