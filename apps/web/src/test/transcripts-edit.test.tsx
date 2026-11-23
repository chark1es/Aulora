import { Permission } from "@aulora/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptsView } from "../components/transcripts/TranscriptsView";
import {
  consumeTranscriptRequest,
  requestOpenTranscript,
} from "../lib/transcription/transcript-navigation";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.values.get(getFunctionName(reference)),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (!state.mutations.has(name)) {
      state.mutations.set(name, vi.fn().mockResolvedValue(null));
    }
    return state.mutations.get(name);
  },
}));

const row = {
  id: "s1",
  callId: "c1",
  channelId: "ch1",
  startedBy: "u1",
  startedAt: Date.now() - 3_600_000,
  endedAt: Date.now() - 1_800_000,
  status: "ended",
  summaryStatus: "ready",
  segmentCount: 3,
  retentionExpiresAt: null,
  title: "Launch plan",
};

function mutation(name: string) {
  if (!state.mutations.has(name)) {
    state.mutations.set(name, vi.fn().mockResolvedValue(null));
  }
  return state.mutations.get(name) as ReturnType<typeof vi.fn>;
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...row,
    summary: JSON.stringify({
      title: "Launch plan",
      overview: "We shipped",
      keyPoints: ["One"],
      decisions: [],
      actionItems: [{ text: "Write docs", owner: "Sam" }],
      speakerHighlights: [],
    }),
    summaryModel: "m",
    summaryAt: Date.now(),
    summaryError: null,
    titleSource: "summary",
    summaryEditedAt: null,
    canEdit: true,
    ...overrides,
  };
}

function segment(id: string, text: string, startMs: number, edited = false) {
  return {
    id,
    seq: 1,
    speakerKey: "user:u1",
    speakerName: "Ada",
    text,
    startMs,
    endMs: startMs + 1000,
    confidence: null,
    language: null,
    edited,
  };
}

async function open() {
  const user = userEvent.setup();
  render(
    <TranscriptsView
      permissions={Permission.ViewTranscripts}
      titles={new Map([["ch1", "Lounge"]])}
      onBack={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Launch plan/u }));
  await screen.findByTestId("transcript-body");
  return user;
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("transcription:listSessions", [row]);
  state.values.set("transcription:getSession", detail());
  state.values.set("transcription:listSegments", {
    page: [segment("a", "Helo wrld", 1000), segment("b", "Second line", 3000, true)],
    nextCursor: null,
  });
});

afterEach(() => {
  consumeTranscriptRequest();
});

describe("session title", () => {
  it("shows the title with the channel as a secondary line, in the list and the header", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: "Launch plan" })).toBeInTheDocument();
    expect(screen.getAllByText("Lounge").length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the channel name when there is no title", async () => {
    state.values.set("transcription:listSessions", [{ ...row, title: null }]);
    state.values.set("transcription:getSession", detail({ title: null, titleSource: null }));
    const user = userEvent.setup();
    render(
      <TranscriptsView
        permissions={Permission.ViewTranscripts}
        titles={new Map([["ch1", "Lounge"]])}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    expect(await screen.findByRole("heading", { level: 2, name: "Lounge" })).toBeInTheDocument();
  });

  it("renames with Enter, cancels with Escape and resets a user title", async () => {
    state.values.set("transcription:getSession", detail({ titleSource: "user" }));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Rename transcript" }));
    const input = screen.getByLabelText("Transcript title");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Transcript title")).toBeNull();
    expect(mutation("transcription:renameSession")).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Rename transcript" }));
    const again = screen.getByLabelText("Transcript title");
    expect(again).not.toBe(input);
    await user.clear(again);
    await user.type(again, "Roadmap{Enter}");
    await waitFor(() => {
      expect(state.mutations.get("transcription:renameSession")).toHaveBeenCalledWith({
        sessionId: "s1",
        title: "Roadmap",
      });
    });

    await user.click(screen.getByRole("button", { name: "Rename transcript" }));
    await user.click(screen.getByRole("button", { name: "Reset to automatic" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:renameSession")).toHaveBeenLastCalledWith({
        sessionId: "s1",
        title: "",
      });
    });
  });

  it("shows a rename error in the error slot", async () => {
    mutation("transcription:renameSession").mockRejectedValue(new Error("Title is too long"));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Rename transcript" }));
    await user.type(screen.getByLabelText("Transcript title"), "x{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Title is too long");
  });

  it("hides rename, edit and correction controls without canEdit", async () => {
    state.values.set("transcription:getSession", detail({ canEdit: false }));
    await open();
    expect(screen.queryByRole("button", { name: "Rename transcript" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit Ada/u })).toBeNull();
  });
});

describe("summary editing", () => {
  it("saves edits through updateSummary and Cancel discards", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByTestId("summary-editor");
    await user.clear(within(editor).getByLabelText("Overview"));
    await user.type(within(editor).getByLabelText("Overview"), "New overview");
    await user.click(within(editor).getByRole("button", { name: "Add key point" }));
    await user.type(within(editor).getByLabelText("Key point 2"), "Two");
    await user.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:updateSummary")).toHaveBeenCalledWith({
        sessionId: "s1",
        summary: {
          overview: "New overview",
          keyPoints: ["One", "Two"],
          decisions: [],
          actionItems: [{ text: "Write docs", owner: "Sam" }],
          speakerHighlights: [],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("summary-editor")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Overview"), " more");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("summary-editor")).toBeNull();
    expect(state.mutations.get("transcription:updateSummary")).toHaveBeenCalledTimes(1);
  });

  it("disables Save with a message when a limit is exceeded", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByTestId("summary-editor");
    await user.click(within(editor).getByLabelText("Key point 1"));
    await user.paste("x".repeat(600));
    expect(within(editor).getByRole("alert")).toHaveTextContent("at most 600 characters");
    expect(within(editor).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows Edited in the footer", async () => {
    state.values.set("transcription:getSession", detail({ summaryEditedAt: Date.now() }));
    await open();
    expect(screen.getByText(/Written by m on .* · Edited /u)).toBeInTheDocument();
  });

  it("confirms before regenerating an edited summary", async () => {
    state.values.set("transcription:getSession", detail({ summaryEditedAt: Date.now() }));
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mutation("transcription:requestSummary")).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("replaces the edits");
    await user.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:requestSummary")).toHaveBeenCalledWith({
        sessionId: "s1",
      });
    });
  });
});

describe("transcript correction", () => {
  it("marks edited turns and saves only changed lines", async () => {
    state.values.set("transcription:listSegments", {
      page: [segment("a", "Helo wrld", 1000), segment("b", "Second line", 3000, true)],
      nextCursor: null,
    });
    const user = await open();
    expect(screen.getByText("edited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Edit Ada/u }));
    const first = screen.getByLabelText("Line 1 of 2");
    await user.clear(first);
    await user.type(first, "Hello world");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:updateSegment")).toHaveBeenCalledTimes(1);
    });
    expect(state.mutations.get("transcription:updateSegment")).toHaveBeenCalledWith({
      segmentId: "a",
      text: "Hello world",
    });
  });

  it("Escape cancels without saving", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /^Edit Ada/u }));
    await user.type(screen.getByLabelText("Line 1 of 2"), "zzz");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Line 1 of 2")).toBeNull();
    expect(mutation("transcription:updateSegment")).not.toHaveBeenCalled();
  });
});

describe("open requests", () => {
  it("selects the requested session when mounted after the request", async () => {
    requestOpenTranscript("s1");
    render(
      <TranscriptsView
        permissions={Permission.ViewTranscripts}
        titles={new Map([["ch1", "Lounge"]])}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("transcript-body")).toBeInTheDocument();
  });

  it("opens a requested session that is older than the listed window", async () => {
    // The list only holds the newest sessions; the requested one is not in it.
    state.values.set("transcription:listSessions", [{ ...row, id: "newer", title: "Newer call" }]);
    state.values.set("transcription:getSession", detail({ id: "old", title: "Old retro" }));
    requestOpenTranscript("old");
    render(
      <TranscriptsView
        permissions={Permission.ViewTranscripts}
        titles={new Map([["ch1", "Lounge"]])}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByTestId("transcript-body")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Old retro" })).toBeInTheDocument();
  });
});
