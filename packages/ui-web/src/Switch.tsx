import { useId } from "react";
import { cn } from "./cn";

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly id?: string;
}

/**
 * A macOS-style toggle: a labelled row with a small sliding switch. The whole
 * row is the hit target and the control keeps `role="switch"` semantics.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  return (
    <div className={cn("flex items-center justify-between gap-4 py-1.5", disabled && "opacity-50")}>
      <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        {description !== undefined && (
          <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
            {description}
          </span>
        )}
      </label>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
          checked ? "bg-accent" : "bg-surface-3 ring-1 ring-inset ring-border",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}

/** A macOS segmented control, used for small mutually exclusive choices. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <fieldset
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-[8px] bg-surface-3 p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-3 py-1 text-[12px] font-medium transition",
              active ? "bg-surface-2 text-text shadow-sm" : "text-text-muted hover:text-text",
            )}
          >
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
