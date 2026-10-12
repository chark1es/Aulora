import { joinCodeFailureMessage } from "@aulora/core";
import { Button, Icon, Input, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { redeemErrorMessage } from "../../lib/invites";

export interface AllowlistJoinProps {
  readonly emailHint: string | null;
  readonly emailVerified: boolean;
  readonly canEmailCode: boolean;
}

/**
 * The route for an account whose address an admin pre-approved. A verified
 * address joins directly; otherwise a six-digit code is emailed to prove the
 * mailbox first. Joining flips membership, which swaps this screen for chat.
 */
export function AllowlistJoin({ emailHint, emailVerified, canEmailCode }: AllowlistJoinProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-1 p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon name="check" size={16} className="mt-0.5 shrink-0 text-secondary" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-text">You’re pre-approved</span>
          <Text size="xs" tone="muted">
            {emailHint ?? "Your address"} is on this workspace’s allowlist.
          </Text>
        </div>
      </div>
      {emailVerified ? <DirectJoin /> : <EmailedCode canEmailCode={canEmailCode} />}
    </div>
  );
}

function DirectJoin() {
  const join = useMutation(api.joinAccess.joinAllowlisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <Button
        loading={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void join({})
            .catch((cause: unknown) => {
              setError(redeemErrorMessage(cause));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Join workspace
      </Button>
    </div>
  );
}

interface EmailedCodeProps {
  readonly canEmailCode: boolean;
}

function EmailedCode({ canEmailCode }: EmailedCodeProps) {
  const requestCode = useMutation(api.joinAccess.requestCode);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEmailCode) {
    return (
      <Text size="xs" tone="muted">
        We can’t email a verification code from this server. Ask an admin for an invite link.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Text size="xs" tone="muted">
        {sent
          ? "We emailed you a six-digit code. It expires in 10 minutes."
          : "Confirm it’s your address with a one-time code we email you."}
      </Text>
      {sent && <VerifyForm />}
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <Button
        variant={sent ? "ghost" : "primary"}
        loading={busy}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void requestCode({})
            .then(() => {
              setSent(true);
            })
            .catch((cause: unknown) => {
              setError(redeemErrorMessage(cause));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {sent ? "Send a new code" : "Email me a code"}
      </Button>
    </div>
  );
}

function VerifyForm() {
  const verify = useMutation(api.joinAccess.verifyCode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = /^\d{6}$/.test(code.trim());

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void verify({ code })
      .then((result) => {
        if (!result.joined) {
          setError(joinCodeFailureMessage(result.reason));
        }
      })
      .catch((cause: unknown) => {
        setError(redeemErrorMessage(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit} noValidate>
      <Input
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        value={code}
        onChange={(event) => {
          setCode(event.currentTarget.value.replace(/\D/g, ""));
        }}
        {...(error !== null ? { error } : {})}
      />
      <Button type="submit" loading={busy} disabled={!ready || busy}>
        Verify and join
      </Button>
    </form>
  );
}
