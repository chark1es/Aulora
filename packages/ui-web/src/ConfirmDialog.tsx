import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly variant?: "primary" | "danger";
  readonly onConfirm: () => void;
}

/**
 * A small confirm dialog: a title, an optional line of explanation, a cancel
 * and a single action. Built on {@link Modal} so focus, Escape and the backdrop
 * behave the same as every other dialog in the app.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    onClose,
    title,
    description,
    confirmLabel,
    cancelLabel = "Cancel",
    variant = "primary",
    onConfirm,
  } = props;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      label={title}
      title={title}
      {...(description !== undefined ? { description } : {})}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
