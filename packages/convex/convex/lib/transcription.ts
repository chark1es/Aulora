import {
  clampRetentionDays,
  hasPermission,
  Permission,
  TRANSCRIPTION_SERVICE_STALE_MS,
} from "@aulora/core";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { listActiveBans } from "./bans";
import { loadPermissionContext, workspacePermissions } from "./permissions";
import { openContent } from "./sealed";
import { sealString } from "./sse";

/**
 * Shared gates and sealed-content helpers for the optional transcription
 * addon. The addon is off unless `server.settings.transcriptionEnabled === true`
 * and a model is installed; every read additionally needs `ViewTranscripts`.
 */

type ReadCtx = QueryCtx | MutationCtx;

export interface TranscriptionConfigView {
  readonly modelId: string;
  readonly modelStatus: Doc<"transcriptionConfig">["modelStatus"];
  readonly modelProgress: number | null;
  readonly modelError: string | null;
  readonly provider: Doc<"transcriptionConfig">["provider"];
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly summaryLanguage: string | null;
  readonly summaryStyle: string | null;
  readonly retentionDays: number;
  readonly allowPrivateEndpoint: boolean;
  readonly updatedAt: number;
}

/** True when the addon flag is on. */
export async function transcriptionEnabled(ctx: ReadCtx): Promise<boolean> {
  const server = await ctx.db.query("server").first();
  return server?.settings.transcriptionEnabled === true;
}

/** Throws unless the addon is enabled. */
export async function requireTranscriptionAddon(ctx: ReadCtx): Promise<void> {
  if (!(await transcriptionEnabled(ctx))) {
    throw new ConvexError("Transcription is disabled");
  }
}

/** The single config row, or null before the owner saves anything. */
export async function loadTranscriptionConfig(
  ctx: ReadCtx,
): Promise<Doc<"transcriptionConfig"> | null> {
  return await ctx.db.query("transcriptionConfig").first();
}

/**
 * The addon must be enabled, the member must not be banned, and they must hold
 * `ViewTranscripts` plus `flag`. Mirrors `requireNotesUser`.
 */
export async function requireTranscriptionUser(
  ctx: ReadCtx,
  userId: string,
  flag: bigint = Permission.ViewTranscripts,
) {
  await requireTranscriptionAddon(ctx);
  if ((await listActiveBans(ctx, userId)).length > 0) {
    throw new ConvexError("You are banned from this workspace");
  }
  const context = await loadPermissionContext(ctx, userId);
  const permissions = workspacePermissions(context);
  if (
    !hasPermission(permissions, Permission.ViewTranscripts) ||
    !hasPermission(permissions, flag)
  ) {
    throw new ConvexError("Missing transcript permission");
  }
  return { userId, permissions };
}

/** The workspace-level permission check used by actions (no session needed). */
export async function userHasTranscriptFlag(
  ctx: ReadCtx,
  userId: string,
  flag: bigint,
): Promise<boolean> {
  const server = await ctx.db.query("server").first();
  if (server?.settings.transcriptionEnabled !== true) {
    return false;
  }
  const context = await loadPermissionContext(ctx, userId);
  return hasPermission(workspacePermissions(context), flag);
}

/** Owner-facing config view. Never includes the API key. */
export function configView(config: Doc<"transcriptionConfig"> | null): TranscriptionConfigView {
  return {
    modelId: config?.modelId ?? "base",
    modelStatus: config?.modelStatus ?? "not_installed",
    modelProgress: config?.modelProgress ?? null,
    modelError: config?.modelError ?? null,
    provider: config?.provider ?? "openrouter",
    baseUrl: config?.baseUrl ?? "https://openrouter.ai/api/v1",
    model: config?.model ?? "",
    hasApiKey: config?.apiKeyCiphertext !== undefined,
    summaryLanguage: config?.summaryLanguage ?? null,
    summaryStyle: config?.summaryStyle ?? null,
    retentionDays: config?.retentionDays ?? 30,
    allowPrivateEndpoint: config?.allowPrivateEndpoint ?? false,
    updatedAt: config?.updatedAt ?? 0,
  };
}

/** Opens a segment's sealed speaker snapshot and text. */
export async function segmentContent(segment: Doc<"transcriptSegments">): Promise<{
  speakerName: string;
  text: string;
}> {
  const context = { scope: "transcription.segment", recordId: segment._id };
  return {
    speakerName: await openContent(context, segment.speakerNameCiphertext),
    text: await openContent(context, segment.textCiphertext),
  };
}

/** Opens a session's sealed summary, or `null` when there is none. */
export async function summaryContent(
  session: Doc<"transcriptionSessions">,
): Promise<string | null> {
  if (session.summaryCiphertext === undefined) {
    return null;
  }
  return await openContent(
    { scope: "transcription.summary", recordId: session._id },
    session.summaryCiphertext,
  );
}

/** Seals a segment's speaker and text for storage. */
export async function sealSegment(
  segmentId: Id<"transcriptSegments">,
  speakerName: string,
  text: string,
): Promise<{ speakerNameCiphertext: string; textCiphertext: string }> {
  const context = { scope: "transcription.segment", recordId: segmentId };
  return {
    speakerNameCiphertext: await sealString(context, speakerName),
    textCiphertext: await sealString(context, text),
  };
}

/** Seals a summary for storage. */
export async function sealSummary(
  sessionId: Id<"transcriptionSessions">,
  json: string,
): Promise<string> {
  return await sealString({ scope: "transcription.summary", recordId: sessionId }, json);
}

/** Retention expiry for a session that just ended, or `undefined` when kept. */
export function retentionExpiry(
  endedAt: number,
  configuredDays: number | undefined,
): number | undefined {
  const days = clampRetentionDays(configuredDays ?? 30);
  return days === 0 ? undefined : endedAt + days * 24 * 60 * 60 * 1000;
}

/** The active session on a call, if any. */
export async function activeSessionForCall(
  ctx: ReadCtx,
  callId: Id<"calls">,
): Promise<Doc<"transcriptionSessions"> | null> {
  return await ctx.db
    .query("transcriptionSessions")
    .withIndex("by_call_status", (q) => q.eq("callId", callId).eq("status", "active"))
    .first();
}

/** The active or finalizing transcription session on a call, if any. */
export async function liveSessionForCall(
  ctx: ReadCtx,
  callId: Id<"calls">,
): Promise<Doc<"transcriptionSessions"> | null> {
  const active = await activeSessionForCall(ctx, callId);
  if (active !== null) {
    return active;
  }
  return await ctx.db
    .query("transcriptionSessions")
    .withIndex("by_call_status", (q) => q.eq("callId", callId).eq("status", "ending"))
    .first();
}

/**
 * Records a seat departure for the call's live transcription session. Called
 * from the single seat-removal path, so leave, stale sweep, switching calls and
 * guest leave/removal all behave the same. A moderator removal marks the
 * speaker blocked instead, which has no grace.
 */
export async function markTranscriptionSpeakerLeft(
  ctx: MutationCtx,
  callId: Id<"calls">,
  speakerKey: string,
  options: { readonly blocked?: boolean } = {},
): Promise<void> {
  const session = await liveSessionForCall(ctx, callId);
  if (session === null) {
    return;
  }
  const state = await ctx.db
    .query("transcriptSpeakerState")
    .withIndex("by_session_speaker", (q) =>
      q.eq("sessionId", session._id).eq("speakerKey", speakerKey),
    )
    .unique();
  if (state === null) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(state._id, {
    leftAt: now,
    ...(options.blocked === true ? { blocked: true } : {}),
    updatedAt: now,
  });
}

/**
 * How long an `ending` session still accepts its final buffered audio. A CPU
 * transcriber may need seconds to transcribe the last window, so the window is
 * deliberately generous; no audio is accepted after it closes.
 */
export const TRANSCRIPTION_FINALIZE_GRACE_MS = 30_000;
/** Clock tolerance for a segment that started just before the stop. */
export const TRANSCRIPTION_FINALIZE_TOLERANCE_MS = 5_000;
/** How long a speaker who left a still-running call may still drain audio. */
export const TRANSCRIPTION_SPEAKER_LEFT_GRACE_MS = 30_000;
/** A transcriber download with no hello progress after this is interrupted. */
export const TRANSCRIPTION_DOWNLOAD_STALE_MS = 60_000;

/**
 * Moves an active session to `ending` and schedules the finalizer. The summary
 * is queued only after the grace so the transcriber's final drain can land.
 */
export async function beginTranscriptionFinalize(
  ctx: MutationCtx,
  session: Doc<"transcriptionSessions">,
  now: number = Date.now(),
): Promise<void> {
  if (session.status !== "active") {
    return;
  }
  const config = await loadTranscriptionConfig(ctx);
  const endsAt = now + TRANSCRIPTION_FINALIZE_GRACE_MS;
  // Make the shared aggregate exact before the final window so its segment cap
  // is enforced against the real count, not the last periodic refresh.
  const speakerRows = await ctx.db
    .query("transcriptSpeakerState")
    .withIndex("by_session_speaker", (q) => q.eq("sessionId", session._id))
    .take(64);
  const segmentCount = speakerRows.reduce((total, row) => total + row.segmentCount, 0);
  const lastSeq = speakerRows.reduce((max, row) => Math.max(max, row.lastSeq), 0);
  await ctx.db.patch(session._id, {
    status: "ending",
    endedAt: now,
    endsAt,
    retentionExpiresAt: retentionExpiry(now, config?.retentionDays),
    summaryStatus: "none",
    summaryRequestedAt: undefined,
    summaryAttemptId: undefined,
    segmentCount,
    lastSeq: Math.max(session.lastSeq, lastSeq),
    countUpdatedAt: now,
  });
  const call = await ctx.db.get(session.callId);
  if (call !== null && call.transcriptionSessionId === session._id) {
    await ctx.db.patch(call._id, { transcriptionSessionId: undefined, updatedAt: now });
  }
  await ctx.scheduler.runAfter(
    TRANSCRIPTION_FINALIZE_GRACE_MS,
    internal.transcription.finalizeSession,
    { sessionId: session._id },
  );
}

/** Schedules the immediate (no-grace) stop used when the addon is disabled. */
export async function scheduleStopAllActive(ctx: MutationCtx): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.transcription.stopAllActive, {});
}

/**
 * Ends the active session on a call (system path: last participant left or the
 * call ended). It enters the same bounded finalization window as `stop`, so a
 * seat removed by the leave cannot reject the transcriber's final batch.
 */
export async function endTranscriptionForCall(
  ctx: MutationCtx,
  callId: Id<"calls">,
  now: number = Date.now(),
): Promise<Id<"transcriptionSessions"> | null> {
  const session = await activeSessionForCall(ctx, callId);
  if (session === null) {
    return null;
  }
  await beginTranscriptionFinalize(ctx, session, now);
  return session._id;
}

/**
 * Records that a speaker was authorized for this session. The row also carries
 * replay state; creating it before any audio means a final drain still has a
 * durable authorization after the participant's seat is gone.
 */
export async function authorizeTranscriptionSpeaker(
  ctx: MutationCtx,
  sessionId: Id<"transcriptionSessions">,
  speakerKey: string,
): Promise<void> {
  const existing = await ctx.db
    .query("transcriptSpeakerState")
    .withIndex("by_session_speaker", (q) =>
      q.eq("sessionId", sessionId).eq("speakerKey", speakerKey),
    )
    .unique();
  if (existing !== null) {
    // Rejoining/re-minting after a leave clears the departure grace. A
    // moderator block is deliberately not cleared here.
    if (existing.leftAt !== undefined) {
      await ctx.db.patch(existing._id, { leftAt: undefined, updatedAt: Date.now() });
    }
    return;
  }
  await ctx.db.insert("transcriptSpeakerState", {
    sessionId,
    speakerKey,
    lastSeq: 0,
    lastStartMs: -1,
    segmentCount: 0,
    updatedAt: Date.now(),
  });
}

/** Fresh runtime engine readiness, independent of the owner's selected model. */
export async function transcriberRuntimeReady(ctx: ReadCtx): Promise<boolean> {
  const status = await ctx.db
    .query("transcriberStatus")
    .withIndex("by_key", (q) => q.eq("key", "service"))
    .unique();
  return (
    status !== null &&
    status.runtimeReady === true &&
    Date.now() - status.serviceSeenAt <= TRANSCRIPTION_SERVICE_STALE_MS
  );
}
