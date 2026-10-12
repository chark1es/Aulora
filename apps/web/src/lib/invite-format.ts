import { type InviteKind, isValidEmail } from "@aulora/core";

export type InviteStatus = "active" | "revoked" | "expired" | "exhausted";

export type ExpiryPreset = "1h" | "1d" | "7d" | "30d" | "never" | "custom";

const HOUR = 60 * 60 * 1000;

const PRESET_MS = new Map<ExpiryPreset, number>([
  ["1h", HOUR],
  ["1d", 24 * HOUR],
  ["7d", 7 * 24 * HOUR],
  ["30d", 30 * 24 * HOUR],
]);

export const EXPIRY_OPTIONS: readonly { value: ExpiryPreset; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
  { value: "custom", label: "Pick a date…" },
];

export type ExpiryResult =
  | { readonly ok: true; readonly expiresAt: number | null }
  | { readonly ok: false; readonly error: string };

/**
 * Turns the form's expiry choice into the value the server stores: a
 * timestamp, or `null` for "never". A custom date is the value of a
 * `datetime-local` input, read in the viewer's time zone.
 */
export function resolveExpiry(preset: ExpiryPreset, custom: string, now: number): ExpiryResult {
  if (preset === "never") {
    return { ok: true, expiresAt: null };
  }
  if (preset === "custom") {
    const at = custom.length > 0 ? new Date(custom).getTime() : Number.NaN;
    if (Number.isNaN(at)) {
      return { ok: false, error: "Pick when the invite should expire." };
    }
    return at > now
      ? { ok: true, expiresAt: at }
      : { ok: false, error: "The expiry has to be in the future." };
  }
  return { ok: true, expiresAt: now + (PRESET_MS.get(preset) ?? 0) };
}

export type UsesMode = "once" | "limited" | "unlimited";

export const USES_OPTIONS: readonly { value: UsesMode; label: string }[] = [
  { value: "once", label: "One time" },
  { value: "limited", label: "Limited" },
  { value: "unlimited", label: "Unlimited" },
];

export type UsesResult =
  | { readonly ok: true; readonly maxUses: number }
  | { readonly ok: false; readonly error: string };

/** The use limit for the form's choice; `0` means unlimited on the server. */
export function resolveMaxUses(mode: UsesMode, count: string): UsesResult {
  if (mode === "once") {
    return { ok: true, maxUses: 1 };
  }
  if (mode === "unlimited") {
    return { ok: true, maxUses: 0 };
  }
  const parsed = Number(count);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 100_000) {
    return { ok: false, error: "Enter a whole number of uses, 2 or more." };
  }
  return { ok: true, maxUses: parsed };
}

export const KIND_LABELS = new Map<InviteKind, string>([
  ["link", "Link"],
  ["email", "Email"],
  ["code", "Code"],
]);

export const KIND_SUMMARIES = new Map<InviteKind, string>([
  ["link", "A web link anyone you share it with can open."],
  ["email", "A one-time link we email to a single address."],
  ["code", "A short code someone types in after signing in."],
]);

export function kindLabel(kind: InviteKind): string {
  return KIND_LABELS.get(kind) ?? "Link";
}

const STATUS_LABELS = new Map<InviteStatus, string>([
  ["active", "Active"],
  ["revoked", "Revoked"],
  ["expired", "Expired"],
  ["exhausted", "Used up"],
]);

export function statusLabel(status: InviteStatus): string {
  return STATUS_LABELS.get(status) ?? "Active";
}

/** `"Never expires"`, `"Expires Oct 4"`, or `"Expired Oct 4"`. */
export function expiryLabel(expiresAt: number | null, now: number): string {
  if (expiresAt === null) {
    return "Never expires";
  }
  const date = new Date(expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return expiresAt <= now ? `Expired ${date}` : `Expires ${date}`;
}

/** `"2 of 5 used"`, `"3 used"` for unlimited, `"Used once"` style for a single use. */
export function usesLabel(uses: number, maxUses: number): string {
  if (maxUses === 0) {
    return `${uses} used · no limit`;
  }
  if (maxUses === 1) {
    return uses >= 1 ? "Used" : "One time";
  }
  return `${uses} of ${maxUses} used`;
}

export function formatDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function allowlistKindLabel(kind: "email" | "domain"): string {
  return kind === "domain" ? "Domain" : "Address";
}

export interface InviteDraft {
  readonly kind: InviteKind;
  readonly email: string;
  readonly expiry: ExpiryPreset;
  readonly customExpiry: string;
  readonly uses: UsesMode;
  readonly count: string;
  readonly note: string;
}

export const INITIAL_DRAFT: InviteDraft = {
  kind: "link",
  email: "",
  expiry: "7d",
  customExpiry: "",
  uses: "unlimited",
  count: "5",
  note: "",
};

/** The use limit a method starts with: an emailed or typed code is for one person. */
export function defaultUses(kind: InviteKind): UsesMode {
  return kind === "link" ? "unlimited" : "once";
}

/** What `invites.create` accepts. */
export interface CreateInviteArgs {
  readonly kind: InviteKind;
  readonly expiresAt: number | null;
  readonly maxUses?: number;
  readonly email?: string;
  readonly note?: string;
}

export type DraftResult =
  | { readonly ok: true; readonly args: CreateInviteArgs }
  | { readonly ok: false; readonly error: string };

/** Validates the form and shapes the mutation arguments. */
export function buildCreateArgs(draft: InviteDraft, now: number): DraftResult {
  const email = draft.email.trim();
  if (draft.kind === "email" && email.length === 0) {
    return { ok: false, error: "Enter the email address to send the invite to." };
  }
  if (email.length > 0 && !isValidEmail(email)) {
    return { ok: false, error: "That email address does not look right." };
  }
  const expiry = resolveExpiry(draft.expiry, draft.customExpiry, now);
  if (!expiry.ok) {
    return expiry;
  }
  const uses = resolveMaxUses(draft.uses, draft.count);
  if (!uses.ok) {
    return uses;
  }
  const note = draft.note.trim();
  return {
    ok: true,
    args: {
      kind: draft.kind,
      expiresAt: expiry.expiresAt,
      ...(draft.kind !== "email" ? { maxUses: uses.maxUses } : {}),
      ...(email.length > 0 ? { email } : {}),
      ...(note.length > 0 ? { note } : {}),
    },
  };
}
