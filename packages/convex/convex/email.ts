import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { type EmailConfig, parseEmailConfig, sendEmail } from "./lib/email";
import { requireInstanceAdmin } from "./lib/instance";
import { inviteEmail, joinCodeEmail } from "./lib/inviteEmail";
import { JOIN_CODE_TTL_MINUTES } from "./lib/joinCodes";
import { openString, sealString } from "./lib/sse";

/**
 * Outbound email actions. Sending is scheduled from mutations; the public
 * `sendTest` is gated to the instance admin so a deployment can verify its
 * transport without sending anything to members.
 */

/** Throws unless the caller is the operator; used by the test-send action. */
export const assertInstanceAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireInstanceAdmin(ctx);
    return userId;
  },
});

const resendKeyContext = { scope: "email-setting", recordId: "resend-api-key" };
const smtpPasswordContext = { scope: "email-setting", recordId: "smtp-password" };

/** Owner-visible mail settings. Passwords and API keys are represented only by presence flags. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireInstanceAdmin(ctx);
    const row = await ctx.db.query("emailSettings").first();
    const fallback = parseEmailConfig();
    return {
      provider: row?.provider ?? fallback.provider,
      from: row?.from ?? fallback.from,
      smtpHost: row?.smtpHost ?? "",
      smtpPort: row?.smtpPort ?? 587,
      smtpSecure: row?.smtpSecure ?? false,
      smtpUser: row?.smtpUser ?? "",
      hasResendApiKey:
        row?.resendApiKeyCiphertext !== undefined || fallback.resendApiKey !== undefined,
      hasSmtpPassword: row?.smtpPasswordCiphertext !== undefined,
    };
  },
});

/** Saves mail credentials under the server encryption key. Empty secret fields retain saved values. */
export const updateSettings = mutation({
  args: {
    provider: v.union(v.literal("none"), v.literal("resend"), v.literal("smtp")),
    from: v.string(),
    resendApiKey: v.optional(v.string()),
    smtpHost: v.optional(v.string()),
    smtpPort: v.optional(v.number()),
    smtpSecure: v.optional(v.boolean()),
    smtpUser: v.optional(v.string()),
    smtpPassword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireInstanceAdmin(ctx);
    const from = args.from.trim();
    if (from.length === 0 || /[\r\n]/.test(from))
      throw new ConvexError("Enter a valid From address");
    const existing = await ctx.db.query("emailSettings").first();
    const smtpHost = args.smtpHost?.trim() ?? existing?.smtpHost ?? "";
    const smtpPort = args.smtpPort ?? existing?.smtpPort ?? 587;
    if (
      args.provider === "smtp" &&
      (smtpHost.length === 0 || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    ) {
      throw new ConvexError("Enter a valid SMTP host and port");
    }
    const resendApiKeyCiphertext = args.resendApiKey?.trim()
      ? await sealString(resendKeyContext, args.resendApiKey.trim())
      : existing?.resendApiKeyCiphertext;
    const smtpPasswordCiphertext = args.smtpPassword
      ? await sealString(smtpPasswordContext, args.smtpPassword)
      : existing?.smtpPasswordCiphertext;
    if (
      args.provider === "resend" &&
      resendApiKeyCiphertext === undefined &&
      !parseEmailConfig().resendApiKey
    ) {
      throw new ConvexError("Enter a Resend API key");
    }
    const fields = {
      provider: args.provider,
      from,
      smtpHost,
      smtpPort,
      smtpSecure: args.smtpSecure ?? existing?.smtpSecure ?? false,
      smtpUser: args.smtpUser?.trim() ?? existing?.smtpUser ?? "",
      ...(resendApiKeyCiphertext !== undefined ? { resendApiKeyCiphertext } : {}),
      ...(smtpPasswordCiphertext !== undefined ? { smtpPasswordCiphertext } : {}),
    };
    if (existing === null) await ctx.db.insert("emailSettings", fields);
    else await ctx.db.patch(existing._id, fields);
    await writeAudit(ctx, { actorId: userId, action: "email.settings.update" });
    return null;
  },
});

/** Internal action input only; no client query can read sealed credentials. */
export const configuration = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("emailSettings").first(),
});

async function configuredEmail(ctx: ActionCtx): Promise<EmailConfig> {
  const row = await ctx.runQuery(internal.email.configuration, {});
  const fallback = parseEmailConfig();
  if (row === null) return fallback;
  return {
    provider: row.provider,
    from: row.from,
    resendApiKey:
      row.resendApiKeyCiphertext !== undefined
        ? await openString(resendKeyContext, row.resendApiKeyCiphertext)
        : fallback.resendApiKey,
    smtpGatewayUrl: (process.env.SMTP_GATEWAY_URL?.trim() ?? "") || fallback.smtpGatewayUrl,
    ...(row.provider === "smtp"
      ? {
          smtp: {
            host: row.smtpHost ?? "",
            port: row.smtpPort ?? 587,
            secure: row.smtpSecure ?? false,
            user: row.smtpUser ?? "",
            password:
              row.smtpPasswordCiphertext !== undefined
                ? await openString(smtpPasswordContext, row.smtpPasswordCiphertext)
                : "",
          },
        }
      : {}),
  };
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Sends the single-use invite link. Scheduled by `invites.create` for an `email` invite. */
export const sendInvite = internalAction({
  args: {
    inviteId: v.id("invites"),
    to: v.string(),
    code: v.string(),
    workspaceName: v.string(),
    invitedByName: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const origin = siteUrl();
    if (origin.length === 0) throw new ConvexError("SITE_URL must be configured to email invites");
    const invitedBy =
      args.invitedByName !== undefined && args.invitedByName.trim().length > 0
        ? args.invitedByName.trim()
        : "Someone";
    const message = inviteEmail({
      workspaceName: args.workspaceName,
      invitedBy,
      link: `${origin}/invite/${args.code}`,
      expiresAt: args.expiresAt,
    });
    const result = await sendEmail(
      { to: args.to, ...message },
      { config: await configuredEmail(ctx) },
    );
    await ctx.runMutation(internal.invites.markEmailResult, {
      inviteId: args.inviteId,
      sent: result.sent,
    });
    return result;
  },
});

/** Sends the one-time code that lets an allowlisted account prove its address. */
export const sendJoinCode = internalAction({
  args: { to: v.string(), code: v.string(), workspaceName: v.string() },
  handler: async (ctx, args) => {
    const message = joinCodeEmail({
      workspaceName: args.workspaceName,
      code: args.code,
      minutes: JOIN_CODE_TTL_MINUTES,
    });
    return await sendEmail({ to: args.to, ...message }, { config: await configuredEmail(ctx) });
  },
});

/** Records an admin test-send in the audit log. No recipient PII is stored. */
export const logSendTest = internalMutation({
  args: { actorId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeAudit(ctx, { actorId: args.actorId, action: "email.sendTest" });
    return null;
  },
});

/** Sends a test message; instance admin only. */
export const sendTest = action({
  args: { to: v.string() },
  handler: async (ctx, args) => {
    const actorId = await ctx.runQuery(internal.email.assertInstanceAdmin, {});
    await ctx.runMutation(internal.email.logSendTest, { actorId });
    return await sendEmail(
      {
        to: args.to,
        subject: "Aulora test email",
        text: "This is a test email from your Aulora deployment. If you can read it, email is configured correctly.",
      },
      { config: await configuredEmail(ctx) },
    );
  },
});
