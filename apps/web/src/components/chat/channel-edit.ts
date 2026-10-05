import { type ChannelView, Permission } from "@aulora/core";
import type { ChatRuntime } from "../../lib/chat-runtime";
import type { EditChannelPatch } from "./EditChannelModal";

/**
 * The channel fields the edit dialog can change, flattened from the modal's
 * target so a save only issues the port calls that actually differ.
 */
export interface ChannelEditBaseline {
  readonly id: string;
  readonly originalName: string;
  readonly originalTopic: string;
  readonly originallyPrivate: boolean;
  readonly originalMemberIds: readonly string[];
  readonly originalBlocked: readonly string[];
}

/** Captures the channel's current values before the edit dialog opens. */
export function channelEditBaseline(channel: ChannelView, title: string): ChannelEditBaseline {
  return {
    id: channel.id,
    originalName: title,
    originalTopic: channel.topic ?? "",
    originallyPrivate: channel.isPrivate === true,
    originalMemberIds: channel.memberIds ?? [],
    originalBlocked: (channel.overrides ?? [])
      .filter((override) => override.targetType === "member")
      .filter((override) => (override.deny & Permission.ViewChannel) !== 0n)
      .map((override) => override.targetId),
  };
}

/** The editable channel fields a save compares and sends, flattened. */
export interface ChannelEditRequest {
  readonly baseline: ChannelEditBaseline;
  readonly name: string;
  readonly topic: string;
  readonly isPrivate: boolean;
  readonly memberIds: readonly string[];
  readonly blockedUserIds: readonly string[];
  readonly ownUserId: string;
}

/** Whether two id lists hold the same distinct values, order-insensitive. */
export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right.at(index));
}

function membershipFor(request: ChannelEditRequest): string[] {
  if (!request.isPrivate) {
    return [];
  }
  if (request.memberIds.length === 0) {
    return [request.ownUserId];
  }
  return [...new Set([request.ownUserId, ...request.memberIds])];
}

/**
 * Persists an edit-channel save: renames, retopics, flips public/private and
 * blocks members, each only when that field actually changed.
 */
export async function commitChannelEdit(
  runtime: ChatRuntime,
  request: ChannelEditRequest,
): Promise<void> {
  const { baseline } = request;
  const targetId = baseline.id;
  const name = request.name.trim();
  if (name.length > 0 && name !== baseline.originalName) {
    await runtime.session.setChannelName(targetId, name);
  }
  if (request.topic !== baseline.originalTopic) {
    await runtime.port.setChannelTopic({ channelId: targetId, topic: request.topic });
  }
  const membership = membershipFor(request);
  if (request.isPrivate !== baseline.originallyPrivate) {
    await runtime.port.setChannelPrivate({
      channelId: targetId,
      private: request.isPrivate,
      memberIds: membership,
    });
  } else if (request.isPrivate && !sameStringSet(request.memberIds, baseline.originalMemberIds)) {
    await runtime.port.setChannelPrivate({
      channelId: targetId,
      private: true,
      memberIds: membership,
    });
  }
  if (!sameStringSet(request.blockedUserIds, baseline.originalBlocked)) {
    await runtime.port.setChannelBlocked({
      channelId: targetId,
      userIds: [...new Set(request.blockedUserIds)],
    });
  }
}

export type { EditChannelPatch };
