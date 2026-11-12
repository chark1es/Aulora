import { describe, expect, it } from "vitest";
import { SUMMARY_STALLED_MS, summaryPanel } from "./summary-state";

const base = {
  sessionStatus: "ended" as const,
  summaryStatus: "none" as const,
  hasSummary: false,
  configured: true as boolean | undefined,
  canManage: false,
  pendingForMs: null as number | null,
};

describe("summaryPanel", () => {
  it("says no service is configured, neutrally, with no button", () => {
    const panel = summaryPanel({ ...base, configured: false });
    expect(panel).toMatchObject({ kind: "not-configured", action: null, showSettingsHint: false });
  });

  it("points an owner at the settings, and only an owner", () => {
    expect(summaryPanel({ ...base, configured: false, canManage: true }).showSettingsHint).toBe(
      true,
    );
    expect(summaryPanel({ ...base, canManage: true }).showSettingsHint).toBe(false);
  });

  it("offers Generate when a service is configured and nothing was asked yet", () => {
    expect(summaryPanel(base)).toMatchObject({ kind: "not-generated", action: "generate" });
  });

  it("treats a server that does not report the flag as configured", () => {
    expect(summaryPanel({ ...base, configured: undefined }).kind).toBe("not-generated");
  });

  it("waits for the call to end before any summary", () => {
    expect(summaryPanel({ ...base, sessionStatus: "active" })).toMatchObject({
      kind: "waiting-for-end",
      action: null,
    });
    expect(summaryPanel({ ...base, sessionStatus: "active", configured: false }).kind).toBe(
      "waiting-for-end",
    );
  });

  it("treats a session that is finishing like a live one: no summary or button yet", () => {
    expect(summaryPanel({ ...base, sessionStatus: "ending" })).toMatchObject({
      kind: "waiting-for-end",
      action: null,
    });
    expect(
      summaryPanel({ ...base, sessionStatus: "ending", summaryStatus: "ready", hasSummary: true }),
    ).toMatchObject({ kind: "ready", action: null });
  });

  it("shows pending without a button, then offers Regenerate after about ten minutes", () => {
    const pending = { ...base, summaryStatus: "pending" as const };
    expect(summaryPanel({ ...pending, pendingForMs: 1_000 })).toMatchObject({
      kind: "pending",
      stalled: false,
      action: null,
    });
    expect(summaryPanel({ ...pending, pendingForMs: SUMMARY_STALLED_MS - 1 }).stalled).toBe(false);
    expect(summaryPanel({ ...pending, pendingForMs: SUMMARY_STALLED_MS })).toMatchObject({
      kind: "pending",
      stalled: true,
      action: "regenerate",
    });
    // Not knowing when it started never claims it is stuck.
    expect(summaryPanel({ ...pending, pendingForMs: null }).stalled).toBe(false);
  });

  it("shows an error with Regenerate, and a ready summary with Regenerate", () => {
    expect(summaryPanel({ ...base, summaryStatus: "error" })).toMatchObject({
      kind: "error",
      action: "regenerate",
    });
    expect(summaryPanel({ ...base, summaryStatus: "ready", hasSummary: true })).toMatchObject({
      kind: "ready",
      action: "regenerate",
    });
  });

  it("keeps a written summary readable after the key was removed, without offering to redo it", () => {
    expect(
      summaryPanel({ ...base, summaryStatus: "ready", hasSummary: true, configured: false }),
    ).toMatchObject({ kind: "ready", action: null });
  });
});
