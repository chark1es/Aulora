/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import type { InviteKind } from "@aulora/core";
import { Button, Input, SegmentedControl, Select, Text } from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  buildCreateArgs,
  defaultUses,
  EXPIRY_OPTIONS,
  INITIAL_DRAFT,
  type InviteDraft,
  KIND_SUMMARIES,
  USES_OPTIONS,
} from "../../../lib/invite-format";
import { inviteUrl } from "../../../lib/invites";
import { type CreatedInvite, InviteCreated } from "./InviteCreated";

const KIND_OPTIONS: readonly { value: InviteKind; label: string }[] = [
  { value: "link", label: "Link" },
  { value: "email", label: "Email" },
  { value: "code", label: "Code" },
];

type SetDraft = (patch: Partial<InviteDraft>) => void;

function RecipientField({ draft, set }: { readonly draft: InviteDraft; readonly set: SetDraft }) {
  const required = draft.kind === "email";
  return (
    <Input
      label={required ? "Send to" : "Only for (optional)"}
      type="email"
      placeholder="teammate@example.com"
      autoComplete="off"
      value={draft.email}
      onChange={(event) => {
        set({ email: event.currentTarget.value });
      }}
      hint={
        required
          ? "We email a one-time link to this address. Only that account can use it."
          : "Limit this invite to the account that signs in with this address."
      }
    />
  );
}

function ExpiryField({ draft, set }: { readonly draft: InviteDraft; readonly set: SetDraft }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Select
        label="Expires"
        value={draft.expiry}
        options={EXPIRY_OPTIONS}
        onChange={(expiry) => {
          set({ expiry });
        }}
      />
      {draft.expiry === "custom" && (
        <Input
          label="Expires on"
          type="datetime-local"
          value={draft.customExpiry}
          onChange={(event) => {
            set({ customExpiry: event.currentTarget.value });
          }}
        />
      )}
    </div>
  );
}

function UsesField({ draft, set }: { readonly draft: InviteDraft; readonly set: SetDraft }) {
  const locked = draft.kind === "email";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {locked ? (
        <>
          <span className="text-[13px] font-medium text-text-muted">Can be used</span>
          <div className="flex h-10 items-center rounded-input border border-border bg-surface-3 px-3 text-[14px] text-text-muted">
            One time
          </div>
        </>
      ) : (
        <Select
          label="Can be used"
          value={draft.uses}
          options={USES_OPTIONS}
          onChange={(uses) => {
            set({ uses });
          }}
        />
      )}
      {!locked && draft.uses === "limited" && (
        <Input
          label="How many times"
          type="number"
          min={2}
          step={1}
          inputMode="numeric"
          value={draft.count}
          onChange={(event) => {
            set({ count: event.currentTarget.value });
          }}
        />
      )}
    </div>
  );
}

export interface InviteCreateFormProps {
  readonly origin: string;
}

/**
 * Creates an invite. Link and code invites can be shared anywhere; an email
 * invite is sent to one address and works once. Any of them can expire, be
 * capped, or be limited to the account that owns a given address.
 */
export function InviteCreateForm({ origin }: InviteCreateFormProps) {
  const create = useMutation(api.invites.create);
  const [draft, setDraft] = useState<InviteDraft>(INITIAL_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const set: SetDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildCreateArgs(draft, Date.now());
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    setCreated(null);
    void create(built.args)
      .then((result) => {
        setCreated({
          code: result.code,
          kind: result.kind,
          link: inviteUrl(origin, result.code),
          emailedTo: result.kind === "email" ? (built.args.email ?? null) : null,
        });
        setDraft((current) => ({ ...current, email: "", note: "" }));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not create the invite.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} data-testid="invite-create-form">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-text">Create an invite</h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Pick how they join, then how long the invite lasts and who can use it.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-y border-border/60 py-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-muted">How should they join?</span>
          <SegmentedControl
            label="Invite method"
            value={draft.kind}
            options={KIND_OPTIONS}
            className="self-start"
            onChange={(kind) => {
              set({ kind, uses: defaultUses(kind) });
            }}
          />
          <Text size="xs" tone="muted">
            {KIND_SUMMARIES.get(draft.kind)}
          </Text>
        </div>

        <RecipientField draft={draft} set={set} />

        <div className="grid gap-4 sm:grid-cols-2">
          <ExpiryField draft={draft} set={set} />
          <UsesField draft={draft} set={set} />
        </div>

        <Input
          label="Note (optional)"
          placeholder="Who is this for?"
          maxLength={80}
          value={draft.note}
          onChange={(event) => {
            set({ note: event.currentTarget.value });
          }}
          hint="Only admins see this. It helps you tell invites apart."
        />

        {error !== null && (
          <Text tone="danger" size="sm" role="alert">
            {error}
          </Text>
        )}

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            {draft.kind === "email" ? "Send invite" : "Create invite"}
          </Button>
        </div>
      </div>

      {created !== null && <InviteCreated invite={created} />}
    </form>
  );
}
