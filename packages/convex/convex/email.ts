import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { sendEmail } from "./lib/email";
import { requireInstanceAdmin } from "./lib/instance";

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

function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

/** Sends an invite magic link. Scheduled by `invites.create` when an email is set. */
export const sendInvite = internalAction({
  args: {
    to: v.string(),
    code: v.string(),
    workspaceName: v.string(),
    invitedByName: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const origin = siteUrl();
    const link = origin.length > 0 ? `${origin}/invite/${args.code}` : args.code;
    const invitedBy =
      args.invitedByName !== undefined && args.invitedByName.trim().length > 0
        ? args.invitedByName.trim()
        : "Someone";
    return await sendEmail({
      to: args.to,
      subject: `You're invited to ${args.workspaceName}`,
      text: `${invitedBy} invited you to join ${args.workspaceName} on Aulora.\n\n${link}\n\nThis link expires in 7 days.`,
    });
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
    return await sendEmail({
      to: args.to,
      subject: "Aulora test email",
      text: "This is a test email from your Aulora deployment. If you can read it, email is configured correctly.",
    });
  },
});
