import { Permission } from "@aulora/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transcriptionOffer } from "../components/voice/transcription-offer";
import { useCallAddonControls } from "../components/voice/use-call-addons";

const state = vi.hoisted(() => ({
  voice: {} as Record<string, unknown>,
  status: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.status,
  useMutation: () => vi.fn().mockResolvedValue(null),
}));
vi.mock("../providers/VoiceProvider", () => ({ useVoice: () => state.voice }));

function voice(overrides: {
  addon: boolean;
  permissions: bigint;
  transcribing: boolean;
}): Record<string, unknown> {
  return {
    call: {
      id: "call1",
      transcribing: overrides.transcribing,
      transcriptionSessionId: overrides.transcribing ? "ts1" : null,
    },
    addons: { transcription: overrides.addon, guestCalls: false, scheduledCalls: false },
    permissions: overrides.permissions,
    reportError: vi.fn(),
    setInviteGuestOpen: vi.fn(),
  };
}

beforeEach(() => {
  state.status = { ready: true, serviceInstalled: true, runtimeReady: true };
});

describe("transcriptionOffer", () => {
  const start = Permission.StartTranscription;
  const base = {
    permissions: start,
    addonEnabled: true,
    modelReady: true,
    serviceInstalled: true,
    runtimeReady: true,
    inCall: true,
  };

  it("offers Start only with the permission, the addon, a ready model and a call", () => {
    expect(transcriptionOffer({ ...base, transcribing: false })).toBe("start");
    expect(transcriptionOffer({ ...base, addonEnabled: false, transcribing: false })).toBe("none");
    expect(transcriptionOffer({ ...base, modelReady: false, transcribing: false })).toBe("none");
    expect(transcriptionOffer({ ...base, permissions: 0n, transcribing: false })).toBe("none");
    expect(transcriptionOffer({ ...base, inCall: false, transcribing: false })).toBe("none");
  });

  it("does not offer Start while the transcriber service is not running", () => {
    expect(transcriptionOffer({ ...base, serviceInstalled: false, transcribing: false })).toBe(
      "none",
    );
    expect(
      transcriptionOffer({
        ...base,
        serviceInstalled: false,
        modelReady: false,
        transcribing: false,
      }),
    ).toBe("none");
  });

  it("does not offer Start until the container's engine is loaded", () => {
    expect(transcriptionOffer({ ...base, runtimeReady: false, transcribing: false })).toBe("none");
    expect(transcriptionOffer({ ...base, transcribing: false })).toBe("start");
    // A running session can still be stopped.
    expect(transcriptionOffer({ ...base, runtimeReady: false, transcribing: true })).toBe("stop");
  });

  it("keeps Stop for a running session even when the service has gone quiet", () => {
    expect(transcriptionOffer({ ...base, serviceInstalled: false, transcribing: true })).toBe(
      "stop",
    );
  });

  it("offers Stop for a running session even after the addon is switched off or the model is gone", () => {
    expect(transcriptionOffer({ ...base, addonEnabled: false, transcribing: true })).toBe("stop");
    expect(
      transcriptionOffer({ ...base, addonEnabled: false, modelReady: false, transcribing: true }),
    ).toBe("stop");
    expect(
      transcriptionOffer({
        ...base,
        permissions: Permission.ManageTranscription,
        addonEnabled: false,
        transcribing: true,
      }),
    ).toBe("stop");
  });

  it("never offers Stop to someone without the permission", () => {
    expect(transcriptionOffer({ ...base, permissions: 0n, transcribing: true })).toBe("none");
    expect(
      transcriptionOffer({ ...base, permissions: Permission.ViewTranscripts, transcribing: true }),
    ).toBe("none");
  });
});

describe("useCallAddonControls (transcription)", () => {
  it("keeps Stop available, and reports the live session, when the addon was just disabled", () => {
    state.voice = voice({
      addon: false,
      permissions: Permission.StartTranscription,
      transcribing: true,
    });
    const { result } = renderHook(() => useCallAddonControls());
    expect(result.current.transcription).toMatchObject({ active: true });
  });

  it("offers nothing when the addon is off and no session is running", () => {
    state.voice = voice({
      addon: false,
      permissions: Permission.StartTranscription,
      transcribing: false,
    });
    const { result } = renderHook(() => useCallAddonControls());
    expect(result.current.transcription).toBeUndefined();
  });

  it("offers no Start when the status says the service is not installed", () => {
    state.status = { ready: true, serviceInstalled: false, runtimeReady: true };
    state.voice = voice({
      addon: true,
      permissions: Permission.StartTranscription,
      transcribing: false,
    });
    const { result } = renderHook(() => useCallAddonControls());
    expect(result.current.transcription).toBeUndefined();
  });

  it("offers no Start while the engine is not loaded, even with the model downloaded", () => {
    state.status = { ready: true, serviceInstalled: true, runtimeReady: false };
    state.voice = voice({
      addon: true,
      permissions: Permission.StartTranscription,
      transcribing: false,
    });
    const { result } = renderHook(() => useCallAddonControls());
    expect(result.current.transcription).toBeUndefined();
  });

  it("offers Start when allowed and idle", () => {
    state.voice = voice({
      addon: true,
      permissions: Permission.StartTranscription,
      transcribing: false,
    });
    const { result } = renderHook(() => useCallAddonControls());
    expect(result.current.transcription).toMatchObject({ active: false });
  });
});
