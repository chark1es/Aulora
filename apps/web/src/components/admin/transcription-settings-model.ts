import {
  clampRetentionDays,
  OPENROUTER_BASE_URL,
  type TranscriptionModelStatus,
  type TranscriptionProvider,
} from "@aulora/core";

export type KeyMode = "keep" | "replace" | "clear";

/** What the transcription settings form holds. The API key is only ever typed in, never loaded. */
export interface TranscriptionDraft {
  readonly provider: TranscriptionProvider;
  readonly baseUrl: string;
  readonly keyMode: KeyMode;
  readonly keyValue: string;
  readonly model: string;
  readonly summaryLanguage: string;
  readonly summaryStyle: string;
  /** Kept as text while editing so a half-typed number is not lost. */
  readonly retentionDays: string;
  readonly allowPrivateEndpoint: boolean;
}

export interface ConfigSnapshot {
  readonly provider: TranscriptionProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly summaryLanguage: string | null;
  readonly summaryStyle: string | null;
  readonly retentionDays: number;
  readonly allowPrivateEndpoint: boolean;
}

export const MODEL_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ["tiny", "Fastest and lightest. Fine for clear speech, misses more."],
  ["base", "A good default for most servers. Quick on a CPU."],
  ["small", "Noticeably more accurate. Uses more memory and time."],
  ["medium", "Accurate for accents and noise. Needs a capable server."],
  ["large-v3-turbo", "Best accuracy. Wants a lot of memory, ideally a GPU."],
]);

export function draftFromConfig(config: ConfigSnapshot): TranscriptionDraft {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    keyMode: "keep",
    keyValue: "",
    model: config.model,
    summaryLanguage: config.summaryLanguage ?? "",
    summaryStyle: config.summaryStyle ?? "",
    retentionDays: String(config.retentionDays),
    allowPrivateEndpoint: config.allowPrivateEndpoint,
  };
}

/** True when the form differs from what is saved. A typed key counts, even if the rest matches. */
export function draftIsDirty(draft: TranscriptionDraft, baseline: TranscriptionDraft): boolean {
  if (draft.keyMode === "clear") {
    return true;
  }
  if (draft.keyMode === "replace" && draft.keyValue.trim().length > 0) {
    return true;
  }
  return (
    draft.provider !== baseline.provider ||
    draft.baseUrl.trim() !== baseline.baseUrl ||
    draft.model.trim() !== baseline.model ||
    draft.summaryLanguage.trim() !== baseline.summaryLanguage ||
    draft.summaryStyle.trim() !== baseline.summaryStyle ||
    draft.retentionDays.trim() !== baseline.retentionDays ||
    draft.allowPrivateEndpoint !== baseline.allowPrivateEndpoint
  );
}

/** A problem with the base URL the server would refuse anyway, worded for the form. */
export function endpointProblem(draft: TranscriptionDraft): string | null {
  const text = draft.baseUrl.trim();
  if (text.length === 0) {
    return "Enter the endpoint's base URL.";
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter a full URL, such as https://openrouter.ai/api/v1.";
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return "Put the key in the API key field, not in the URL.";
  }
  if (isAlwaysRefusedHost(url.hostname)) {
    return "localhost, loopback, link-local and cloud-metadata addresses are always refused. Use a private LAN address or host.docker.internal.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && draft.allowPrivateEndpoint)) {
    return draft.allowPrivateEndpoint
      ? "Use an http or https URL."
      : "Use https, or allow a private network endpoint below.";
  }
  return null;
}

/**
 * Hosts the server refuses whatever the private-network opt-in says: loopback
 * (`localhost`, 127.0.0.0/8, ::1), the unspecified address, and link-local
 * (169.254.0.0/16, which includes the cloud metadata address, and fe80::/10).
 * Checked here only so the form says so before a round trip; the server decides.
 */
export function isAlwaysRefusedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "::" || /^fe[89ab][0-9a-f]:/u.test(host)) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host);
  if (v4 !== null) {
    const first = Number(v4[1]);
    const second = Number(v4[2]);
    return first === 127 || first === 0 || (first === 169 && second === 254);
  }
  return false;
}

/** The arguments for `transcription.updateConfig`: the key only when it is being changed. */
export function updateArgsFromDraft(draft: TranscriptionDraft): {
  readonly provider: TranscriptionProvider;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly summaryLanguage: string;
  readonly summaryStyle: string;
  readonly retentionDays: number;
  readonly allowPrivateEndpoint: boolean;
} {
  const apiKey =
    draft.keyMode === "clear"
      ? { apiKey: "" }
      : draft.keyMode === "replace" && draft.keyValue.trim().length > 0
        ? { apiKey: draft.keyValue.trim() }
        : {};
  return {
    provider: draft.provider,
    baseUrl: draft.provider === "openrouter" ? OPENROUTER_BASE_URL : draft.baseUrl.trim(),
    ...apiKey,
    model: draft.model.trim(),
    summaryLanguage: draft.summaryLanguage.trim(),
    summaryStyle: draft.summaryStyle.trim(),
    retentionDays: clampRetentionDays(Number(draft.retentionDays)),
    allowPrivateEndpoint: draft.allowPrivateEndpoint,
  };
}

export interface ModelStatusInput {
  readonly status: TranscriptionModelStatus;
  readonly progress: number | null;
  readonly error: string | null;
}

/**
 * The label, detail line and progress (0-100, or `null`) for the model row.
 * `indeterminate` is true while a download is running but the server has no
 * percentage to report (`modelProgress: null`): show a bar that is not a number.
 */
export function modelStatusLine(input: ModelStatusInput): {
  readonly label: string;
  readonly detail: string;
  readonly progress: number | null;
  readonly indeterminate: boolean;
} {
  switch (input.status) {
    case "ready":
      return {
        label: "Ready",
        detail: "Downloaded and ready to transcribe.",
        progress: null,
        indeterminate: false,
      };
    case "downloading": {
      const progress =
        input.progress === null ? null : Math.min(100, Math.max(0, Math.round(input.progress)));
      return {
        label: progress === null ? "Downloading…" : `Downloading… ${progress}%`,
        detail: "This can take a few minutes. You can leave this page.",
        progress,
        indeterminate: progress === null,
      };
    }
    case "error":
      return {
        label: "Download failed",
        detail: input.error ?? "The download did not finish. Try again.",
        progress: null,
        indeterminate: false,
      };
    case "not_installed":
      return {
        label: "Not downloaded",
        detail: "Download a model before anyone can start transcription.",
        progress: null,
        indeterminate: false,
      };
  }
}

/**
 * A non-blocking notice for the last download that failed while the model in use
 * stayed ready (the server's `modelError`), or `null` when there is nothing to say. Never shown
 * for the model whose own status is already an error: that row says so itself.
 */
export function downloadNotice(input: {
  readonly lastError: string | null | undefined;
  readonly modelStatus: TranscriptionModelStatus;
}): string | null {
  const text = input.lastError?.trim() ?? "";
  if (text.length === 0 || input.modelStatus === "error") {
    return null;
  }
  return `The last model download failed: ${text}`;
}
