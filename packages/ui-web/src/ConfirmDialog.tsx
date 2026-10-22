import type { IconName } from "@aulora/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly variant?: "primary" | "danger";
  /** The danger tile's glyph. Defaults to `trash`, since most danger confirms delete. */
  readonly icon?: IconName;
  readonly onConfirm: () => void;
}

/**
 * A small confirm dialog: a title, the explanation as body copy, a cancel and
 * a single action. Danger confirms lead with an icon tile; primary ones stay
 * plain. Built on {@link Modal} so focus, Escape and the backdrop behave the
 * same as every other dialog in the app.
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
    icon = "trash",
    onConfirm,
  } = props;
  const danger = variant === "danger";
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      label={title}
      title={title}
      {...(danger ? { tone: "danger" as const, icon: <Icon name={icon} size={18} /> } : {})}
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
      {description !== undefined ? (
        <p className="text-[14px] leading-relaxed text-text-muted">{description}</p>
      ) : null}
    </Modal>
  );
}
