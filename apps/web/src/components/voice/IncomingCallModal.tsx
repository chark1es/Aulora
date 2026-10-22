import type { CallView } from "@aulora/core";
import { callKindLabel } from "@aulora/core";
import { Button, Icon, Modal } from "@aulora/ui-web";
import { useVoice } from "../../providers/VoiceProvider";
import { PresenceAvatar } from "../chat/PresenceAvatar";
import { type CallIdentity, UNKNOWN_IDENTITY } from "./identity";

/** The ringing surface for a DM/group-DM call. */
export function IncomingCallModal({
  call,
  title,
  identity = UNKNOWN_IDENTITY,
}: {
  readonly call: CallView;
  readonly title: string;
  readonly identity?: CallIdentity;
}) {
  const voice = useVoice();
  const caller = identity.nameOf(call.initiatorId);
  const group = call.ringingUserIds.length > 1;
  return (
    <Modal
      open
      onClose={() => void voice.declineCall(call.id)}
      label="Incoming call"
      hideHeader
      hideClose
      initialFocus="panel"
      size="sm"
      footer={
        <IncomingCallActions
          onDecline={() => void voice.declineCall(call.id)}
          onAccept={() => void voice.acceptCall(call)}
        />
      }
    >
      <div className="flex flex-col items-center gap-4 pb-2 pt-1 text-center">
        <PresenceAvatar userId={call.initiatorId} size={80} ringClassName="ring-surface-2" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-[19px] font-semibold tracking-[-0.015em] text-text">
            {title}
          </p>
          <p className="text-[13.5px] leading-relaxed text-text-muted">
            Incoming call{caller !== title ? ` from ${caller}` : ""} · {callKindLabel(call.kind)}
          </p>
          <p className="text-[12px] text-text-muted">
            {group ? `${call.ringingUserIds.length} people are being rung` : "Ringing…"}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function IncomingCallActions({
  onDecline,
  onAccept,
}: {
  readonly onDecline: () => void;
  readonly onAccept: () => void;
}) {
  // Centred under the caller, two equal targets, like a phone's call sheet.
  return (
    <div className="flex w-full gap-3 [&>button]:flex-1">
      <Button
        type="button"
        size="lg"
        variant="danger"
        className="rounded-full"
        leading={<Icon name="phone-hangup" size={18} />}
        onClick={onDecline}
      >
        Decline
      </Button>
      <Button
        type="button"
        size="lg"
        variant="success"
        className="rounded-full"
        leading={<Icon name="phone" size={18} />}
        onClick={onAccept}
      >
        Accept
      </Button>
    </div>
  );
}
