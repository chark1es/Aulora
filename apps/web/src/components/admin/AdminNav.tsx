import { cn, Icon } from "@aulora/ui-web";
import { type KeyboardEvent, useEffect, useRef } from "react";
import type { Callback } from "./callbacks";
import { ADMIN_GROUPS, type AdminSection, type TabId } from "./sections";

const STEPS = new Map([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);

function focusSibling(container: HTMLElement, current: HTMLElement, step: number): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-admin-nav-item]"));
  const index = items.indexOf(current);
  if (index < 0) {
    return;
  }
  items.at((index + step + items.length) % items.length)?.focus();
}

function handleNavKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const step = STEPS.get(event.key);
  if (step === undefined) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches("[data-admin-nav-item]")) {
    return;
  }
  event.preventDefault();
  focusSibling(event.currentTarget, target, step);
}

interface AdminNavItemProps {
  readonly section: AdminSection;
  readonly active: TabId;
  readonly onSelect: Callback<[tab: TabId]>;
}

function AdminNavItem({ section, active, onSelect }: AdminNavItemProps) {
  const current = section.id === active;
  return (
    <button
      type="button"
      data-admin-nav-item
      data-admin-section={section.id}
      aria-current={current ? "page" : undefined}
      onClick={() => {
        onSelect(section.id);
      }}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] px-2 text-left text-[13px] whitespace-nowrap transition md:w-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        current
          ? "bg-surface-3 font-medium text-text"
          : "text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <Icon
        name={section.icon}
        size={16}
        className={cn("shrink-0", current ? "text-accent" : "text-text-muted")}
      />
      <span className="truncate">{section.label}</span>
    </button>
  );
}

export interface AdminNavProps {
  readonly sections: readonly AdminSection[];
  readonly active: TabId;
  readonly onSelect: Callback<[tab: TabId]>;
}

/**
 * The settings rail: a grouped 220px sidebar on wide panes that becomes one
 * horizontally scrollable row below the md breakpoint. Arrow keys move focus
 * between sections in either direction.
 */
export function AdminNav({ sections, active, onSelect }: AdminNavProps) {
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const item = navRef.current?.querySelector<HTMLElement>(`[data-admin-section="${active}"]`);
    if (item !== undefined && item !== null && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Settings sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-1 p-2 md:w-[220px] md:flex-col md:gap-5 md:overflow-y-auto md:border-r md:border-b-0 md:p-3"
      onKeyDown={handleNavKeyDown}
    >
      {ADMIN_GROUPS.map((group) => {
        const items = sections.filter((section) => section.group === group.id);
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={group.id} className="flex shrink-0 gap-0.5 md:flex-col">
            <span className="hidden px-2 pt-1 pb-1 text-[11px] font-semibold text-text-muted md:block">
              {group.label}
            </span>
            {items.map((section) => (
              <AdminNavItem
                key={section.id}
                section={section}
                active={active}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}
