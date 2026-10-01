import { Icon, Modal } from "@aulora/ui-web";

/** Confirms that joining will disconnect the call on the user's other device. */
export function SwitchDeviceCallModal({
  open,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      label="Join on this device"
      title="Join on this device?"
      description="You're already in a call on another device."
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name="monitor" size={18} />
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 items-center rounded-[8px] px-3.5 text-[13px] font-semibold text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-9 items-center gap-1.5 rounded-[8px] bg-secondary px-3.5 text-[13px] font-semibold text-white transition hover:brightness-110"
          >
            <Icon name="phone" size={15} />
            Join here
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-text-muted">
        Continuing disconnects you there. That device will show that you joined from this one
        instead of the call.
      </p>
    </Modal>
  );
}
