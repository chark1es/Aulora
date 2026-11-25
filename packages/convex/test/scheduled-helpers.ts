import { EVERYONE_ROLE_ID, Permission } from "@aulora/core";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { EVERYONE_BASE, newTest, seedChannel, seedWorkspace, type Test } from "./helpers";

export const MINUTE = 60_000;

export async function patchSettings(t: Test, settings: Record<string, unknown>) {
  await t.run(async (ctx) => {
    const server = await ctx.db.query("server").first();
    if (server !== null) {
      await ctx.db.patch(server._id, { settings: { ...server.settings, ...settings } });
    }
  });
}

/**
 * user-1 / user-2 schedule calls, admin-1 is an administrator, member-a and
 * member-b are ordinary members, and a voice channel is available.
 */
export async function seed() {
  const t = newTest();
  await seedWorkspace(t, {
    everyonePermissions: EVERYONE_BASE | Permission.ViewScheduledCalls,
    members: [
      { userId: "user-1", roleIds: [EVERYONE_ROLE_ID, "scheduler"] },
      { userId: "user-2", roleIds: [EVERYONE_ROLE_ID, "scheduler"] },
      { userId: "admin-1", roleIds: [EVERYONE_ROLE_ID, "admin"] },
      { userId: "member-a" },
      { userId: "member-b" },
    ],
    extraRoles: [
      { key: "scheduler", permissions: Permission.ScheduleCalls, position: 2 },
      { key: "admin", permissions: Permission.Administrator, position: 3 },
    ],
  });
  await patchSettings(t, { scheduledCallsEnabled: true });
  const channelId = await seedChannel(t, { kind: "voice", name: "Lounge" });
  return { t, channelId };
}

export type Seeded = Awaited<ReturnType<typeof seed>>;

export function as(t: Test, userId: string) {
  return t.withIdentity({ subject: userId });
}

export async function channelCall(
  { t, channelId }: Seeded,
  options: { inviteOnly?: boolean; invitees?: string[]; startsInMinutes?: number } = {},
): Promise<Id<"scheduledCalls">> {
  return await as(t, "user-2").mutation(api.scheduledCalls.create, {
    title: "Planning",
    startsAt: Date.now() + (options.startsInMinutes ?? 30) * MINUTE,
    openLeadMinutes: 5,
    channelId,
    ...(options.inviteOnly !== undefined ? { inviteOnly: options.inviteOnly } : {}),
    ...(options.invitees !== undefined ? { inviteeUserIds: options.invitees } : {}),
  });
}

/** Moves a call's window so that it is open now. */
export async function openNow(t: Test, id: Id<"scheduledCalls">, durationMinutes = 60) {
  await t.run(async (ctx) => {
    await ctx.db.patch(id, {
      startsAt: Date.now() - MINUTE,
      durationMinutes,
      status: "open",
    });
  });
}

export async function waitingRows(t: Test, id: Id<"scheduledCalls">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("scheduledCallWaiting").take(200);
    return rows.filter((row) => row.scheduledCallId === id);
  });
}
