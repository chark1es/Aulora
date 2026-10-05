/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { cn, Icon, type IconProps } from "@aulora/ui-web";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PersonAvatar } from "../chat/member-avatars";
import type { BoardMember, Card } from "./types";

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export interface PriorityInfo {
  label: string;
  /** Text color class for the flag and its label. */
  tone: string;
}
const NO_PRIORITY: PriorityInfo = { label: "No priority", tone: "text-text-muted/50" };
const PRIORITY_INFO = new Map<Card["priority"], PriorityInfo>([
  ["none", NO_PRIORITY],
  ["low", { label: "Low", tone: "text-text-muted" }],
  ["medium", { label: "Medium", tone: "text-idle" }],
  ["high", { label: "High", tone: "text-accent" }],
  ["urgent", { label: "Urgent", tone: "text-danger" }],
]);

/** How a priority is named and coloured. */
export function priorityInfo(priority: Card["priority"]): PriorityInfo {
  return PRIORITY_INFO.get(priority) ?? NO_PRIORITY;
}

export function PriorityFlag({
  priority,
  size = 14,
}: {
  priority: Card["priority"];
  size?: number;
}) {
  return <Icon name="flag" size={size} className={priorityInfo(priority).tone} />;
}

/** Card dates are stored as UTC days, so they are compared and shown as days. */
export function dueLabel(at: number, now: number): { text: string; overdue: boolean } {
  const today = new Date(now);
  const days = Math.round(
    (Date.parse(new Date(at).toISOString().slice(0, 10)) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86400000,
  );
  const text =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : new Date(at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
              ...(new Date(at).getUTCFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
            });
  return { text, overdue: days < 0 };
}

export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-text"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Overlapping avatars, collapsing the overflow into a count. */
export function AvatarStack({
  userIds,
  members,
  max = 3,
  size = 20,
  ringClassName = "ring-surface-1",
}: {
  userIds: readonly string[];
  members: readonly BoardMember[];
  max?: number;
  size?: number;
  ringClassName?: string;
}) {
  if (!userIds.length) return null;
  const names = userIds.map(
    (id) => members.find((m) => m.userId === id)?.displayName ?? "Former member",
  );
  const shown = userIds.slice(0, userIds.length > max ? max - 1 : max);
  return (
    <span
      role="img"
      aria-label={`Assigned to ${names.join(", ")}`}
      title={names.join(", ")}
      className="flex shrink-0 items-center -space-x-1.5"
    >
      {shown.map((id) => (
        <span key={id} className={cn("flex rounded-full ring-2", ringClassName)}>
          <PersonAvatar userId={id} size={size} />
        </span>
      ))}
      {userIds.length > shown.length && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-surface-3 text-[10px] font-medium text-text-muted ring-2",
            ringClassName,
          )}
          style={{ width: size, height: size }}
        >
          +{userIds.length - shown.length}
        </span>
      )}
    </span>
  );
}

/** Closes on an outside press or Escape, keeping Escape from closing a parent dialog. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    }
  };
  return { open, setOpen, rootRef, onKeyDown };
}

export const popoverPanel =
  "absolute top-[calc(100%+4px)] z-40 w-max min-w-[220px] max-w-[min(320px,calc(100vw-32px))] animate-pop-in rounded-[10px] border border-border bg-surface-2 p-1 shadow-2xl shadow-black/25";
export const menuRow =
  "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-text transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

export interface ChecklistOption {
  id: string;
  label: string;
  leading?: ReactNode;
}

/** A button that opens a checklist: every option stays visible and several can be ticked. */
export function ChecklistMenu({
  label,
  trigger,
  triggerClassName,
  options,
  selected,
  onChange,
  align = "left",
  searchPlaceholder,
  emptyText = "Nothing to choose from",
}: {
  /** Accessible name of the trigger and the list. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string | ((open: boolean) => string);
  options: readonly ChecklistOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  align?: "left" | "right";
  /** Shows a filter field; meant for long lists such as people. */
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const { open, setOpen, rootRef, onKeyDown } = usePopover();
  const [query, setQuery] = useState("");
  const searchable = searchPlaceholder !== undefined && options.length > 6;
  const visible = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the popover from any child
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
        className={typeof triggerClassName === "string" ? triggerClassName : triggerClassName(open)}
      >
        {trigger}
      </button>
      {open && (
        <fieldset
          aria-label={label}
          className={cn(popoverPanel, align === "left" ? "left-0" : "right-0")}
        >
          {searchable && (
            <input
              // biome-ignore lint/a11y/noAutofocus: typing filters the list straight away
              autoFocus
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="mb-1 h-8 w-full rounded-[7px] border border-border bg-surface-3 px-2.5 text-[13px] text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:outline-none"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {visible.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <label
                  key={option.id}
                  className={cn(menuRow, "cursor-pointer focus-within:bg-surface-3")}
                >
                  <input
                    type="checkbox"
                    aria-label={option.label}
                    className="peer sr-only"
                    checked={checked}
                    onChange={() => {
                      onChange(
                        checked
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id],
                      );
                    }}
                  />
                  <CheckMark />
                  {option.leading}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </label>
              );
            })}
            {!visible.length && (
              <p className="px-2 py-3 text-center text-xs text-text-muted">
                {options.length ? "No matches" : emptyText}
              </p>
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className={cn(menuRow, "mt-1 justify-center border-t border-border text-text-muted")}
              onClick={() => {
                onChange([]);
              }}
            >
              Clear selection
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** The visual box for a visually hidden `peer` checkbox placed just before it. */
export function CheckMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-text-muted/50 text-transparent transition duration-150 [&>svg]:scale-50 [&>svg]:transition-transform [&>svg]:duration-150 peer-checked:[&>svg]:scale-100",
        "peer-checked:border-accent peer-checked:bg-accent peer-checked:text-on-accent",
        "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-surface-2",
        "peer-disabled:opacity-60",
        className,
      )}
    >
      <Icon name="check" size={12} />
    </span>
  );
}

export function filterChip(active: boolean) {
  return (open: boolean) =>
    cn(
      "flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      active
        ? "border-accent/50 bg-accent-soft text-text"
        : "border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text",
      open && "border-accent",
    );
}

/** Trigger content for a toolbar filter: icon, name, and how many options are ticked. */
export function FilterTrigger({
  icon,
  label,
  count,
}: {
  icon: IconProps["name"];
  label: string;
  count: number;
}) {
  return (
    <>
      <Icon name={icon} size={14} />
      {label}
      {count > 0 && (
        <span className="flex h-4 min-w-4 animate-scale-in items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent">
          {count}
        </span>
      )}
      <Icon name="chevron-down" size={12} className="text-text-muted" />
    </>
  );
}

export function personOptions(
  members: readonly BoardMember[],
  /** Selected ids without a listed member stay removable. */
  selected: readonly string[],
): ChecklistOption[] {
  return [
    ...selected
      .filter((id) => !members.some((m) => m.userId === id))
      .map((id) => ({ id, label: "Former member" })),
    ...members.map((m) => ({ id: m.userId, label: m.displayName })),
  ].map((o) => ({ ...o, leading: <PersonAvatar userId={o.id} size={20} /> }));
}

/** The people on a card or board as removable rows, plus a searchable checklist to add more. */
export function PeoplePicker({
  label,
  addLabel,
  members,
  selected,
  onChange,
  editable,
  emptyText,
}: {
  label: string;
  addLabel: string;
  members: readonly BoardMember[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  editable: boolean;
  emptyText: string;
}) {
  const options = personOptions(members, selected);
  return (
    <div className="flex flex-col gap-1">
      {/* Five people fit; a longer list scrolls in place, fading out where it continues. */}
      {!!selected.length && (
        <div
          data-people-list
          className={cn(
            "flex max-h-[176px] flex-col gap-1 overflow-y-auto overscroll-contain",
            selected.length > 5 &&
              "-mr-2 pb-4 pr-1 [mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)]",
          )}
        >
          {selected.map((id) => {
            const name = options.find((o) => o.id === id)?.label ?? "Former member";
            return (
              <div
                key={id}
                className="group flex h-7 shrink-0 animate-fade-in items-center gap-2 text-[13px]"
              >
                <PersonAvatar userId={id} size={20} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      onChange(selected.filter((s) => s !== id));
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-muted opacity-0 transition hover:bg-surface-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!selected.length && !editable && <p className="text-[13px] text-text-muted">{emptyText}</p>}
      {editable && (
        <ChecklistMenu
          label={label}
          options={options}
          selected={selected}
          onChange={onChange}
          searchPlaceholder="Find a person"
          triggerClassName={addButton}
          trigger={
            <>
              <Icon name="plus" size={14} />
              {selected.length ? "Edit" : addLabel}
            </>
          }
        />
      )}
    </div>
  );
}

export const addButton =
  "-ml-1.5 flex h-7 items-center gap-1.5 rounded-[7px] px-1.5 text-[13px] text-text-muted transition hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
