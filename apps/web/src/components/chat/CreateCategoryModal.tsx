import { Icon, Input, Modal } from "@aulora/ui-web";
import { useEffect, useRef, useState } from "react";

export interface CreateCategoryModalProps {
  readonly open: boolean;
  readonly mode?: "create" | "rename";
  readonly initialName?: string;
  readonly title?: string;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => void | Promise<void>;
}

/**
 * The create/rename-category dialog: a focused modal with a single name field.
 * Shared by the "New category" chooser action and the category context-menu
 * "Rename" action so the two stay visually and behaviourally identical.
 */
export function CreateCategoryModal({
  open,
  mode = "create",
  initialName = "",
  title,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: CreateCategoryModalProps) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setSubmitting(false);
      const frame = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, initialName]);

  const trimmed = name.trim();
  const isBusy = busy || submitting;
  const canSubmit = trimmed.length > 0 && !isBusy;
  const heading = title ?? (mode === "rename" ? "Rename category" : "Create a category");
  const primaryLabel = mode === "rename" ? "Save" : "Create category";

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    void Promise.resolve(onSubmit(trimmed)).finally(() => setSubmitting(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={heading}
      title={heading}
      description={
        mode === "rename"
          ? "Give this category a new name."
          : "Group related channels together in the sidebar."
      }
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icon name={mode === "rename" ? "pencil" : "plus"} size={18} />
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
            onClick={submit}
            className="h-9 rounded-[8px] bg-accent px-3.5 text-[13px] font-semibold text-on-accent transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {isBusy ? (mode === "rename" ? "Saving…" : "Creating…") : primaryLabel}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          ref={inputRef}
          label="Category name"
          placeholder="e.g. Product"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          {...(error !== null && error.length > 0 ? { error } : {})}
        />
      </form>
    </Modal>
  );
}
