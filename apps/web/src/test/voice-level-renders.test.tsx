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
  return { track, stream, meters: [] as ((level: number) => void)[] };
});

vi.mock("../lib/voice/mic-pipeline", () => ({
  openMicPipeline: async () => ({
    stream: mock.stream,
    enhanced: false,
    setSettings: () => {},
    stop: () => {},
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
  sendLeaveBeacon: () => {},
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
    renders.plain = 0;
    renders.meter = 0;
    voice = null;
  });

  it("does not re-render a plain useVoice consumer on a meter tick", async () => {
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

    await act(async () => {
      await voice?.joinCall("call-1");
      await flush();
    });
    expect(voice?.callId).toBe("call-1");
    expect(screen.getByTestId("plain")).toHaveTextContent("call-1");
    expect(mock.meters).toHaveLength(1);

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
  });
});
