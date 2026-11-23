import { Permission } from "@aulora/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionEndedNotice } from "../components/voice/TranscriptionEndedNotice";
import {
  consumeTranscriptRequest,
  getTranscriptNavigationSnapshot,
} from "../lib/transcription/transcript-navigation";

const state = vi.hoisted(() => ({
  voice: {} as Record<string, unknown>,
}));

vi.mock("../providers/VoiceProvider", () => ({
  useVoice: () => state.voice,
}));

function setVoice(call: Record<string, unknown> | null, permissions = Permission.ViewTranscripts) {
  state.voice = { call, permissions, addons: { transcription: true } };
}

const running = { transcribing: true, transcriptionSessionId: "s1" };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setVoice(running);
});

afterEach(() => {
  consumeTranscriptRequest();
  vi.useRealTimers();
});

describe("TranscriptionEndedNotice", () => {
  it("shows a toast when transcription stops and opens the transcript on click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<TranscriptionEndedNotice />);
    expect(screen.queryByRole("status")).toBeNull();
    setVoice({ transcribing: false, transcriptionSessionId: null });
    rerender(<TranscriptionEndedNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Transcription ended");
    await user.click(screen.getByRole("button", { name: "View transcript" }));
    expect(getTranscriptNavigationSnapshot()).toBe("s1");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows when this device leaves the call, once per session", () => {
    const { rerender } = render(<TranscriptionEndedNotice />);
    setVoice(null);
    rerender(<TranscriptionEndedNotice />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByRole("status")).toBeNull();
    setVoice({ transcribing: false });
    rerender(<TranscriptionEndedNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismisses itself after about fifteen seconds", () => {
    const { rerender } = render(<TranscriptionEndedNotice />);
    setVoice(null);
    rerender(<TranscriptionEndedNotice />);
    act(() => {
      vi.advanceTimersByTime(15_100);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays quiet for viewers who cannot read transcripts", () => {
    setVoice(running, 0n);
    const { rerender } = render(<TranscriptionEndedNotice />);
    setVoice(null, 0n);
    rerender(<TranscriptionEndedNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
