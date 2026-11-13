import { describe, expect, it } from "vitest";
import {
  addonBackTarget,
  addonChooserEntries,
  isAddonHubTab,
  showAddonsDockTab,
} from "../src/lib/addons";

describe("addon chooser", () => {
  it("lists every enabled addon and nothing else", () => {
    expect(addonChooserEntries({ kanban: true, notes: true }).map((entry) => entry.key)).toEqual([
      "boards",
      "notes",
    ]);
    expect(addonChooserEntries({ kanban: true, notes: false }).map((entry) => entry.key)).toEqual([
      "boards",
    ]);
    expect(addonChooserEntries({ kanban: false, notes: true }).map((entry) => entry.key)).toEqual([
      "notes",
    ]);
    expect(addonChooserEntries({ kanban: false, notes: false })).toEqual([]);
  });

  it("offers each row a concrete hub tab to open", () => {
    for (const entry of addonChooserEntries({ kanban: true, notes: true })) {
      expect(["boards", "notes"]).toContain(entry.key);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});

describe("addon dock entry", () => {
  it("only appears when at least one addon is available", () => {
    expect(showAddonsDockTab(addonChooserEntries({ kanban: false, notes: false }))).toBe(false);
    expect(showAddonsDockTab(addonChooserEntries({ kanban: true, notes: false }))).toBe(true);
    expect(showAddonsDockTab(addonChooserEntries({ kanban: false, notes: true }))).toBe(true);
  });

  it("stays highlighted while any addon view is open", () => {
    expect(isAddonHubTab("addons")).toBe(true);
    expect(isAddonHubTab("boards")).toBe(true);
    expect(isAddonHubTab("notes")).toBe(true);
    expect(isAddonHubTab("chats")).toBe(false);
    expect(isAddonHubTab("dms")).toBe(false);
    expect(isAddonHubTab("search")).toBe(false);
    expect(isAddonHubTab("you")).toBe(false);
  });

  it("keeps the chooser reachable without Android back (iOS)", () => {
    // iOS never delivers hardwareBackPress. The same dock entry must remain
    // visible and selecting a row must still open its hub tab, so the chooser
    // is not an Android-only path.
    const entries = addonChooserEntries({ kanban: true, notes: true });
    expect(showAddonsDockTab(entries)).toBe(true);
    for (const entry of entries) {
      expect(isAddonHubTab(entry.key)).toBe(true);
    }
  });
});

describe("Android back from an addon", () => {
  it("returns Boards and Notes to the addon chooser", () => {
    expect(addonBackTarget("boards", true)).toBe("addons");
    expect(addonBackTarget("notes", true)).toBe("addons");
  });

  it("leaves the chooser through the normal hub navigation", () => {
    expect(addonBackTarget("addons", true)).toBeNull();
  });

  it("does not send a stale addon tab to a chooser that is no longer shown", () => {
    expect(addonBackTarget("boards", false)).toBeNull();
    expect(addonBackTarget("notes", false)).toBeNull();
  });
});
