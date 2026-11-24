import { Permission } from "@aulora/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTranscriptToggle } from "../components/voice/LiveTranscriptPanel";
import { LiveTranscriptPanel } from "../components/voice/LiveTranscriptSheet";
import { resetLiveTranscriptOpenForTests } from "../lib/transcription/live-panel-state";
import {
  consumeTranscriptRequest,
  getTranscriptNavigationSnapshot,
} from "../lib/transcription/transcript-navigation";

const state = vi.hoisted(() => ({
  value: undefined as unknown,
  args: [] as unknown[],
  voice: {} as Record<string, unknown>,
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    state.args.push([getFunctionName(reference), args]);
    return args === "skip" ? undefined : state.value;
  },
}));
vi.mock("../providers/VoiceProvider", () => ({ useVoice: () => state.voice }));

function segment(id: string, speaker: string, text: string, startMs: number) {
  return {
    id,
    seq: 1,
    speakerKey: `user:${speaker}`,
    speakerName: speaker,
    text,
    startMs,
    endMs: startMs + 1000,
    edited: false,
  };
}

beforeEach(() => {
  state.args = [];
  state.value = { status: "active", segments: [] };
  state.voice = {
    call: { transcribing: true, transcriptionSessionId: "s1" },
    permissions: Permission.ViewTranscripts,
    addons: { transcription: true },
  };
  localStorage.clear();
  resetLiveTranscriptOpenForTests();
});

afterEach(() => {
  consumeTranscriptRequest();
});

describe("LiveTranscriptPanel", () => {
  it("skips the subscription while closed", () => {
    const { container } = render(
      <LiveTranscriptPanel sessionId="s1" open={false} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(state.args.at(-1)).toEqual(["transcription:liveSegments", "skip"]);
  });

  it("subscribes with the session while open and shows the empty state", () => {
    render(<LiveTranscriptPanel sessionId="s1" open onClose={vi.fn()} />);
    expect(state.args.at(-1)).toEqual([
      "transcription:liveSegments",
      { sessionId: "s1", limit: 50 },
    ]);
    expect(screen.getByText(/Listening… lines appear here/u)).toBeInTheDocument();
  });

  it("groups lines by speaker, announces only the newest and opens the full transcript", async () => {
    const user = userEvent.setup();
    state.value = {
      status: "active",
      segments: [
        segment("a", "Ada", "Hello <b>there</b>", 1000),
        segment("b", "Ada", "Second line", 3000),
        segment("c", "Sam", "Hi Ada", 6000),
      ],
    };
    const { container } = render(<LiveTranscriptPanel sessionId="s1" open onClose={vi.fn()} />);
    expect(screen.getByText("Hello <b>there</b> Second line")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("[aria-live=polite]")).toHaveTextContent("Sam: Hi Ada");
    await user.click(screen.getByRole("button", { name: "Open full transcript" }));
    expect(getTranscriptNavigationSnapshot()).toBe("s1");
  });
});

describe("LiveTranscriptToggle", () => {
  it("toggles aria-pressed and remembers the choice", async () => {
    const user = userEvent.setup();
    render(<LiveTranscriptToggle />);
    const button = screen.getByRole("button", { name: "Live transcript" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("aulora:live-transcript-open")).toBe("true");
  });

  it("is hidden when not transcribing or without permission", () => {
    state.voice = { ...state.voice, call: { transcribing: false } };
    const { container, rerender } = render(<LiveTranscriptToggle />);
    expect(container).toBeEmptyDOMElement();
    state.voice = {
      call: { transcribing: true, transcriptionSessionId: "s1" },
      permissions: 0n,
      addons: { transcription: true },
    };
    rerender(<LiveTranscriptToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});
