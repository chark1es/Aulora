import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../packages/convex/convex/_generated/api";

/** Mobile wrappers for the moderation, notes and category mutations. */

export async function setUserNote(
  client: ConvexReactClient,
  targetUserId: string,
  body: string,
): Promise<void> {
  await client.mutation(api.notes.upsert, { targetUserId, body });
}

export async function getUserNote(
  client: ConvexReactClient,
  targetUserId: string,
): Promise<string | null> {
  const result = await client.query(api.notes.get, { targetUserId });
  return result.body;
}

export async function kickMember(client: ConvexReactClient, userId: string): Promise<void> {
  await client.mutation(api.members.kick, { userId });
}

export async function timeoutMember(
  client: ConvexReactClient,
  userId: string,
  until: number | undefined,
): Promise<void> {
  await client.mutation(api.members.timeout, {
    userId,
    ...(until !== undefined ? { until } : {}),
  });
}

export async function banMember(
  client: ConvexReactClient,
  userId: string,
  options: { readonly reason?: string; readonly durationMs?: number } = {},
): Promise<void> {
  await client.mutation(api.members.ban, {
    userId,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
  });
}

export async function createCategory(client: ConvexReactClient, name: string): Promise<string> {
  return (await client.mutation(api.categories.create, { name })) as string;
}
