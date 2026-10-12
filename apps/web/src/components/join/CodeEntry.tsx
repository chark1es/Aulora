import { normalizeInviteCode } from "@aulora/core";
import { Button, Input, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import { redeemErrorMessage, redeemOutcomeMessage } from "../../lib/invites";

export interface CodeEntryProps {
  /** Called once the invite is accepted; membership itself is reactive. */
  readonly onJoined?: () => void;
}

/**
 * Join with an invite code or link. Takes a bare code (any case, with or
 * without dashes) or a whole pasted invite link; the server normalises both.
 */
export function CodeEntry({ onJoined }: CodeEntryProps) {
  const redeem = useMutation(api.invites.redeem);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = normalizeInviteCode(value).length >= 8;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void redeem({ code: value })
      .then((outcome) => {
        if (outcome.joined) {
          onJoined?.();
          return;
        }
        setError(redeemOutcomeMessage(outcome));
      })
      .catch((cause: unknown) => {
        setError(redeemErrorMessage(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
      <Input
        label="Invite code or link"
        size="lg"
        placeholder="ABCD-EFGH-JKMN"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        hint="Paste the link you were sent, or type the code."
      />
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
      <Button size="lg" type="submit" loading={busy} disabled={!ready || busy}>
        <span className="text-[15px] font-semibold">Join workspace</span>
      </Button>
    </form>
  );
}
