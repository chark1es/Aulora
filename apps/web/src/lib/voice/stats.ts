import { networkQuality } from "@aulora/core";
import type { LinkQuality } from "./levels";

/**
 * Call telemetry: a light stats sampler and the auto-degrade decision.
 *
 * `RTCPeerConnection.getStats()` is expensive enough to be worth bounding, so
 * it runs every few seconds in an active call and only over the inbound RTP
 * counters (loss, RTT, jitter) that decide link quality. The decision logic is
 * pure and testable with synthetic reports.
 */

/** How often the engine samples stats while a call runs. */
export const STATS_INTERVAL_MS = 3_000;

/** One switch for the whole automatic-degrade behaviour. */
export const AUTO_DEGRADE_ENABLED = true;

/** Consecutive poor samples before stepping the camera down again (~9 s). */
export const POOR_SAMPLES_PER_STEP = 3;

/** The inbound RTP fields the sampler reads; everything else is ignored. */
export interface RtpStatsSample {
  readonly type?: string;
  readonly kind?: string;
  readonly packetsReceived?: number;
  readonly packetsLost?: number;
  readonly jitter?: number;
  /** Seconds, from `remote-inbound-rtp`. */
  readonly roundTripTime?: number;
  /** Seconds, from `candidate-pair`. */
  readonly currentRoundTripTime?: number;
  readonly state?: string;
  readonly selected?: boolean;
}

/** Cumulative counters kept between samples so loss is measured per interval. */
export interface RtpCounters {
  readonly packetsReceived: number;
  readonly packetsLost: number;
}

/** What one peer's link looks like, in the units `networkQuality` expects. */
export interface PeerLinkStats {
  readonly packetLoss: number;
  readonly roundTripTimeMs: number;
  readonly jitterMs: number;
}

function numberField(sample: RtpStatsSample, key: keyof RtpStatsSample): number | null {
  const value = sample[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Loss over the interval since the previous sample, so a burst that has since
 * healed stops counting. Cumulative loss would keep a call degraded forever.
 */
export function lossRate(previous: RtpCounters | null, next: RtpCounters): number {
  const received = Math.max(0, next.packetsReceived - (previous?.packetsReceived ?? 0));
  const lost = Math.max(0, next.packetsLost - (previous?.packetsLost ?? 0));
  const total = received + lost;
  return total === 0 ? 0 : lost / total;
}

/**
 * Turns one peer's report into link stats, preferring the audio stream (what
 * matters for conversation) and the selected candidate pair's RTT. Returns
 * `null` before any RTP has arrived, so a fresh peer is not counted as healthy
 * or unhealthy.
 */
export function summarizeStats(
  samples: readonly RtpStatsSample[],
  previous: RtpCounters | null,
): { readonly stats: PeerLinkStats; readonly counters: RtpCounters } | null {
  const inbound = samples.filter((sample) => sample.type === "inbound-rtp");
  const audio =
    inbound.find((sample) => sample.kind === "audio") ??
    inbound.find((sample) => numberField(sample, "packetsReceived") !== null);
  if (audio === undefined) {
    return null;
  }
  const packetsReceived = numberField(audio, "packetsReceived") ?? 0;
  const packetsLost = numberField(audio, "packetsLost") ?? 0;
  const counters: RtpCounters = { packetsReceived, packetsLost };
  const jitterSeconds = numberField(audio, "jitter") ?? 0;

  let roundTripSeconds = 0;
  const pair = samples.find(
    (sample) => sample.type === "candidate-pair" && sample.selected === true,
  );
  const pairRtt = pair === undefined ? null : numberField(pair, "currentRoundTripTime");
  if (pairRtt !== null) {
    roundTripSeconds = pairRtt;
  } else {
    const remote = samples.find((sample) => sample.type === "remote-inbound-rtp");
    roundTripSeconds = remote === undefined ? 0 : (numberField(remote, "roundTripTime") ?? 0);
  }

  return {
    stats: {
      packetLoss: lossRate(previous, counters),
      roundTripTimeMs: Math.max(0, roundTripSeconds * 1000),
      jitterMs: Math.max(0, jitterSeconds * 1000),
    },
    counters,
  };
}

/** Worst-first ordering for combining every peer into one call quality. */
const QUALITY_RANK: Readonly<Record<LinkQuality, number>> = { good: 0, fair: 1, poor: 2 };

/** The worst of several peer qualities; `null` when there is nothing sampled. */
export function worstQuality(qualities: readonly (LinkQuality | null)[]): LinkQuality | null {
  let worst: LinkQuality | null = null;
  for (const quality of qualities) {
    if (quality === null) {
      continue;
    }
    if (worst === null || QUALITY_RANK[quality] > QUALITY_RANK[worst]) {
      worst = quality;
    }
  }
  return worst;
}

/** The quality bucket for one peer's measured link. */
export function qualityOf(stats: PeerLinkStats): LinkQuality {
  return networkQuality(stats.packetLoss, stats.roundTripTimeMs);
}

export type DegradeStage = "none" | "reduced" | "audioOnly";

/** What the engine should do after a sample: nothing, trim, or go audio-only. */
export type DegradeAction = "none" | "reduce" | "audio-only";

/**
 * A conservative ladder: three sustained poor samples lower the camera's
 * bitrate and resolution, three more turn the camera off. It never steps back
 * up on its own (that oscillates); the person can undo from the notice, which
 * suppresses it for the rest of the call.
 */
export class QualityGovernor {
  private stage: DegradeStage = "none";
  private poor = 0;
  private suppressed = false;

  constructor(private readonly enabled: boolean = AUTO_DEGRADE_ENABLED) {}

  get currentStage(): DegradeStage {
    return this.stage;
  }

  /** Feeds the worst quality across peers; returns the action to take. */
  sample(quality: LinkQuality | null): DegradeAction {
    if (!this.enabled || this.suppressed || quality === null) {
      return "none";
    }
    if (quality !== "poor") {
      this.poor = 0;
      return "none";
    }
    this.poor += 1;
    if (this.poor < POOR_SAMPLES_PER_STEP) {
      return "none";
    }
    this.poor = 0;
    if (this.stage === "none") {
      this.stage = "reduced";
      return "reduce";
    }
    if (this.stage === "reduced") {
      this.stage = "audioOnly";
      return "audio-only";
    }
    return "none";
  }

  /** The person undid or dismissed the reduction: stop stepping down. */
  suppress(): void {
    this.suppressed = true;
  }
}
