/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { Button, Icon, Input, Modal } from "@aulora/ui-web";
import { useEffect, useState } from "react";

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

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setSubmitting(false);
    }
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
    void Promise.resolve(onSubmit(trimmed)).finally(() => {
      setSubmitting(false);
    });
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
      icon={<Icon name={mode === "rename" ? "pencil" : "folder-plus"} size={18} />}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            loading={isBusy}
            onClick={submit}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Category name"
          placeholder="e.g. Product"
          value={name}
          maxLength={80}
          leading={<Icon name={mode === "rename" ? "pencil" : "folder-plus"} size={15} />}
          onFocus={(event) => {
            // Renaming starts with the old name selected, ready to replace.
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...(error !== null && error.length > 0 ? { error } : {})}
        />
      </form>
    </Modal>
  );
}
