import { Permission } from "@aulora/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptsView } from "../components/transcripts/TranscriptsView";

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

const session = {
  id: "s1",
  callId: "c1",
  channelId: "ch1",
  startedBy: "u1",
  startedAt: Date.now() - 3_600_000,
  endedAt: Date.now() - 1_800_000,
  status: "ended",
  summaryStatus: "ready",
  segmentCount: 2,
  retentionExpiresAt: null,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...session,
    summary: JSON.stringify({ overview: "<b>We shipped</b>", keyPoints: ["One"] }),
    summaryModel: "m",
    summaryAt: Date.now(),
    summaryError: null,
    ...overrides,
  };
}

function view(permissions: bigint) {
  return render(
    <TranscriptsView
      permissions={permissions}
      titles={new Map([["ch1", "Lounge"]])}
      onBack={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.values.clear();
  state.mutations.clear();
  state.values.set("transcription:listSessions", [session]);
  state.values.set("transcription:getSession", detail());
  state.values.set("transcription:listSegments", {
    page: [
      {
        id: "a",
        seq: 1,
        speakerKey: "user:u1",
        speakerName: "Ada",
        text: "Hello",
        startMs: 1000,
        endMs: 2000,
        confidence: null,
        language: null,
      },
      {
        id: "b",
        seq: 1,
        speakerKey: "guest:g",
        speakerName: "Alex",
        text: "Hi there",
        startMs: 4000,
        endMs: 5000,
        confidence: null,
        language: null,
      },
    ],
    nextCursor: null,
  });
});

describe("TranscriptsView", () => {
  it("shows an empty state when there are no transcripts", () => {
    state.values.set("transcription:listSessions", []);
    view(Permission.ViewTranscripts);
    expect(screen.getByText("No transcripts yet")).toBeInTheDocument();
  });

  it("opens a transcript with a speaker-labelled body and a text-only summary", async () => {
    const user = userEvent.setup();
    const { container } = view(Permission.ViewTranscripts);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    expect(await screen.findByTestId("transcript-body")).toHaveTextContent("Ada");
    expect(screen.getByTestId("transcript-body")).toHaveTextContent("Alex");
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-summary")).toHaveTextContent("<b>We shipped</b>");
    expect(container.querySelector("b")).toBeNull();
  });

  it("regenerates the summary on request", async () => {
    const user = userEvent.setup();
    view(Permission.ViewTranscripts);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    await user.click(await screen.findByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:requestSummary")).toHaveBeenCalledWith({
        sessionId: "s1",
      });
    });
  });

  it("offers delete only with Manage transcription, after a confirmation", async () => {
    const user = userEvent.setup();
    const { unmount } = view(Permission.ViewTranscripts);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    await screen.findByTestId("transcript-body");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    unmount();
    view(Permission.ViewTranscripts | Permission.ManageTranscription);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(state.mutations.get("transcription:deleteSession")).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete transcript" }));
    await waitFor(() => {
      expect(state.mutations.get("transcription:deleteSession")).toHaveBeenCalledWith({
        sessionId: "s1",
      });
    });
  });

  it("shows a pending summary and a failed one with the way out", async () => {
    const user = userEvent.setup();
    state.values.set(
      "transcription:getSession",
      detail({ summary: null, summaryStatus: "pending" }),
    );
    const { unmount } = view(Permission.ViewTranscripts);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    expect(await screen.findByText("Writing the summary…")).toBeInTheDocument();
    unmount();
    state.values.set(
      "transcription:getSession",
      detail({
        summary: null,
        summaryStatus: "error",
        summaryError: "Configure a summary endpoint first",
      }),
    );
    view(Permission.ViewTranscripts);
    await user.click(screen.getByRole("button", { name: /Lounge/u }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configure a summary endpoint first",
    );
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  describe("summary states", () => {
    async function open(
      overrides: Record<string, unknown>,
      permissions: bigint = Permission.ViewTranscripts,
    ) {
      const user = userEvent.setup();
      state.values.set("transcription:getSession", detail({ summary: null, ...overrides }));
      view(permissions);
      await user.click(screen.getByRole("button", { name: /Lounge/u }));
      await screen.findByTestId("transcript-body");
      return user;
    }

    it("is neutral, never red, when no summary service is configured", async () => {
      await open({ summaryStatus: "none", summaryConfigured: false });
      expect(screen.getByText(/No summary service configured/u)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Generate summary" })).toBeNull();
      // A viewer who cannot change settings is not sent there.
      expect(screen.queryByText(/Workspace settings/u)).toBeNull();
    });

    it("points an owner at Workspace settings", async () => {
      await open(
        { summaryStatus: "none", summaryConfigured: false },
        Permission.ViewTranscripts | Permission.ManageTranscription,
      );
      expect(screen.getByText(/Workspace settings > Addons > Transcription/u)).toBeInTheDocument();
    });

    it("offers Generate when configured and nothing was written yet", async () => {
      const user = await open({ summaryStatus: "none", summaryConfigured: true });
      expect(screen.getByText("Summary not generated yet.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Generate summary" }));
      await waitFor(() => {
        expect(state.mutations.get("transcription:requestSummary")).toHaveBeenCalledWith({
          sessionId: "s1",
        });
      });
    });

    it("says it is taking longer than expected after about ten minutes, with Regenerate", async () => {
      await open({ summaryStatus: "pending", summaryRequestedAt: Date.now() - 11 * 60_000 });
      expect(screen.getByText(/Taking longer than expected/u)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    });

    it("shows a fresh pending summary with no button", async () => {
      await open({ summaryStatus: "pending", summaryRequestedAt: Date.now() - 5_000 });
      expect(screen.getByText("Writing the summary…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
    });
  });
});
