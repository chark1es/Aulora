import { DEFAULT_VOICE_SETTINGS } from "@aulora/core";
import { describe, expect, it } from "vitest";
import { displayContentHint } from "../lib/voice/display";
import { smoothMask } from "../lib/voice/effects/segmenter";
import { gateOpenThresholdDb, micProcessingKey } from "../lib/voice/mic-pipeline";
import {
  applyOpusVoiceParams,
  JITTER_BUFFER_TARGET_MS,
  MIN_SCREEN_BITRATE,
  orderVideoCodecs,
  PeerMesh,
  type PeerMeshHost,
  preferredVideoCodecs,
  prefersH264ByDefault,
  screenBitrateFor,
  screenScaleFor,
  tuneReceiver,
  type VideoCodecCapability,
} from "../lib/voice/peer-mesh";

describe("gateOpenThresholdDb", () => {
  it("has no gate at zero", () => {
    expect(gateOpenThresholdDb(0)).toBeNull();
    expect(gateOpenThresholdDb(-1)).toBeNull();
  });

  it("opens higher as the slider rises, within a sane range", () => {
    const low = gateOpenThresholdDb(0.1);
    const high = gateOpenThresholdDb(0.5);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high as number).toBeGreaterThan(low as number);
    expect(low as number).toBeLessThan(-60);
    expect(gateOpenThresholdDb(1)).toBe(-30);
  });

  it("never goes above the top of the range", () => {
    expect(gateOpenThresholdDb(5)).toBe(-30);
  });
});

describe("micProcessingKey", () => {
  it("changes whenever a flag that needs a fresh microphone capture changes", () => {
    const base = micProcessingKey(DEFAULT_VOICE_SETTINGS);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, echoCancellation: false })).not.toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, noiseSuppression: false })).not.toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, autoGainControl: false })).not.toBe(base);
    expect(
      micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, enhancedNoiseSuppression: true }),
    ).not.toBe(base);
  });

  it("ignores settings that apply without reopening the microphone", () => {
    const base = micProcessingKey(DEFAULT_VOICE_SETTINGS);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, inputVolume: 1.7 })).toBe(base);
    expect(micProcessingKey({ ...DEFAULT_VOICE_SETTINGS, noiseGateThreshold: 0.4 })).toBe(base);
  });
});

describe("smoothMask", () => {
  it("moves each value part of the way to the new one, in place", () => {
    const previous = Uint8Array.from([0, 100, 255]);
    const result = smoothMask(previous, Uint8Array.from([100, 100, 0]), 0.5);
    expect(result).toBe(previous);
    expect(Array.from(previous)).toEqual([50, 100, 128]);
  });

  it("takes the new mask outright at full weight and ignores it at zero", () => {
    expect(Array.from(smoothMask(Uint8Array.from([10, 20]), Uint8Array.from([200, 0]), 1))).toEqual(
      [200, 0],
    );
    expect(Array.from(smoothMask(Uint8Array.from([10, 20]), Uint8Array.from([200, 0]), 0))).toEqual(
      [10, 20],
    );
  });

  it("keeps the old value where the new mask is shorter", () => {
    expect(Array.from(smoothMask(Uint8Array.from([40, 80]), Uint8Array.from([0]), 1))).toEqual([
      0, 80,
    ]);
  });
});

describe("the mesh upload budget stays consistent with the stream profile", () => {
  it("never asks for more than one viewer's cap", () => {
    expect(screenBitrateFor({ maxBitrate: 3_500_000, frameRate: 30 }, 1)).toBe(3_500_000);
  });
});

describe("tuneReceiver", () => {
  it("asks for a modest jitter buffer instead of disabling concealment", () => {
    const receiver = { jitterBufferTarget: 0 };
    tuneReceiver(receiver as unknown as RTCRtpReceiver);
    expect(receiver.jitterBufferTarget).toBe(JITTER_BUFFER_TARGET_MS);
    expect(JITTER_BUFFER_TARGET_MS).toBeGreaterThanOrEqual(100);
  });

  it("leaves a receiver without the property on the browser default", () => {
    const receiver: Record<string, unknown> = {};
    expect(() => tuneReceiver(receiver as unknown as RTCRtpReceiver)).not.toThrow();
    expect("jitterBufferTarget" in receiver).toBe(false);
  });

  it("survives an engine that refuses the write", () => {
    const receiver = {
      get jitterBufferTarget(): number {
        return 0;
      },
    };
    expect(() => tuneReceiver(receiver as unknown as RTCRtpReceiver)).not.toThrow();
  });
});

/** A realistic local description: Opus plus RED audio, one VP8 video section. */
const SDP = [
  "v=0",
  "o=- 4611 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "a=sendrecv",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:96 VP8/90000",
  "a=fmtp:96 max-fs=12288",
  "a=sendrecv",
  "",
].join("\r\n");

function fmtpOf(sdp: string, payloadType: string): string | undefined {
  return sdp
    .split(/\r\n|\n/)
    .find((line) => line.startsWith(`a=fmtp:${payloadType} `))
    ?.slice(`a=fmtp:${payloadType} `.length);
}

describe("applyOpusVoiceParams", () => {
  it("turns on FEC and DTX and turns stereo off, keeping other Opus parameters", () => {
    const tuned = applyOpusVoiceParams(SDP);
    const params = fmtpOf(tuned, "111")?.split(";") ?? [];
    expect(params).toContain("useinbandfec=1");
    expect(params).toContain("usedtx=1");
    expect(params).toContain("stereo=0");
    expect(params).toContain("minptime=10");
  });

  it("overrides values the browser or a peer left off", () => {
    const tuned = applyOpusVoiceParams(
      SDP.replace("minptime=10;useinbandfec=1", "useinbandfec=0;usedtx=0;stereo=1"),
    );
    const params = fmtpOf(tuned, "111")?.split(";") ?? [];
    expect(params).toContain("useinbandfec=1");
    expect(params).toContain("usedtx=1");
    expect(params).toContain("stereo=0");
    expect(params).not.toContain("useinbandfec=0");
  });

  it("adds an fmtp line when the audio section has none", () => {
    const tuned = applyOpusVoiceParams(
      SDP.replace("a=fmtp:111 minptime=10;useinbandfec=1\r\n", ""),
    );
    expect(fmtpOf(tuned, "111")).toBe("useinbandfec=1;usedtx=1;stereo=0");
  });

  it("leaves other codecs and the video section alone", () => {
    const tuned = applyOpusVoiceParams(SDP);
    expect(fmtpOf(tuned, "63")).toBe("111/111");
    expect(fmtpOf(tuned, "96")).toBe("max-fs=12288");
  });

  it("keeps the SDP line endings and is idempotent", () => {
    const tuned = applyOpusVoiceParams(SDP);
    expect(tuned).toContain("\r\n");
    expect(applyOpusVoiceParams(tuned)).toBe(tuned);
  });

  it("returns an SDP without Opus unchanged", () => {
    const noOpus = SDP.replace("a=rtpmap:111 opus/48000/2", "a=rtpmap:111 G722/80000");
    expect(applyOpusVoiceParams(noOpus)).toBe(noOpus);
  });
});

describe("PeerMesh.applyAudioTrack", () => {
  type MeshPeer = Parameters<PeerMesh["peers"]["set"]>[1];
  type FakeSender = {
    readonly track: { kind: string };
    replaceTrack(track: unknown): Promise<void>;
    getParameters(): { encodings: unknown[] };
    setParameters(params: unknown): Promise<void>;
  };

  function sender(kind: string, log: unknown[]): FakeSender {
    return {
      track: { kind },
      async replaceTrack(track) {
        log.push(track);
      },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {},
    };
  }

  it("detaches audio while muted without touching the video transceiver", async () => {
    const audioReplace: unknown[] = [];
    const videoReplace: unknown[] = [];
    const mesh = new PeerMesh({} as PeerMeshHost);
    // Test double for the peer's connection internals; only the transceivers matter.
    const peer = {
      pc: {},
      stream: { getTracks: () => [] },
      initiator: true,
      pendingCandidates: [],
      audioTx: { direction: "sendrecv", sender: sender("audio", audioReplace) },
      videoTx: { direction: "sendrecv", sender: sender("video", videoReplace) },
      connection: "connected",
      levelUnsub: null,
      session: 1,
    } as unknown as MeshPeer;
    mesh.peers.set("them", peer);

    await mesh.applyAudioTrack(null);
    expect(audioReplace).toEqual([null]);
    expect(videoReplace).toEqual([]);
    expect(peer.audioTx?.direction).toBe("sendrecv");

    const track = { kind: "audio" } as unknown as MediaStreamTrack;
    await mesh.applyAudioTrack(track);
    expect(audioReplace.at(-1)).toBe(track);
    expect(videoReplace).toEqual([]);
  });
});

describe("screen share mesh budget", () => {
  const budget = { maxBitrate: 3_500_000, frameRate: 30 };

  it("keeps a legible bitrate floor as viewers multiply", () => {
    for (const viewers of [4, 6, 10, 25]) {
      expect(screenBitrateFor(budget, viewers)).toBeGreaterThanOrEqual(MIN_SCREEN_BITRATE);
    }
    expect(screenBitrateFor({ maxBitrate: 1_200_000, frameRate: 15 }, 12)).toBe(MIN_SCREEN_BITRATE);
  });

  it("never exceeds the profile's own cap", () => {
    expect(screenBitrateFor(budget, 0)).toBe(3_500_000);
    expect(screenBitrateFor(budget, 1)).toBe(3_500_000);
  });

  it("scales resolution down before frame rate", () => {
    expect(screenScaleFor(1)).toBe(1);
    expect(screenScaleFor(3)).toBe(1);
    expect(screenScaleFor(4)).toBeGreaterThan(1);
    expect(screenScaleFor(6)).toBeGreaterThan(screenScaleFor(4));
    expect(screenScaleFor(9)).toBeGreaterThan(screenScaleFor(6));
  });
});

describe("mesh video codec preferences", () => {
  it("prefers VP9 on Chromium and H.264 on WebKit, with VP8 as the fallback", () => {
    expect(preferredVideoCodecs("auto", false)[0]).toBe("video/VP9");
    expect(preferredVideoCodecs("auto", true)[0]).toBe("video/H264");
    expect(preferredVideoCodecs("auto", false).at(-1)).toBe("video/VP8");
  });

  it("honours an explicit codec choice", () => {
    expect(preferredVideoCodecs("av1", false)[0]).toBe("video/AV1");
    expect(preferredVideoCodecs("h264", false)[0]).toBe("video/H264");
    expect(preferredVideoCodecs("vp9", true)[0]).toBe("video/VP9");
  });

  it("orders the engine's capabilities by preference, keeping the rest after", () => {
    const codecs = ["video/VP8", "video/rtx", "video/VP9", "video/H264"].map(
      (mimeType) => ({ mimeType }) as VideoCodecCapability,
    );
    const ordered = orderVideoCodecs(codecs, preferredVideoCodecs("auto", false)).map(
      (codec) => codec.mimeType,
    );
    expect(ordered[0]).toBe("video/VP9");
    expect(ordered.indexOf("video/H264")).toBeGreaterThan(ordered.indexOf("video/VP9"));
    expect(ordered.at(-1)).toBe("video/rtx");
  });

  it("recognises WebKit engines and Chromium shells", () => {
    expect(
      prefersH264ByDefault(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(true);
    expect(
      prefersH264ByDefault(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(prefersH264ByDefault("")).toBe(false);
  });
});

describe("displayContentHint", () => {
  it("keeps detail for desktops and asks for motion only in the smooth profile", () => {
    expect(displayContentHint("saver")).toBe("detail");
    expect(displayContentHint("balanced")).toBe("detail");
    expect(displayContentHint("smooth")).toBe("motion");
  });
});
