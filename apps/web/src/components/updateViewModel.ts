/**
 * Pure view-model helpers for the desktop and workspace update surfaces. Kept
 * free of React so the state machine wording, progress math and action choice
 * can be unit-tested directly.
 */

import type { UpdatePhase } from "../providers/DesktopUpdateProvider";

export interface UpdateProgressLike {
  readonly downloaded: number;
  readonly contentLength: number | null;
}

export type PrimaryKind = "check" | "download" | "restart" | "install";

export interface PrimaryAction {
  readonly label: string;
  readonly kind: PrimaryKind;
  readonly busy: boolean;
}

export interface StatusInput {
  readonly phase: UpdatePhase;
  readonly available: boolean;
  readonly ready: boolean;
  readonly latestVersion: string | null;
  readonly checked: boolean;
  readonly installDirectly: boolean;
}

export interface PrimaryInput {
  readonly phase: UpdatePhase;
  readonly available: boolean;
  readonly ready: boolean;
  readonly installDirectly: boolean;
  readonly error: string | null;
}

export interface PrimaryHandlers {
  readonly check: () => void;
  readonly download: () => void;
  readonly restart: () => void;
}

/** Percent downloaded when the shell reported a content length, else null. */
export function downloadPercent(progress: UpdateProgressLike | null): number | null {
  if (progress === null) {
    return null;
  }
  const total = progress.contentLength;
  if (total === null || total <= 0) {
    return null;
  }
  return Math.min(100, Math.round((progress.downloaded / total) * 100));
}

export function downloadLabel(progress: UpdateProgressLike | null): string | null {
  if (progress === null) {
    return null;
  }
  const percent = downloadPercent(progress);
  if (percent !== null) {
    return `${percent}% downloaded`;
  }
  return `${formatBytes(progress.downloaded)} downloaded`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${units.at(unit)}`;
}

/** Formats an ISO/date-like release timestamp, or null when it cannot be read. */
export function formatReleaseDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Clock time of the last successful check, or null when never checked. */
export function formatCheckedAt(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

/** "v1.1.0 → v1.2.0", or a single "v1.2.0" when there is no current version. */
export function versionTransition(current: string | null, latest: string | null): string | null {
  if (latest === null || latest === "") {
    return null;
  }
  const next = `v${latest}`;
  if (current === null || current === "" || current === latest) {
    return next;
  }
  return `v${current} → ${next}`;
}

export function statusText(input: StatusInput): string {
  if (input.phase === "checking") {
    return "Checking for updates…";
  }
  if (input.phase === "downloading") {
    return "Downloading update…";
  }
  if (input.phase === "restarting") {
    return input.installDirectly ? "Installing the update…" : "Restarting to finish the update…";
  }
  if (input.ready) {
    return `v${input.latestVersion} is ready to install.`;
  }
  if (input.available) {
    return `v${input.latestVersion} is available.`;
  }
  if (input.checked) {
    return "You’re on the latest version.";
  }
  return "Check for a new release.";
}

/** The single primary action for the current state, or null when none applies. */
export function primaryAction(input: PrimaryInput): PrimaryAction | null {
  if (input.phase === "downloading") {
    return { label: "Downloading…", kind: "download", busy: true };
  }
  if (input.phase === "restarting") {
    return input.installDirectly
      ? { label: "Installing…", kind: "install", busy: true }
      : { label: "Restarting…", kind: "restart", busy: true };
  }
  if (input.installDirectly && input.available) {
    return { label: "Install update", kind: "install", busy: false };
  }
  if (input.ready) {
    return { label: "Restart to finish", kind: "restart", busy: false };
  }
  if (input.available) {
    return { label: "Update now", kind: "download", busy: false };
  }
  if (input.error !== null) {
    return { label: "Retry", kind: "check", busy: false };
  }
  return null;
}

/** Resolves the primary action to the matching handler; install maps to download. */
export function resolvePrimary(action: PrimaryAction, handlers: PrimaryHandlers): () => void {
  const byKind = new Map<PrimaryKind, () => void>([
    ["check", handlers.check],
    ["download", handlers.download],
    ["restart", handlers.restart],
    ["install", handlers.download],
  ]);
  return byKind.get(action.kind) ?? handlers.check;
}
