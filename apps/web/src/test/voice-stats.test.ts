import { describe, expect, it } from "vitest";
import {
  AUTO_DEGRADE_ENABLED,
  lossRate,
  POOR_SAMPLES_PER_STEP,
  QualityGovernor,
  qualityOf,
  type RtpStatsSample,
  summarizeStats,
  worstQuality,
} from "../lib/voice/stats";

describe("lossRate", () => {
  it("measures loss over the interval, not the whole call", () => {
    expect(
      lossRate(
        { packetsReceived: 1_000, packetsLost: 100 },
        { packetsReceived: 1_100, packetsLost: 140 },
      ),
    ).toBeCloseTo(40 / 140);
    expect(lossRate(null, { packetsReceived: 90, packetsLost: 10 })).toBeCloseTo(0.1);
  });

  it("reports no loss when nothing arrived yet", () => {
    expect(lossRate(null, { packetsReceived: 0, packetsLost: 0 })).toBe(0);
    // A counter reset must not produce a negative or absurd rate.
    expect(
      lossRate({ packetsReceived: 500, packetsLost: 5 }, { packetsReceived: 0, packetsLost: 0 }),
    ).toBe(0);
  });
});

describe("summarizeStats", () => {
  const audio = {
    type: "inbound-rtp",
    kind: "audio",
    packetsReceived: 900,
    packetsLost: 100,
    jitter: 0.02,
  };
  const video = { type: "inbound-rtp", kind: "video", packetsReceived: 50, packetsLost: 950 };
  const pair = {
    type: "candidate-pair",
    state: "succeeded",
    selected: true,
    currentRoundTripTime: 0.12,
  };

  it("reads the audio stream and the selected pair's RTT", () => {
    const summary = summarizeStats([video, audio, pair], null);
    expect(summary).not.toBeNull();
    expect(summary?.stats.packetLoss).toBeCloseTo(0.1);
    expect(summary?.stats.roundTripTimeMs).toBeCloseTo(120);
    expect(summary?.stats.jitterMs).toBeCloseTo(20);
    expect(summary?.counters).toEqual({ packetsReceived: 900, packetsLost: 100 });
  });

  it("falls back to remote-inbound-rtp for RTT", () => {
    const summary = summarizeStats(
      [audio, { type: "remote-inbound-rtp", roundTripTime: 0.25 }],
      null,
    );
    expect(summary?.stats.roundTripTimeMs).toBeCloseTo(250);
  });

  it("has nothing to say before RTP arrives", () => {
    expect(summarizeStats([pair], null)).toBeNull();
    expect(summarizeStats([], null)).toBeNull();
  });

  it("ignores malformed fields instead of producing NaN", () => {
    // A browser report is external data: fields may arrive as strings or null.
    const junk = {
      type: "inbound-rtp",
      kind: "audio",
      packetsReceived: "many",
      packetsLost: null,
    } as unknown as RtpStatsSample;
    const summary = summarizeStats([junk], null);
    expect(summary?.stats.packetLoss).toBe(0);
    expect(summary?.stats.roundTripTimeMs).toBe(0);
  });
});

describe("quality buckets", () => {
  it("maps measured loss and RTT through networkQuality", () => {
    expect(qualityOf({ packetLoss: 0, roundTripTimeMs: 40, jitterMs: 0 })).toBe("good");
    expect(qualityOf({ packetLoss: 0.05, roundTripTimeMs: 40, jitterMs: 0 })).toBe("fair");
    expect(qualityOf({ packetLoss: 0.02, roundTripTimeMs: 450, jitterMs: 0 })).toBe("poor");
  });

  it("takes the worst of the peers", () => {
    expect(worstQuality([])).toBeNull();
    expect(worstQuality([null, "good", "fair"])).toBe("fair");
    expect(worstQuality(["fair", "poor", "good"])).toBe("poor");
  });
});

describe("QualityGovernor", () => {
  it("steps down after sustained poor samples, then goes audio-only", () => {
    const governor = new QualityGovernor();
    for (let index = 1; index < POOR_SAMPLES_PER_STEP; index += 1) {
      expect(governor.sample("poor")).toBe("none");
    }
    expect(governor.sample("poor")).toBe("reduce");
    expect(governor.currentStage).toBe("reduced");

    for (let index = 1; index < POOR_SAMPLES_PER_STEP; index += 1) {
      expect(governor.sample("poor")).toBe("none");
    }
    expect(governor.sample("poor")).toBe("audio-only");
    expect(governor.currentStage).toBe("audioOnly");

    // Nothing further to give up.
    for (let index = 0; index < 10; index += 1) {
      expect(governor.sample("poor")).toBe("none");
    }
  });

  it("needs the poor samples to be consecutive", () => {
    const governor = new QualityGovernor();
    governor.sample("poor");
    governor.sample("poor");
    expect(governor.sample("good")).toBe("none");
    expect(governor.sample("poor")).toBe("none");
  });

  it("is inert when disabled, suppressed, or there is no sample yet", () => {
    const disabled = new QualityGovernor(false);
    for (let index = 0; index < POOR_SAMPLES_PER_STEP * 2; index += 1) {
      expect(disabled.sample("poor")).toBe("none");
    }
    const suppressed = new QualityGovernor();
    suppressed.suppress();
    for (let index = 0; index < POOR_SAMPLES_PER_STEP * 2; index += 1) {
      expect(suppressed.sample("poor")).toBe("none");
    }
    const empty = new QualityGovernor();
    expect(empty.sample(null)).toBe("none");
  });

  it("is enabled by the single documented switch", () => {
    expect(AUTO_DEGRADE_ENABLED).toBe(true);
  });
});
