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
  return (
    <Modal
      open
      onClose={() => void voice.declineCall(call.id)}
      label="Incoming call"
      title="Incoming call"
      description={`${caller} · ${callKindLabel(call.kind)}`}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-secondary/15 text-secondary">
          <Icon name="phone-incoming" size={18} />
        </span>
      }
      footer={
        <IncomingCallActions
          onDecline={() => void voice.declineCall(call.id)}
          onAccept={() => void voice.acceptCall(call)}
        />
      }
    >
      <div className="flex items-center gap-3">
        <PresenceAvatar userId={call.initiatorId} size={52} ringClassName="ring-surface-2" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-text">{title}</p>
          <p className="truncate text-[13px] text-text-muted">
            {call.ringingUserIds.length > 1
              ? `${call.ringingUserIds.length} people are being rung`
              : "Ringing…"}
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
  return (
    <>
      <Button
        type="button"
        variant="danger"
        leading={<Icon name="phone-hangup" size={15} />}
        onClick={onDecline}
      >
        Decline
      </Button>
      <Button
        type="button"
        variant="success"
        leading={<Icon name="phone" size={15} />}
        onClick={onAccept}
      >
        Accept
      </Button>
    </>
  );
}
