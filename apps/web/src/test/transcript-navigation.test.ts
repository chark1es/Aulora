import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanSummaryEdit,
  type SummaryEdit,
  validateSummaryEdit,
} from "../components/transcripts/summary-edit";
import {
  consumeTranscriptRequest,
  getTranscriptNavigationSnapshot,
  requestOpenTranscript,
  subscribeTranscriptNavigation,
} from "../lib/transcription/transcript-navigation";
import { nextTranscriptionEnd } from "../lib/transcription/transcription-end";

afterEach(() => {
  consumeTranscriptRequest();
});

describe("transcript navigation store", () => {
  it("parks a request, notifies subscribers and clears on consume", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTranscriptNavigation(listener);
    requestOpenTranscript("s1");
    expect(getTranscriptNavigationSnapshot()).toBe("s1");
    expect(listener).toHaveBeenCalledTimes(1);
    consumeTranscriptRequest("other");
    expect(getTranscriptNavigationSnapshot()).toBe("s1");
    consumeTranscriptRequest("s1");
    expect(getTranscriptNavigationSnapshot()).toBeNull();
    unsubscribe();
    requestOpenTranscript("s2");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("nextTranscriptionEnd", () => {
  it("tracks a running session without reporting an end", () => {
    expect(nextTranscriptionEnd(null, { transcribing: true, sessionId: "s1" })).toEqual({
      tracked: "s1",
      ended: null,
    });
  });

  it("reports the end when transcription stops", () => {
    expect(nextTranscriptionEnd("s1", { transcribing: false, sessionId: null })).toEqual({
      tracked: null,
      ended: "s1",
    });
  });

  it("reports the end when this device leaves the call while transcribing", () => {
    expect(nextTranscriptionEnd("s1", null)).toEqual({ tracked: null, ended: "s1" });
  });

  it("reports the old session when a new one replaces it", () => {
    expect(nextTranscriptionEnd("s1", { transcribing: true, sessionId: "s2" })).toEqual({
      tracked: "s2",
      ended: "s1",
    });
  });

  it("does nothing while idle or while the id has not arrived", () => {
    expect(nextTranscriptionEnd(null, null)).toEqual({ tracked: null, ended: null });
    expect(nextTranscriptionEnd("s1", { transcribing: true, sessionId: null })).toEqual({
      tracked: "s1",
      ended: null,
    });
  });
});

describe("summary edit validation", () => {
  const base: SummaryEdit = {
    overview: "ok",
    keyPoints: [],
    decisions: [],
    actionItems: [],
    speakerHighlights: [],
  };

  it("accepts a normal draft and drops blank rows", () => {
    const draft = { ...base, keyPoints: ["a", "  "], actionItems: [{ text: "x", owner: " " }] };
    expect(validateSummaryEdit(draft)).toBeNull();
    expect(cleanSummaryEdit(draft)).toMatchObject({
      keyPoints: ["a"],
      actionItems: [{ text: "x", owner: null }],
    });
  });

  it("flags too many items, long items, long names and long overviews", () => {
    expect(validateSummaryEdit({ ...base, decisions: Array(31).fill("d") })).toMatch(/at most 30/u);
    expect(validateSummaryEdit({ ...base, keyPoints: ["x".repeat(601)] })).toMatch(/600/u);
    expect(
      validateSummaryEdit({ ...base, actionItems: [{ text: "t", owner: "o".repeat(81) }] }),
    ).toMatch(/80/u);
    expect(validateSummaryEdit({ ...base, overview: "x".repeat(2401) })).toMatch(/2400/u);
  });
});
