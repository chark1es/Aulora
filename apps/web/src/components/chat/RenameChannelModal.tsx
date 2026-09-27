import { Icon, Input, Modal } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";

export interface RenameChannelModalProps {
  readonly open: boolean;
  readonly currentName: string;
  readonly kindLabel: string;
  readonly onClose: () => void;
  readonly onRename: (name: string) => void | Promise<void>;
}

/** Renames a channel; the server seals the new name at rest. */
export function RenameChannelModal({
  open,
  currentName,
  kindLabel,
  onClose,
  onRename,
}: RenameChannelModalProps) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setBusy(false);
      const frame = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Rename channel"
      title="Rename channel"
      description={`New name for this ${kindLabel}.`}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name="pencil" size={17} />
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[8px] px-3 text-[13px] font-medium text-text-muted transition hover:bg-surface-3 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) {
                return;
              }
              setBusy(true);
              void Promise.resolve(onRename(trimmed)).finally(() => setBusy(false));
            }}
            className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <Input
        ref={inputRef}
        label="Name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canSubmit) {
            setBusy(true);
            void Promise.resolve(onRename(trimmed)).finally(() => setBusy(false));
          }
        }}
      />
    </Modal>
  );
}
