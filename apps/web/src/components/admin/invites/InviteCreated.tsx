import { formatAccessCode, type InviteKind } from "@aulora/core";
import { Icon, Text } from "@aulora/ui-web";
import { CopyButton } from "./CopyButton";

export interface CreatedInvite {
  readonly code: string;
  readonly kind: InviteKind;
  readonly link: string;
  readonly emailedTo: string | null;
}

function Secret({
  value,
  label,
  mono,
}: {
  readonly value: string;
  readonly label: string;
  readonly mono?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <code
        className={
          mono ??
          "min-w-0 flex-1 truncate rounded-[7px] border border-border bg-surface-1 px-2.5 py-1.5 font-mono text-[12px] text-text"
        }
      >
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

/**
 * The one-time reveal after creating an invite. The plaintext code is never
 * stored, so this is the only place it can be copied from.
 */
export function InviteCreated({ invite }: { readonly invite: CreatedInvite }) {
  const emailed = invite.emailedTo !== null;
  return (
    <div
      className="flex animate-fade-in flex-col gap-2.5 rounded-[12px] border border-accent/30 bg-accent-soft/40 p-3.5"
      data-testid="invite-created"
    >
      <div className="flex items-center gap-2">
        <Icon name={emailed ? "mail" : "check"} size={15} className="text-accent" />
        <span className="text-[13px] font-medium text-text">
          {emailed ? `Invitation on its way to ${invite.emailedTo}` : "Invite created"}
        </span>
      </div>

      {invite.kind === "code" && (
        <Secret
          value={formatAccessCode(invite.code)}
          label="Access code"
          mono="min-w-0 flex-1 rounded-[8px] border border-border bg-surface-1 px-3 py-2 text-center font-mono text-[18px] font-semibold tracking-[0.18em] text-text"
        />
      )}
      <Secret value={invite.link} label="Invite link" />

      <Text size="xs" tone="muted">
        {emailed
          ? "They get a one-time link by email. You can also copy it now."
          : invite.kind === "code"
            ? "Share the code, or the link, which has it built in."
            : "Share the link anywhere."}{" "}
        Copy it before you leave — it is only shown once.
      </Text>
    </div>
  );
}
