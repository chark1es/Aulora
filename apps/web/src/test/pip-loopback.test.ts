import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPipReceiver,
  createPipSender,
  LOOPBACK_PEER_CONFIG,
  type LoopbackSignal,
  loopbackSupported,
  parseLoopbackSignal,
} from "../lib/voice/pip-loopback";

class FakeSender {
  track: MediaStreamTrack | null = null;
  readonly replaced: (MediaStreamTrack | null)[] = [];

  async replaceTrack(track: MediaStreamTrack | null) {
    this.track = track;
    this.replaced.push(track);
  }
}

interface FakeTransceiver {
  readonly kind: string;
  readonly direction: string;
  readonly sender: FakeSender;
}

class FakePeer {
  static instances: FakePeer[] = [];

  readonly config: RTCConfiguration | undefined;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  remoteDescription: { type: string; sdp: string } | null = null;
  localDescription: { type: string; sdp: string } | null = null;
  closed = false;
  readonly transceivers: FakeTransceiver[] = [];
  readonly addedIce: RTCIceCandidateInit[] = [];

  constructor(config?: RTCConfiguration) {
    this.config = config;
    FakePeer.instances.push(this);
  }

  addTransceiver(kind: string, init?: { direction?: string }) {
    const sender = new FakeSender();
    this.transceivers.push({ kind, direction: init?.direction ?? "sendrecv", sender });
    return { sender, receiver: {} };
  }

  async createOffer() {
    return { type: "offer" as const, sdp: "offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "answer-sdp" };
  }

  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }

  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.addedIce.push(candidate);
  }

  close() {
    this.closed = true;
    this.connectionState = "closed";
  }

  fireCandidate(candidate: string) {
    this.onicecandidate?.({ candidate: { candidate } as RTCIceCandidate });
  }
}

/** Lets every awaited step of the signalling settle without a real timer. */
async function flush(): Promise<void> {
  for (let step = 0; step < 10; step += 1) {
    await Promise.resolve();
  }
}

function harness() {
  FakePeer.instances = [];
  const sent: LoopbackSignal[] = [];
  const createPeer = () => new FakePeer() as unknown as RTCPeerConnection;
  return {
    sent,
    createPeer,
    options: { send: (signal: LoopbackSignal) => sent.push(signal), createPeer },
  };
}

function lastPeer(): FakePeer {
  const peer = FakePeer.instances.at(-1);
  if (peer === undefined) {
    throw new Error("no peer connection was created");
  }
  return peer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the sender (main window)", () => {
  it("offers one video-only transceiver with no ICE servers", async () => {
    const { sent, options } = harness();
    createPipSender(options);
    await flush();

    const peer = lastPeer();
    expect(peer.transceivers).toHaveLength(1);
    expect(peer.transceivers[0]?.kind).toBe("video");
    expect(peer.transceivers[0]?.direction).toBe("sendonly");
    expect(sent).toEqual([{ kind: "offer", sdp: "offer-sdp" }]);
  });

  it("trickles host candidates to the window", async () => {
    const { sent, options } = harness();
    createPipSender(options);
    await flush();
    lastPeer().fireCandidate("candidate:1 1 udp 1 127.0.0.1 1 typ host");
    expect(sent.at(-1)).toEqual({
      kind: "ice",
      candidate: "candidate:1 1 udp 1 127.0.0.1 1 typ host",
      sdpMid: null,
      sdpMLineIndex: null,
    });
  });

  it("holds candidates that arrive before the answer, then applies them", async () => {
    const { options } = harness();
    const { receive } = createPipSender(options);
    await flush();
    const peer = lastPeer();

    receive({ kind: "ice", candidate: "late-host", sdpMid: "0", sdpMLineIndex: 0 });
    expect(peer.addedIce).toHaveLength(0);
    receive({ kind: "answer", sdp: "answer-sdp" });
    await flush();
    expect(peer.remoteDescription).toEqual({ type: "answer", sdp: "answer-sdp" });
    expect(peer.addedIce).toEqual([{ candidate: "late-host", sdpMid: "0", sdpMLineIndex: 0 }]);
  });

  it("makes a fresh connection and a fresh offer when the window says it is ready", async () => {
    const { sent, options } = harness();
    const { receive } = createPipSender(options);
    await flush();
    const first = lastPeer();

    receive({ kind: "ready" });
    await flush();
    expect(first.closed).toBe(true);
    expect(FakePeer.instances).toHaveLength(2);
    expect(lastPeer()).not.toBe(first);
    expect(sent.filter((signal) => signal.kind === "offer")).toHaveLength(2);
  });

  it("swaps the track without renegotiating, and never sends audio", async () => {
    const { sent, options } = harness();
    const { transport } = createPipSender(options);
    await flush();
    const peer = lastPeer();
    const track = { kind: "video" } as MediaStreamTrack;

    await transport.setTrack(track);
    expect(peer.transceivers[0]?.sender.track).toBe(track);
    expect(peer.transceivers.every((transceiver) => transceiver.kind === "video")).toBe(true);
    // A track swap is not a new offer.
    expect(sent.filter((signal) => signal.kind === "offer")).toHaveLength(1);
  });

  it("says goodbye and closes the connection", async () => {
    const { sent, options } = harness();
    const { transport } = createPipSender(options);
    await flush();
    transport.close();
    expect(sent.at(-1)).toEqual({ kind: "bye" });
    expect(lastPeer().closed).toBe(true);
    expect(transport.state()).toBe("closed");
  });

  it("ignores an offer, which only the window sends", async () => {
    const { options } = harness();
    const { receive, transport } = createPipSender(options);
    await flush();
    const peer = lastPeer();
    receive({ kind: "offer", sdp: "spoofed" });
    await flush();
    expect(peer.remoteDescription).toBeNull();
    expect(transport.state()).toBe("connecting");
  });

  it("reports connected once the peer connection settles", async () => {
    const { options } = harness();
    const states: string[] = [];
    createPipSender({ ...options, onState: (state) => states.push(state) });
    await flush();
    const peer = lastPeer();
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    expect(states.at(-1)).toBe("connected");
  });
});

describe("the receiver (call window)", () => {
  it("announces itself so a window opened mid-call gets an offer", async () => {
    const { sent, options } = harness();
    createPipReceiver({ ...options, onTrack: vi.fn() });
    await flush();
    expect(sent).toEqual([{ kind: "ready" }]);
    expect(lastPeer().transceivers).toHaveLength(0);
  });

  it("answers an offer and hands over the video track", async () => {
    const { sent, options } = harness();
    const onTrack = vi.fn();
    const { receive } = createPipReceiver({ ...options, onTrack });
    await flush();

    receive({ kind: "offer", sdp: "offer-sdp" });
    await flush();
    const peer = lastPeer();
    expect(peer.remoteDescription).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(sent.at(-1)).toEqual({ kind: "answer", sdp: "answer-sdp" });

    const track = { kind: "video" } as MediaStreamTrack;
    peer.ontrack?.({ track });
    expect(onTrack).toHaveBeenCalledWith(track);
  });

  it("never attaches audio, even if a peer connection offers it", async () => {
    const { options } = harness();
    const onTrack = vi.fn();
    const { receive } = createPipReceiver({ ...options, onTrack });
    await flush();
    receive({ kind: "offer", sdp: "offer-sdp" });
    await flush();
    lastPeer().ontrack?.({ track: { kind: "audio" } as MediaStreamTrack });
    expect(onTrack).not.toHaveBeenCalled();
  });

  it("starts a fresh connection when the main window restarts", async () => {
    const { options } = harness();
    const { receive } = createPipReceiver({ ...options, onTrack: vi.fn() });
    await flush();
    const first = lastPeer();
    first.signalingState = "have-local-offer";
    receive({ kind: "offer", sdp: "offer-2" });
    await flush();
    expect(first.closed).toBe(true);
    expect(FakePeer.instances).toHaveLength(2);
  });

  it("drops the picture when the main window says goodbye", async () => {
    const { options } = harness();
    const states: string[] = [];
    const { receive, transport } = createPipReceiver({
      ...options,
      onTrack: vi.fn(),
      onState: (state) => states.push(state),
    });
    await flush();
    receive({ kind: "bye" });
    await flush();
    expect(transport.state()).toBe("idle");
    expect(states.at(-1)).toBe("idle");
  });
});

describe("parseLoopbackSignal", () => {
  it("accepts every message the two windows send", () => {
    expect(parseLoopbackSignal({ kind: "ready" })).toEqual({ kind: "ready" });
    expect(parseLoopbackSignal({ kind: "bye" })).toEqual({ kind: "bye" });
    expect(parseLoopbackSignal({ kind: "offer", sdp: "v=0" })).toEqual({
      kind: "offer",
      sdp: "v=0",
    });
    expect(parseLoopbackSignal({ kind: "answer", sdp: "v=0" })).toEqual({
      kind: "answer",
      sdp: "v=0",
    });
    expect(parseLoopbackSignal({ kind: "ice", candidate: "host" })).toEqual({
      kind: "ice",
      candidate: "host",
      sdpMid: null,
      sdpMLineIndex: null,
    });
  });

  it("rejects anything else, including a cross-window forgery", () => {
    expect(parseLoopbackSignal(null)).toBeNull();
    expect(parseLoopbackSignal("offer")).toBeNull();
    expect(parseLoopbackSignal({ kind: "offer" })).toBeNull();
    expect(parseLoopbackSignal({ kind: "offer", sdp: "" })).toBeNull();
    expect(parseLoopbackSignal({ kind: "ice" })).toBeNull();
    expect(parseLoopbackSignal({ kind: "answer", sdp: 5 })).toBeNull();
  });
});

describe("LOOPBACK_PEER_CONFIG", () => {
  it("has no STUN or TURN server, so only host candidates are gathered", () => {
    expect(LOOPBACK_PEER_CONFIG.iceServers).toEqual([]);
  });
});

describe("loopbackSupported", () => {
  it("is false where the webview has no peer connections", () => {
    // jsdom has no RTCPeerConnection, which is the WebKitGTK case too.
    expect(loopbackSupported()).toBe(false);
  });

  it("is true when the constructor exists", () => {
    vi.stubGlobal("RTCPeerConnection", FakePeer);
    expect(loopbackSupported()).toBe(true);
  });
});
