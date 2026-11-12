import {
  formatLocalDateTime,
  formatLocalTimeWithZone,
  GUEST_AFFILIATION_MAX,
  GUEST_NAME_MAX,
  normalizeGuestText,
} from "@aulora/core";
import { Button, Input, Spinner } from "@aulora/ui-web";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { type JoinFailure, previewNotice } from "../../lib/guest/page-state";
import { useNow } from "../scheduled/use-now";
import { DeviceCheck, type GuestMediaChoices } from "./DeviceCheck";

export interface JoinSubmission {
  readonly displayName: string;
  readonly affiliation: string;
}

/** The sentence for a join that did not go through. Never more than the server meant to say. */
export function failureText(failure: JoinFailure): string {
  switch (failure.kind) {
    case "not-open":
      return `This call hasn’t started yet. It opens at ${formatLocalTimeWithZone(failure.opensAt)}.`;
    case "not-started":
      return "The call hasn’t started yet. Try again in a moment.";
    case "busy":
      return "Too many people are waiting to join this call. Try again in a few minutes.";
    case "rate-limited":
      return "Too many attempts. Wait a minute and try again.";
    case "invalid-input":
      return failure.message;
    case "unavailable":
      return "This guest link isn’t available.";
    case "generic":
      return "Something went wrong. Try again.";
  }
}

/**
 * The guest lobby: who you are, how you look and sound, and one button. The
 * preview tells whether the call is open yet, in the guest’s own time zone;
 * the server decides for real when they ask.
 */
export function GuestJoinForm({
  linkToken,
  choices,
  onChoices,
  busy,
  failure,
  onTitle,
  onSubmit,
}: {
  readonly linkToken: string;
  readonly choices: GuestMediaChoices;
  readonly onChoices: (next: GuestMediaChoices) => void;
  readonly busy: boolean;
  readonly failure: JoinFailure | null;
  /** Reports the call’s title so the in-call header can show it. */
  readonly onTitle: (title: string) => void;
  readonly onSubmit: (submission: JoinSubmission) => void;
}) {
  const preview = useQuery(api.guestCalls.preview, { token: linkToken });
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const now = useNow(15_000);
  const title = preview?.title;
  useEffect(() => {
    if (title !== undefined) {
      onTitle(title);
    }
  }, [title, onTitle]);

  if (preview === undefined) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner size={28} label="Opening your invite" />
      </main>
    );
  }

  const notice = previewNotice(preview, now);
  const cleanName = normalizeGuestText(name);
  const cleanAffiliation = normalizeGuestText(affiliation);
  const nameError =
    submitted && cleanName.length === 0
      ? "Enter your name so people know who you are."
      : cleanName.length > GUEST_NAME_MAX
        ? `Use ${GUEST_NAME_MAX} characters or fewer.`
        : undefined;
  const affiliationError =
    cleanAffiliation.length > GUEST_AFFILIATION_MAX
      ? `Use ${GUEST_AFFILIATION_MAX} characters or fewer.`
      : undefined;
  const blocked = notice.kind !== "open";

  return (
    <main className="min-h-dvh bg-bg px-5 py-8 text-text">
      <div className="mx-auto grid w-full max-w-[980px] items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12 lg:pt-10">
        <DeviceCheck choices={choices} onChange={onChoices} />

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (
              cleanName.length === 0 ||
              nameError !== undefined ||
              affiliationError !== undefined
            ) {
              return;
            }
            onSubmit({ displayName: cleanName, affiliation: cleanAffiliation });
          }}
        >
          <header className="flex flex-col gap-1.5">
            <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">
              {preview.title}
            </h1>
            <p className="text-[14px] leading-relaxed text-text-muted">
              You’ve been invited as a guest. Someone in the call will let you in.
            </p>
          </header>

          {notice.kind === "opens-later" && (
            <p
              role="status"
              data-testid="guest-not-started"
              className="rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 text-[13.5px] leading-relaxed"
            >
              <strong className="font-semibold">The call hasn’t started yet.</strong> It starts{" "}
              {formatLocalDateTime(notice.startsAt, now)} and opens for guests at{" "}
              {formatLocalTimeWithZone(notice.opensAt)}. You can leave this page open.
            </p>
          )}
          {notice.kind === "waiting-for-host" && (
            <p
              role="status"
              data-testid="guest-waiting-for-host"
              className="rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 text-[13.5px] leading-relaxed"
            >
              <strong className="font-semibold">The call hasn’t started yet.</strong> This page
              updates when the host starts it.
            </p>
          )}

          <Input
            label="Your name"
            value={name}
            autoComplete="name"
            maxLength={GUEST_NAME_MAX + 20}
            onChange={(event) => {
              setName(event.target.value);
            }}
            hint="Shown to everyone in the call, with a Guest badge."
            {...(nameError !== undefined ? { error: nameError } : {})}
          />
          <Input
            label="Company or role (optional)"
            value={affiliation}
            autoComplete="organization"
            maxLength={GUEST_AFFILIATION_MAX + 20}
            onChange={(event) => {
              setAffiliation(event.target.value);
            }}
            hint="Only the people admitting you see this."
            {...(affiliationError !== undefined ? { error: affiliationError } : {})}
          />

          {failure !== null && (
            <p role="alert" className="text-[13px] text-danger">
              {failureText(failure)}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" loading={busy} disabled={busy || blocked}>
              Ask to join
            </Button>
            <p className="text-[12px] leading-relaxed text-text-muted">
              Your name, and your voice and picture if you turn them on, are shared with the people
              in the call. Your network address is visible to them too, as in any video call. Calls
              can be transcribed; if so, you will be told and can opt out.
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}
