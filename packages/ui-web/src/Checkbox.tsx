import { useId } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  /** Renders only the box, for rows that already render their own label. */
  readonly bare?: boolean;
  readonly className?: string;
}

/**
 * A labelled checkbox row: a real checkbox keeps native semantics and keyboard
 * behaviour while the visual box matches the app’s soft corners. Set `bare`
 * when the surrounding row already shows the label.
 */
export function Checkbox(props: CheckboxProps) {
  const {
    checked,
    onChange,
    label,
    description,
    disabled = false,
    id,
    bare = false,
    className,
  } = props;
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const control = (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        aria-label={label}
        className={cn(
          "peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border border-text-muted/50 bg-surface-2 transition",
          "checked:border-accent checked:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <Icon
        name="check"
        size={13}
        className="pointer-events-none absolute text-on-accent opacity-0 transition-opacity peer-checked:opacity-100"
      />
    </span>
  );

  if (bare) {
    return <span className={className}>{control}</span>;
  }

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 py-0.5",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="mt-px">{control}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
