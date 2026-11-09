import {
  formatLocalDateTime,
  formatLocalTimeWithZone,
  GUEST_LINK_MAX_USES,
  GUEST_MAX_PER_CALL,
} from "@aulora/core";
import {
  Badge,
  Button,
  Field,
  Icon,
  Input,
  Modal,
  ModalFooter,
  Select,
  Text,
} from "@aulora/ui-web";
import { useMutation, useQuery } from "convex/react";
import { Component, type ReactNode, useState } from "react";
import { api } from "../../../../../packages/convex/convex/_generated/api";
import type { Id } from "../../../../../packages/convex/convex/_generated/dataModel";
import {
  DEFAULT_EXPIRY_VALUE,
  DEFAULT_MAX_USES_TEXT,
  GUEST_LINK_EXPIRY_OPTIONS,
  GUEST_LINK_STATE_LABEL,
  type GuestLinkState,
  guestLinkState,
  linksQueryArgs,
  parseMaxUses,
  showsLinkList,
} from "../../lib/guest/link-state";
import { useVoice } from "../../providers/VoiceProvider";
import { useClipboardCopy } from "../admin/useClipboardCopy";

interface CreatedLink {
  readonly url: string;
  readonly expiresAt: number;
  readonly maxUses: number;
}

const STATE_TONE: Record<GuestLinkState, "success" | "neutral" | "danger"> = {
  active: "success",
  revoked: "danger",
  expired: "neutral",
  "used-up": "neutral",
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Could not create the link. Try again.";
}

export type GuestLinkTarget =
  | { readonly channelId: string; readonly scheduledCallId?: never }
  | { readonly scheduledCallId: string; readonly channelId?: never };

/**
 * Invite a guest to the call you are in: choose how long the link lasts and how
 * many people it admits, create it, and copy it. The link is shown once, here,
 * and is never stored in the browser: the server keeps only a hash.
 */
export function InviteGuestDialog() {
  const voice = useVoice();
  const call = voice.call;
  if (call === null) {
    return null;
  }
  const target: GuestLinkTarget =
    call.channelId !== null
      ? { channelId: call.channelId }
      : { scheduledCallId: call.scheduledCallId ?? "" };
  return (
    <GuestLinkDialog
      target={target}
      callId={call.id}
      onClose={() => {
        voice.setInviteGuestOpen(false);
      }}
    />
  );
}

/** The link dialog for any target: a live call, or a scheduled call that has not started. */
export function GuestLinkDialog({
  target,
  callId,
  onClose,
}: {
  readonly target: GuestLinkTarget;
  /** The live call, when there is one; lets the dialog list and revoke its links. */
  readonly callId: string | null;
  readonly onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      label="Invite a guest"
      title="Invite a guest"
      description="Anyone with the link can ask to join. They only get in when someone in the call lets them in."
      size="md"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </ModalFooter>
      }
    >
      <InviteBody target={target} callId={callId} />
    </Modal>
  );
}

export function InviteBody({
  target,
  callId,
  onCreated,
}: {
  readonly target: GuestLinkTarget;
  readonly callId: string | null;
  readonly onCreated?: (() => void) | undefined;
}) {
  const createLink = useMutation(api.guestCalls.createLink);
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY_VALUE);
  const [maxUsesText, setMaxUsesText] = useState(DEFAULT_MAX_USES_TEXT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const maxUses = parseMaxUses(maxUsesText);
  const expiryMs = GUEST_LINK_EXPIRY_OPTIONS.find((option) => option.value === expiry)?.ms;

  const submit = () => {
    if (maxUses === null || expiryMs === undefined || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const args =
      target.channelId !== undefined
        ? { channelId: target.channelId as never }
        : { scheduledCallId: target.scheduledCallId as never };
    void createLink({ ...args, expiresInMs: expiryMs, maxUses })
      .then((result) => {
        setCreated({ url: result.url, expiresAt: result.expiresAt, maxUses: result.maxUses });
        onCreated?.();
      })
      .catch((cause: unknown) => {
        setError(errorText(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-5">
      {created === null ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Link works for"
              value={expiry}
              onChange={setExpiry}
              options={GUEST_LINK_EXPIRY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <Input
              label="People it can admit"
              inputMode="numeric"
              value={maxUsesText}
              onChange={(event) => {
                setMaxUsesText(event.target.value);
              }}
              hint={`1 to ${GUEST_LINK_MAX_USES}. A call holds up to ${GUEST_MAX_PER_CALL} guests.`}
              {...(maxUses === null
                ? { error: `Enter a number from 1 to ${GUEST_LINK_MAX_USES}` }
                : {})}
            />
          </div>
          {error !== null && (
            <Text tone="danger" size="sm" role="alert">
              {error}
            </Text>
          )}
          <div>
            <Button
              type="submit"
              loading={busy}
              disabled={busy || maxUses === null}
              leading={<Icon name="link" size={15} />}
            >
              Create link
            </Button>
          </div>
        </form>
      ) : (
        <CreatedLinkPanel
          link={created}
          onAnother={() => {
            setCreated(null);
          }}
        />
      )}
      {/* A scheduled call lists its links without a live call; a failed read hides the list only. */}
      <HideOnFailure>
        <ExistingLinks target={target} callId={callId} />
      </HideOnFailure>
    </div>
  );
}

/** A refused read of the links list hides the list; it must never take the dialog down. */
class HideOnFailure extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function CreatedLinkPanel({
  link,
  onAnother,
}: {
  readonly link: CreatedLink;
  readonly onAnother: () => void;
}) {
  const { copied, copy } = useClipboardCopy(link.url);
  return (
    <div className="flex flex-col gap-3" data-testid="guest-link-created">
      <Field
        label="Guest link"
        hint={`Copy it now: it is shown only once. Works until ${formatLocalDateTime(link.expiresAt)} for up to ${link.maxUses} ${link.maxUses === 1 ? "person" : "people"}.`}
      >
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Guest link"
            value={link.url}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-border bg-surface-3 px-2.5 font-mono text-[12px] text-text focus-visible:border-accent focus-visible:outline-none"
          />
          <Button
            variant={copied ? "success" : "primary"}
            onClick={copy}
            leading={<Icon name={copied ? "check" : "copy"} size={15} />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Field>
      <div>
        <Button variant="ghost" size="sm" onClick={onAnother}>
          Create another link
        </Button>
      </div>
    </div>
  );
}

function ExistingLinks({
  target,
  callId,
}: {
  readonly target: GuestLinkTarget;
  readonly callId: string | null;
}) {
  // For a channel call the list is for lobby managers; asking first means an
  // ordinary participant never provokes a permission error. A scheduled call is
  // listed by its own id, so it works before there is a live call.
  const scheduled = target.scheduledCallId !== undefined;
  const access = useQuery(
    api.guestCalls.lobbyAccess,
    !scheduled && callId !== null ? { callId: callId as never } : "skip",
  );
  const queryArgs = linksQueryArgs(target, callId, access?.canManage);
  const links = useQuery(
    api.guestCalls.links,
    queryArgs === "skip"
      ? "skip"
      : "scheduledCallId" in queryArgs
        ? { scheduledCallId: queryArgs.scheduledCallId as Id<"scheduledCalls"> }
        : { callId: queryArgs.callId as Id<"calls"> },
  );
  const revoke = useMutation(api.guestCalls.revokeLink);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  if (!showsLinkList(target, callId, access?.canManage)) {
    return null;
  }
  return (
    <section aria-labelledby="guest-links-heading" className="flex flex-col gap-2">
      <h3 id="guest-links-heading" className="text-[13px] font-semibold text-text">
        Links for this call
      </h3>
      {links === undefined ? (
        <Text tone="muted" size="sm">
          Loading links…
        </Text>
      ) : links.length === 0 ? (
        <Text tone="muted" size="sm">
          No links yet.
        </Text>
      ) : (
        <ul className="divide-y divide-border/60 rounded-[10px] border border-border">
          {links.map((link) => {
            const state = guestLinkState(link, now);
            return (
              <li key={link.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-text">
                    {link.uses} of {link.maxUses} admitted
                  </p>
                  <p className="text-[11.5px] text-text-muted">
                    Created {formatLocalTimeWithZone(link.createdAt)} · ends{" "}
                    {formatLocalDateTime(link.expiresAt, now)}
                  </p>
                </div>
                <Badge tone={STATE_TONE[state]}>{GUEST_LINK_STATE_LABEL[state]}</Badge>
                {state === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={revoking === link.id}
                    disabled={revoking !== null}
                    onClick={() => {
                      setRevoking(link.id);
                      setError(null);
                      void revoke({ linkId: link.id })
                        .catch((cause: unknown) => {
                          setError(errorText(cause));
                        })
                        .finally(() => {
                          setRevoking(null);
                        });
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Text tone="muted" size="xs">
        Revoking a link stops new requests. People already admitted stay in the call until you
        remove them.
      </Text>
      {error !== null && (
        <Text tone="danger" size="sm" role="alert">
          {error}
        </Text>
      )}
    </section>
  );
}
