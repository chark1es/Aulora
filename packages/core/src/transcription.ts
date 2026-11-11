/**
 * Shared constants and types for the optional call-transcription addon.
 *
 * The backend enforces every limit here; clients use the same values to
 * pre-validate input and to render model/status labels. Nothing in this module
 * is a secret: the transcriber shares a deployment secret (`TRANSCRIBER_TOKEN`)
 * with Convex, never with a client.
 */

/** Whisper model ids the transcriber is allowed to download. */
export const TRANSCRIPTION_MODEL_IDS = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3-turbo",
] as const;

export type TranscriptionModelId = (typeof TRANSCRIPTION_MODEL_IDS)[number];

/**
 * Install state reported by the transcriber. The addon is unusable until a
 * model reaches `ready`.
 */
export type TranscriptionModelStatus = "not_installed" | "downloading" | "ready" | "error";
/** Summary providers understood by the backend. */
export const TRANSCRIPTION_PROVIDERS = ["openrouter", "openai_compatible"] as const;

export type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number];

/** Default summary base URL for OpenRouter. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Default model used for a summary when the operator has not chosen one. */
export const DEFAULT_SUMMARY_MODEL = "openai/gpt-4o-mini";
/** Retention defaults and bounds, in days. `0` means keep until deleted. */
export const TRANSCRIPTION_DEFAULT_RETENTION_DAYS = 30;
export const TRANSCRIPTION_MAX_RETENTION_DAYS = 3650;

/** Hard cap on stored segments for one session. */
export const TRANSCRIPTION_MAX_SEGMENTS_PER_SESSION = 20_000;
/** Segments accepted in one ingest request. */
export const TRANSCRIPTION_MAX_SEGMENTS_PER_BATCH = 50;
/** Longest single segment text accepted from the transcriber. */
export const TRANSCRIPTION_MAX_SEGMENT_CHARS = 4_000;

/** Lifetime of a minted audio token: enough to open the WebSocket. */
export const TRANSCRIPTION_AUDIO_TOKEN_TTL_SECONDS = 60;

/**
 * How long a transcriber hello keeps `serviceInstalled` true. The container
 * reports roughly every minute, so a stopped profile flips the UI to
 * "not installed" within this window.
 */
export const TRANSCRIPTION_SERVICE_STALE_MS = 3 * 60_000;

/** Audio wire format: 16 kHz mono signed 16-bit little-endian PCM. */
export const TRANSCRIBER_SAMPLE_RATE_HZ = 16_000;
/** Largest binary frame the transcriber accepts from a client. */
export const TRANSCRIBER_MAX_FRAME_BYTES = 16_384;
/** A stream that sends nothing for this long is closed. */
export const TRANSCRIBER_IDLE_TIMEOUT_MS = 60_000;

/** Page sizes for transcript reads. */
export const TRANSCRIPTION_MAX_LIST_SESSIONS = 100;

/** Summary generation limits, measured in transcript characters. */
export const TRANSCRIPTION_SUMMARY_CHUNK_CHARS = 24_000;
export const TRANSCRIPTION_SUMMARY_MAX_TRANSCRIPT_CHARS = 600_000;
export const TRANSCRIPTION_SUMMARY_MAX_OUTPUT_CHARS = 32_000;
/** Upstream endpoint guards for the summary action. */
export const TRANSCRIPTION_SUMMARY_TIMEOUT_MS = 60_000;
export const TRANSCRIPTION_SUMMARY_MAX_RESPONSE_BYTES = 256 * 1024;
/** A connection test uses a shorter timeout than a real summary. */
export const TRANSCRIPTION_TEST_TIMEOUT_MS = 15_000;

/** Structured summary contract returned to clients (all fields sanitized). */
export interface TranscriptSummary {
  readonly overview: string;
  readonly keyPoints: readonly string[];
  readonly decisions: readonly string[];
  readonly actionItems: readonly {
    readonly text: string;
    readonly owner: string | null;
  }[];
  readonly speakerHighlights: readonly {
    readonly speaker: string;
    readonly text: string;
  }[];
  readonly language: string | null;
}

/** Empty summary used when the model returns nothing usable. */
export const EMPTY_TRANSCRIPT_SUMMARY: TranscriptSummary = {
  overview: "",
  keyPoints: [],
  decisions: [],
  actionItems: [],
  speakerHighlights: [],
  language: null,
};

/** True for one of the allowlisted model ids. */
export function isTranscriptionModelId(value: string): value is TranscriptionModelId {
  return (TRANSCRIPTION_MODEL_IDS as readonly string[]).includes(value);
}

/** Clamps a retention setting to the supported range. */
export function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) {
    return TRANSCRIPTION_DEFAULT_RETENTION_DAYS;
  }
  return Math.min(TRANSCRIPTION_MAX_RETENTION_DAYS, Math.max(0, Math.trunc(value)));
}

/** Reads the speaker key for a member or guest participant. */
export function transcriptionSpeakerKey(kind: "user" | "guest", id: string): string {
  return `${kind}:${id}`;
}

/** Splits a speaker key back into its kind and id, or `null` when malformed. */
export function parseTranscriptionSpeakerKey(
  key: string,
): { readonly kind: "user" | "guest"; readonly id: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  const kind = key.slice(0, separator);
  if (kind !== "user" && kind !== "guest") {
    return null;
  }
  return { kind, id: key.slice(separator + 1) };
}

/**
 * Human label for a speaker key. Segments already carry a sealed display-name
 * snapshot, so this is only a fallback for a deleted account.
 */
export function speakerFallbackLabel(key: string): string {
  const parsed = parseTranscriptionSpeakerKey(key);
  if (parsed === null) {
    return "Unknown speaker";
  }
  return parsed.kind === "guest" ? "Guest" : "Participant";
}
