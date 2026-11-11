import { act, render, screen } from "@testing-library/react";
import type { ConvexReactClient } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVoice, type VoiceContextValue, VoiceProvider } from "../providers/VoiceProvider";
import { useMicLevel } from "../providers/voice-levels";

const mock = vi.hoisted(() => {
  const track = {
    kind: "audio",
    enabled: true,
    getSettings: () => ({ deviceId: "mic" }),
    stop: () => {},
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  return {
    beacon: vi.fn(),
    stop: vi.fn(),
    track,
    stream,
    meters: [] as ((level: number) => void)[],
  };
});

vi.mock("../lib/voice/mic-pipeline", () => ({
  openMicPipeline: async () => ({
    stream: mock.stream,
    enhanced: false,
    setSettings: () => {},
    stop: mock.stop,
  }),
  micProcessingKey: () => "processing",
}));

vi.mock("../lib/voice/media", () => ({
  createLevelMeter: (_stream: unknown, onLevel: (level: number) => void) => {
    mock.meters.push(onLevel);
    return () => {};
  },
  listMediaDevices: async () => [],
  onDeviceChange: () => () => {},
  applySinkId: async () => {},
  resumeLevelMeterContext: () => {},
}));

vi.mock("../lib/voice/leave-beacon", () => ({
  sendLeaveBeacon: mock.beacon,
}));

const flush = async (turns = 6) => {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
};

describe("mic level re-render isolation", () => {
  const renders: { plain: number; meter: number } = { plain: 0, meter: 0 };
  let voice: VoiceContextValue | null = null;

  function PlainConsumer() {
    const value = useVoice();
    renders.plain += 1;
    return <div data-testid="plain">{value.callId ?? "idle"}</div>;
  }

  function MicMeter() {
    renders.meter += 1;
    return <div data-testid="meter">{useMicLevel()}</div>;
  }

  function Probe() {
    voice = useVoice();
    return null;
  }

  beforeEach(() => {
    mock.meters.length = 0;
    mock.beacon.mockClear();
    mock.stop.mockClear();
    renders.plain = 0;
    renders.meter = 0;
    voice = null;
  });

  function renderVoice() {
    const client = {
      url: "https://example.test",
      watchQuery: () => ({
        localQueryResult: () => undefined,
        onUpdate: () => () => {},
      }),
      mutation: async () => null,
      action: async () => null,
    } as unknown as ConvexReactClient;

    render(
      <VoiceProvider
        client={client}
        userId="me"
        permissions={0xffffn}
        policy={{
          enabled: true,
          videoEnabled: true,
          screenShareEnabled: true,
          maxParticipants: 8,
          iceServers: [],
        }}
      >
        <Probe />
        <PlainConsumer />
        <MicMeter />
      </VoiceProvider>,
    );
  }

  function expectMeterIsolation() {
    renders.plain = 0;
    renders.meter = 0;
    const meter = mock.meters[0] as (level: number) => void;

    // Below the speaking threshold: only the meter re-renders.
    act(() => {
      meter(0.02);
    });
    expect(screen.getByTestId("meter")).toHaveTextContent("0.02");
    expect(renders.meter).toBeGreaterThan(0);
    expect(renders.plain).toBe(0);

    act(() => {
      meter(0.05);
    });
    expect(screen.getByTestId("meter")).toHaveTextContent("0.05");
    expect(renders.plain).toBe(0);

    // Crossing the speaking threshold is real state, so the context does change.
    act(() => {
      meter(0.5);
    });
    expect(renders.plain).toBeGreaterThan(0);
  }

  function expectPagehide(persisted: boolean) {
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }));
    });
    if (persisted) {
      expect(voice?.callId).toBe("call-1");
      expect(mock.beacon).not.toHaveBeenCalled();
      expect(mock.stop).not.toHaveBeenCalled();
      return;
    }
    expect(voice?.callId).toBeNull();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.beacon).toHaveBeenCalledWith(
      expect.objectContaining({
        convexUrl: "https://example.test",
        callId: "call-1",
        clientId: expect.any(String),
      }),
    );
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    expect(mock.beacon).toHaveBeenCalledOnce();
  }

  it.each([false, true])(
    "isolates mic renders and handles pagehide persisted:%s",
    async (persisted) => {
      renderVoice();

      await act(async () => {
        await voice?.joinCall("call-1");
        await flush();
      });
      expect(voice?.callId).toBe("call-1");
      expect(screen.getByTestId("plain")).toHaveTextContent("call-1");
      expect(mock.meters).toHaveLength(1);

      // A dirty-form prompt may cancel this event. The call must survive Stay.
      act(() => {
        window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
      });
      expect(voice?.callId).toBe("call-1");
      expect(screen.getByTestId("plain")).toHaveTextContent("call-1");
      expect(mock.beacon).not.toHaveBeenCalled();
      expect(mock.stop).not.toHaveBeenCalled();

      expectMeterIsolation();
      expectPagehide(persisted);
    },
  );
});
