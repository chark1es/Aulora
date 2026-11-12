import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptBody } from "../components/transcripts/TranscriptBody";

const state = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  /** Server pages by cursor; `""` is the first page. */
  pages: new Map<string, unknown>(),
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    if (getFunctionName(reference) !== "transcription:listSegments") {
      return undefined;
    }
    state.calls.push(args);
    return state.pages.get(typeof args.cursor === "string" ? args.cursor : "");
  },
}));

const segment = (
  seq: number,
  speakerKey: string,
  speakerName: string,
  text: string,
  startMs: number,
) => ({
  // Document ids are unique per segment; `seq` is not (it resets with the transcriber).
  id: `doc-${speakerKey}-${startMs}`,
  seq,
  speakerKey,
  speakerName,
  text,
  startMs,
  endMs: startMs + 500,
  confidence: null,
  language: null,
});

beforeEach(() => {
  state.calls.length = 0;
  state.pages.clear();
});

describe("TranscriptBody pagination (cursor contract)", () => {
  it("reads { page, nextCursor }, follows the opaque cursor, and never sends afterSeq", async () => {
    state.pages.set("", {
      page: [segment(1, "user:a", "Ada", "First line", 1_000)],
      nextCursor: "opaque-cursor-1",
    });
    state.pages.set("opaque-cursor-1", {
      page: [segment(2, "user:a", "Ada", "Much later", 60_000)],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<TranscriptBody sessionId="s1" />);
    expect(screen.getByText("First line")).toBeInTheDocument();
    // Only the arguments the server declares: it fixes the page size itself.
    expect(state.calls[0]).toEqual({ sessionId: "s1" });

    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(screen.getByText("Much later")).toBeInTheDocument();
    expect(state.calls.some((args) => args.cursor === "opaque-cursor-1")).toBe(true);
    expect(state.calls.every((args) => !("afterSeq" in args))).toBe(true);
    // No more pages: the button is gone.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps keys unique when one speaker's seq restarts after a transcriber restart", () => {
    state.pages.set("", {
      page: [
        segment(1, "user:a", "Ada", "Before the restart", 1_000),
        segment(1, "user:a", "Ada", "After the restart", 120_000),
      ],
      nextCursor: null,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<TranscriptBody sessionId="s1" />);
    const warned = errors.mock.calls.some((call) => String(call[0]).includes("same key"));
    errors.mockRestore();
    expect(warned).toBe(false);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Before the restart")).toBeInTheDocument();
    expect(screen.getByText("After the restart")).toBeInTheDocument();
  });

  it("shows speakers whose per-speaker seq collide, in delivered order, without key warnings", () => {
    // `seq` is per speaker: both speakers have seq 1 and 2.
    state.pages.set("", {
      page: [
        segment(1, "user:a", "Ada", "Hello from Ada", 1_000),
        segment(1, "guest:g", "Alex", "Hello from Alex", 3_000),
        segment(2, "user:a", "Ada", "Ada again", 20_000),
        segment(2, "guest:g", "Alex", "Alex again", 30_000),
      ],
      nextCursor: null,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<TranscriptBody sessionId="s1" />);
    const warned = errors.mock.calls.some((call) => String(call[0]).includes("same key"));
    errors.mockRestore();
    expect(warned).toBe(false);
    const text = screen.getByTestId("transcript-body").textContent ?? "";
    // Ordered by startMs as delivered, not re-sorted by seq.
    const order = ["Hello from Ada", "Hello from Alex", "Ada again", "Alex again"].map((line) =>
      text.indexOf(line),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
