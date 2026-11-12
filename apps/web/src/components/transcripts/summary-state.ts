/** How long a summary may stay `pending` before the UI offers to start over. */
export const SUMMARY_STALLED_MS = 10 * 60_000;

export type SummaryPanelKind =
  /** The call is still being transcribed: nothing to write yet. */
  | "waiting-for-end"
  /** No summary service (API key) is set up. Neutral: nothing failed. */
  | "not-configured"
  /** A service is configured and no summary has been asked for yet. */
  | "not-generated"
  | "pending"
  | "ready"
  | "error";

export interface SummaryPanel {
  readonly kind: SummaryPanelKind;
  /** The button offered, if any. */
  readonly action: "generate" | "regenerate" | null;
  /** `pending` for longer than expected: say so and offer to start over. */
  readonly stalled: boolean;
  /** Point the viewer at the settings page: only someone who can change it. */
  readonly showSettingsHint: boolean;
}

/**
 * What the Summary section of a transcript shows. The server keeps a session's
 * summary `none` while no summary service is configured (never `error`), and
 * reports whether one is configured as `summaryConfigured`; an older server that
 * does not send it is treated as configured, so nothing claims it is missing.
 */
export function summaryPanel(input: {
  /** `ending`: stopped, still collecting the last audio; the summary starts after it closes. */
  readonly sessionStatus: "active" | "ending" | "ended" | "failed";
  readonly summaryStatus: "none" | "pending" | "ready" | "error";
  readonly hasSummary: boolean;
  readonly configured: boolean | undefined;
  readonly canManage: boolean;
  /** How long the summary has been pending, when it is. */
  readonly pendingForMs: number | null;
}): SummaryPanel {
  const configured = input.configured !== false;
  const done = (kind: SummaryPanelKind, action: SummaryPanel["action"]): SummaryPanel => ({
    kind,
    action,
    stalled: false,
    showSettingsHint: kind === "not-configured" && input.canManage,
  });
  if (input.summaryStatus === "pending") {
    const stalled = input.pendingForMs !== null && input.pendingForMs >= SUMMARY_STALLED_MS;
    return {
      kind: "pending",
      action: stalled ? "regenerate" : null,
      stalled,
      showSettingsHint: false,
    };
  }
  const ended = input.sessionStatus !== "active" && input.sessionStatus !== "ending";
  if (input.hasSummary) {
    return done("ready", ended && configured ? "regenerate" : null);
  }
  if (input.summaryStatus === "error") {
    return done("error", ended ? "regenerate" : null);
  }
  if (!ended) {
    return done("waiting-for-end", null);
  }
  if (!configured) {
    return done("not-configured", null);
  }
  return done("not-generated", "generate");
}
