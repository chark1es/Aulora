import type { HubTab } from "../components/chat/HubPane";

/** The addons the mobile hub can offer. Each maps to one hub tab. */
export type MobileAddonKey = "boards" | "notes";

export interface MobileAddonEntry {
  readonly key: MobileAddonKey;
  readonly icon: "kanban" | "note";
  readonly title: string;
  readonly subtitle: string;
}

/**
 * The rows the chooser shows for the addons this workspace enables.
 *
 * Keeping the availability decision here means the chooser and the dock agree:
 * a disabled addon has no row, and the dock only offers the chooser when at
 * least one row exists.
 */
export function addonChooserEntries(available: {
  readonly kanban: boolean;
  readonly notes: boolean;
}): readonly MobileAddonEntry[] {
  return [
    ...(available.kanban
      ? [
          {
            key: "boards" as const,
            icon: "kanban" as const,
            title: "Kanban",
            subtitle: "Boards, cards, checklists and comments",
          },
        ]
      : []),
    ...(available.notes
      ? [
          {
            key: "notes" as const,
            icon: "note" as const,
            title: "Notes",
            subtitle: "Shared notes, folders and history",
          },
        ]
      : []),
  ];
}

/** Whether the dock should offer the shared Addons entry at all. */
export function showAddonsDockTab(entries: readonly MobileAddonEntry[]): boolean {
  return entries.length > 0;
}

/** Hub tabs reached through the Addons entry; the dock keeps that entry lit. */
export function isAddonHubTab(tab: HubTab): boolean {
  return tab === "addons" || tab === "boards" || tab === "notes";
}

/**
 * Android back from an addon returns to the chooser it was opened from.
 *
 * Returns `null` when the tab is not an enabled addon view, so the caller can
 * fall back to its usual hub navigation. A disabled addon whose tab still
 * points at it (for example after permission was revoked) is not treated as
 * an addon, because the chooser can no longer be shown.
 */
export function addonBackTarget(tab: HubTab, addonsEnabled: boolean): HubTab | null {
  if (!addonsEnabled) return null;
  return tab === "boards" || tab === "notes" ? "addons" : null;
}
