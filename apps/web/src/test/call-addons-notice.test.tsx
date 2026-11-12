import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SummaryView } from "../components/transcripts/SummaryView";
import { CallControls } from "../components/voice/CallControls";
import { TranscriptionIndicator } from "../components/voice/TranscriptionIndicator";
import { TranscriptionNoticeView } from "../components/voice/TranscriptionNoticeView";
import type { TranscriptionClientState } from "../lib/transcription/client-state";

// jsdom has no canvas; the orb itself is a third-party renderer.
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: () => null,
}));

const live: TranscriptionClientState = {
  sessionId: "s1",
  phase: "live",
  optedOut: false,
  stream: { kind: "streaming", sending: true },
};

describe("TranscriptionNoticeView", () => {
  it("renders nothing when no transcription is running", () => {
    const { container } = render(
      <TranscriptionNoticeView
        state={{ ...live, sessionId: null, phase: "off" }}
        onOptOutChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("tells everyone the call is transcribed and offers an opt-out", async () => {
    const user = userEvent.setup();
    const onOptOutChange = vi.fn();
    render(<TranscriptionNoticeView state={live} onOptOutChange={onOptOutChange} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("This call is being transcribed");
    expect(notice).toHaveTextContent("Your speech is transcribed while your microphone is on");
    // The orb carries the same state to assistive tech.
    expect(screen.getByRole("img", { name: /Transcription is on/u })).toBeInTheDocument();
    const optOut = screen.getByRole("button", { name: "Opt out" });
    expect(optOut).toHaveAttribute("aria-pressed", "false");
    await user.click(optOut);
    expect(onOptOutChange).toHaveBeenCalledWith(true);
  });

  it("offers Resume only when another tab replaced this one", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    const replaced: TranscriptionClientState = {
      ...live,
      stream: { kind: "error", message: "Replaced by another tab.", resumable: true },
    };
    const { rerender } = render(
      <TranscriptionNoticeView state={replaced} onOptOutChange={vi.fn()} onResume={onResume} />,
    );
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    // A fatal error that Resume cannot fix does not offer it.
    rerender(
      <TranscriptionNoticeView
        state={{ ...live, stream: { kind: "error", message: "No model." } }}
        onOptOutChange={vi.fn()}
        onResume={onResume}
      />,
    );
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("says the opt-out took effect and lets the person undo it", async () => {
    const user = userEvent.setup();
    const onOptOutChange = vi.fn();
    render(
      <TranscriptionNoticeView
        state={{ ...live, optedOut: true }}
        onOptOutChange={onOptOutChange}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Your own speech is not sent");
    await user.click(screen.getByRole("button", { name: "Include my audio" }));
    expect(onOptOutChange).toHaveBeenCalledWith(false);
  });

  it("warns before audio starts, and when the connection fails", () => {
    const { rerender } = render(
      <TranscriptionNoticeView state={{ ...live, phase: "notice" }} onOptOutChange={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("in a moment");
    rerender(
      <TranscriptionNoticeView
        state={{ ...live, stream: { kind: "error", message: "No speech model is ready." } }}
        onOptOutChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No speech model is ready.");
  });
});

describe("TranscriptionIndicator", () => {
  it("is a labelled, fixed-size image so nothing shifts when it appears", () => {
    render(<TranscriptionIndicator detail="Your audio is not included" />);
    const indicator = screen.getByTestId("transcription-indicator");
    expect(indicator).toHaveAttribute("role", "img");
    expect(indicator).toHaveAttribute(
      "aria-label",
      "Transcription is on. Your audio is not included",
    );
    expect(indicator).toHaveAttribute("title", "Transcription is on. Your audio is not included");
    expect(indicator).toHaveStyle({ width: "20px", height: "20px" });
  });
});

const noop = () => undefined;

function controls(extra: Partial<Parameters<typeof CallControls>[0]> = {}) {
  return (
    <CallControls
      muted={false}
      deafened={false}
      video={false}
      sharingScreen={false}
      canVideo
      canStream={false}
      onToggleMute={noop}
      onToggleDeafen={noop}
      onToggleCamera={noop}
      onToggleScreen={noop}
      onLeave={noop}
      {...extra}
    />
  );
}

describe("CallControls addon buttons", () => {
  it("offers neither transcription nor guest invite unless given", () => {
    render(controls());
    expect(screen.queryByRole("button", { name: /transcription/iu })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite a guest" })).toBeNull();
  });

  it("starts and stops transcription, reflecting its state", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      controls({ transcription: { active: false, busy: false, onToggle } }),
    );
    await user.click(screen.getByRole("button", { name: "Start transcription" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(controls({ transcription: { active: true, busy: false, onToggle } }));
    const stop = screen.getByRole("button", { name: "Stop transcription" });
    expect(stop).toHaveAttribute("aria-pressed", "true");
    // The live orb replaces the icon on the active control.
    expect(stop.querySelector('[data-testid="transcription-indicator"]')).not.toBeNull();
    rerender(controls({ transcription: { active: true, busy: true, onToggle } }));
    expect(screen.getByRole("button", { name: "Stop transcription" })).toBeDisabled();
  });

  it("opens the guest invite and can drop deafen for a guest", async () => {
    const user = userEvent.setup();
    const onInviteGuest = vi.fn();
    render(controls({ onInviteGuest, canDeafen: false }));
    await user.click(screen.getByRole("button", { name: "Invite a guest" }));
    expect(onInviteGuest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /deafen/iu })).toBeNull();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
  });
});

describe("SummaryView", () => {
  it("renders model output as inert text, never as markup", () => {
    const { container } = render(
      <SummaryView
        summary={{
          overview: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
          keyPoints: ["**bold** [link](javascript:alert(3))"],
          decisions: [],
          actionItems: [{ text: "<b>Do it</b>", owner: "<i>Sam</i>" }],
          speakerHighlights: [{ speaker: "<u>Ada</u>", text: "<svg onload=alert(4)>" }],
          language: null,
        }}
      />,
    );
    expect(container.querySelector("img, script, svg, b, i, u, a")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container).toHaveTextContent("**bold** [link](javascript:alert(3))");
    expect(container).toHaveTextContent("<i>Sam</i>");
  });

  it("omits empty sections and repeats keep distinct keys", () => {
    render(
      <SummaryView
        summary={{
          overview: "",
          keyPoints: ["Same", "Same"],
          decisions: [],
          actionItems: [],
          speakerHighlights: [],
          language: null,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Key points" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Decisions" })).toBeNull();
    expect(screen.getAllByText("Same")).toHaveLength(2);
  });
});
