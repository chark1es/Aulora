/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, Input, Modal } from "@aulora/ui-web";
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
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    void Promise.resolve(onRename(trimmed)).finally(() => {
      setBusy(false);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Rename channel"
      title="Rename channel"
      description={`New name for this ${kindLabel}.`}
      icon={<Icon name="pencil" size={18} />}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            loading={busy}
            onClick={submit}
          >
            Save
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        label="Name"
        value={name}
        maxLength={80}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            submit();
          }
        }}
      />
    </Modal>
  );
}
