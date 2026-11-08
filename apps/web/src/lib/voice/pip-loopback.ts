/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
/**
 * The call window's video transport.
 *
 * A second webview cannot be handed a `MediaStream`, so the main window opens a
 * *loopback* peer connection to it: the two peer connections are in the same
 * process on the same machine, no ICE server is configured, and only host
 * candidates are exchanged. What crosses the window boundary is one SDP
 * offer/answer and a handful of ICE candidates, all over Tauri events
 * (`PIP_SIGNAL_EVENT`).
 *
 * Only the picture moves. The sender adds exactly one *video* transceiver; it
 * never adds audio, so the call's audio keeps playing from the main window's
 * `RemoteAudio` element and the floating window stays silent. The receiver
 * refuses any audio track that arrives for the same reason.
 *
 * The state machines are plain functions over an injected peer-connection
 * factory, so the signalling can be tested without a browser.
 */

/**
 * One signalling message. Kept JSON-only: it crosses a webview boundary, where
 * every payload is parsed again on the other side.
 */
export type LoopbackSignal =
  | { readonly kind: "ready" }
  | { readonly kind: "offer"; readonly sdp: string }
  | { readonly kind: "answer"; readonly sdp: string }
  | {
      readonly kind: "ice";
      readonly candidate: string;
      readonly sdpMid: string | null;
      readonly sdpMLineIndex: number | null;
    }
  | { readonly kind: "bye" };

export type LoopbackState = "idle" | "connecting" | "connected" | "failed" | "closed";

export interface LoopbackOptions {
  /** Posts one signalling message to the other webview. */
  readonly send: (signal: LoopbackSignal) => void;
  /** Called whenever the connection state changes. */
  readonly onState?: (state: LoopbackState) => void;
  /** Injected in tests; defaults to a host-candidate-only peer connection. */
  readonly createPeer?: () => RTCPeerConnection;
}

/** Whether this webview can carry video over a peer connection at all. */
export function loopbackSupported(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

/**
 * Host candidates only: no STUN and no TURN, because both peer connections are
 * in the same app on the same machine. Nothing about the call leaves it.
 */
export const LOOPBACK_PEER_CONFIG: RTCConfiguration = {
  iceServers: [],
  bundlePolicy: "max-bundle",
};

function defaultPeer(): RTCPeerConnection {
  return new RTCPeerConnection(LOOPBACK_PEER_CONFIG);
}

function peer(options: LoopbackOptions): RTCPeerConnection {
  return (options.createPeer ?? defaultPeer)();
}

/** Reads a signalling payload off the event bus, or `null` when it is not one. */
export function parseLoopbackSignal(value: unknown): LoopbackSignal | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const signal = value as {
    readonly kind?: unknown;
    readonly sdp?: unknown;
    readonly candidate?: unknown;
    readonly sdpMid?: unknown;
    readonly sdpMLineIndex?: unknown;
  };
  switch (signal.kind) {
    case "ready":
    case "bye":
      return { kind: signal.kind };
    case "offer":
    case "answer":
      return typeof signal.sdp === "string" && signal.sdp.length > 0
        ? { kind: signal.kind, sdp: signal.sdp }
        : null;
    case "ice":
      return typeof signal.candidate === "string"
        ? {
            kind: "ice",
            candidate: signal.candidate,
            sdpMid: typeof signal.sdpMid === "string" ? signal.sdpMid : null,
            sdpMLineIndex: typeof signal.sdpMLineIndex === "number" ? signal.sdpMLineIndex : null,
          }
        : null;
    default:
      return null;
  }
}

/**
 * One signalling payload for a new ICE candidate. `null` for the end-of-
 * candidates marker, which nothing needs (`trickle` ends when the connection
 * settles).
 */
export function iceSignal(candidate: RTCIceCandidate | null | undefined): LoopbackSignal | null {
  if (candidate === null || candidate === undefined || candidate.candidate === "") {
    return null;
  }
  return {
    kind: "ice",
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
  };
}

function iceInit(signal: Extract<LoopbackSignal, { kind: "ice" }>): RTCIceCandidateInit {
  return {
    candidate: signal.candidate,
    sdpMid: signal.sdpMid,
    sdpMLineIndex: signal.sdpMLineIndex,
  };
}

function localSdp(description: RTCSessionDescription | null, fallback: string): string {
  return description?.sdp ?? fallback;
}

function connectionStateOf(peer: RTCPeerConnection): LoopbackState {
  switch (peer.connectionState) {
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "disconnected":
      return "connecting";
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
}

/** The main window's half: sends the chosen video track. */
export interface PipSender {
  /** Swaps the picture without renegotiating; `null` pauses it. */
  setTrack(track: MediaStreamTrack | null): Promise<void>;
  /** Builds a fresh connection and offers again (window reopened or reloaded). */
  restart(): void;
  /** Tells the other side and closes. */
  close(): void;
  state(): LoopbackState;
}

export interface PipSenderHandle {
  readonly transport: PipSender;
  /** Feeds one signal received from the call window. */
  readonly receive: (signal: LoopbackSignal) => void;
}

/**
 * Starts the main window's sender. The first offer goes out immediately; the
 * call window answers on its own clock, and asks for a fresh offer with
 * `ready` whenever it (re)loads.
 */
export function createPipSender(
  options: LoopbackOptions & { readonly track?: MediaStreamTrack | null },
): PipSenderHandle {
  let closed = false;
  let peerConnection: RTCPeerConnection | null = null;
  let videoSender: RTCRtpSender | null = null;
  let track: MediaStreamTrack | null = options.track ?? null;
  let state: LoopbackState = "idle";
  let pendingIce: RTCIceCandidateInit[] = [];
  let generation = 0;

  const report = (next: LoopbackState) => {
    if (state !== next) {
      state = next;
      options.onState?.(next);
    }
  };

  const teardown = () => {
    generation += 1;
    pendingIce = [];
    videoSender = null;
    if (peerConnection !== null) {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      try {
        peerConnection.close();
      } catch {
        // Closing a connection that never connected is harmless.
      }
      peerConnection = null;
    }
  };

  const drainIce = () => {
    const connection = peerConnection;
    if (connection === null) {
      return;
    }
    const queued = pendingIce;
    pendingIce = [];
    for (const candidate of queued) {
      void connection.addIceCandidate(candidate).catch(() => {
        // A candidate from a connection that has since gone away is noise.
      });
    }
  };

  const offer = async () => {
    const mine = generation;
    const connection = peer(options);
    peerConnection = connection;
    connection.onicecandidate = (event) => {
      const signal = iceSignal(event.candidate);
      if (signal !== null) {
        options.send(signal);
      }
    };
    connection.onconnectionstatechange = () => {
      const next = connectionStateOf(connection);
      if (next === "failed") {
        report("failed");
      } else if (next === "connected") {
        report("connected");
      } else if (next !== "closed") {
        report("connecting");
      }
    };
    // One video transceiver, never audio: the call's audio stays where it is.
    videoSender = connection.addTransceiver("video", { direction: "sendonly" }).sender;
    if (track !== null) {
      await videoSender.replaceTrack(track);
    }
    const description = await connection.createOffer();
    await connection.setLocalDescription(description);
    if (mine !== generation) {
      return;
    }
    report("connecting");
    options.send({
      kind: "offer",
      sdp: localSdp(connection.localDescription, description.sdp ?? ""),
    });
  };

  const restart = () => {
    if (closed) {
      return;
    }
    teardown();
    report("connecting");
    void offer().catch(() => {
      report("failed");
    });
  };

  const handle = async (signal: LoopbackSignal): Promise<void> => {
    if (closed) {
      return;
    }
    const connection = peerConnection;
    switch (signal.kind) {
      case "ready":
        // A new call window (opened, reloaded or reopened) needs a new offer.
        restart();
        return;
      case "answer":
        if (connection === null || connection.signalingState !== "have-local-offer") {
          return;
        }
        await connection.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        drainIce();
        return;
      case "ice":
        if (connection === null) {
          return;
        }
        if (connection.remoteDescription === null) {
          pendingIce.push(iceInit(signal));
          return;
        }
        await connection.addIceCandidate(iceInit(signal));
        return;
      case "offer":
        // The caller is the one that offers; an offer here is a stale message.
        return;
      case "bye":
        teardown();
        report("idle");
        return;
    }
  };

  const transport: PipSender = {
    async setTrack(next) {
      track = next;
      const sender = videoSender;
      if (closed || sender === null) {
        return;
      }
      try {
        await sender.replaceTrack(next);
      } catch {
        // A track that cannot be swapped (different codec) needs a new offer;
        // neither side should die because of it.
        report("failed");
      }
    },
    restart,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      options.send({ kind: "bye" });
      teardown();
      report("closed");
    },
    state() {
      return state;
    },
  };

  restart();

  return {
    transport,
    receive(signal) {
      void handle(signal).catch(() => {
        report("failed");
      });
    },
  };
}

/** The call window's half: answers and hands over the one video track. */
export interface PipReceiver {
  restart(): void;
  close(): void;
  state(): LoopbackState;
}

export interface PipReceiverHandle {
  readonly transport: PipReceiver;
  readonly receive: (signal: LoopbackSignal) => void;
}

/**
 * Starts the call window's receiver. It announces itself with `ready` so the
 * main window offers even when this webview loaded after the call did, and
 * attaches the first video track it receives. Audio is never attached.
 */
export function createPipReceiver(
  options: LoopbackOptions & { readonly onTrack: (track: MediaStreamTrack) => void },
): PipReceiverHandle {
  let closed = false;
  let peerConnection: RTCPeerConnection | null = null;
  let state: LoopbackState = "idle";
  let pendingIce: RTCIceCandidateInit[] = [];
  let generation = 0;

  const report = (next: LoopbackState) => {
    if (state !== next) {
      state = next;
      options.onState?.(next);
    }
  };

  const teardown = () => {
    generation += 1;
    pendingIce = [];
    if (peerConnection !== null) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      try {
        peerConnection.close();
      } catch {
        // Closing a connection that never connected is harmless.
      }
      peerConnection = null;
    }
  };

  const drainIce = () => {
    const connection = peerConnection;
    if (connection === null) {
      return;
    }
    const queued = pendingIce;
    pendingIce = [];
    for (const candidate of queued) {
      void connection.addIceCandidate(candidate).catch(() => {
        // Stale candidates are noise.
      });
    }
  };

  const listen = () => {
    const connection = peer(options);
    peerConnection = connection;
    connection.ontrack = (event) => {
      const received = event.track;
      // Only the picture moves across the window boundary.
      if (received.kind !== "video") {
        return;
      }
      options.onTrack(received);
      report("connected");
    };
    connection.onicecandidate = (event) => {
      const signal = iceSignal(event.candidate);
      if (signal !== null) {
        options.send(signal);
      }
    };
    connection.onconnectionstatechange = () => {
      const next = connectionStateOf(connection);
      if (next === "failed") {
        report("failed");
      } else if (next === "connected") {
        report("connected");
      }
    };
    options.send({ kind: "ready" });
  };

  const answer = async (signal: Extract<LoopbackSignal, { kind: "offer" }>) => {
    const mine = generation;
    let connection = peerConnection;
    if (
      connection === null ||
      (connection.signalingState !== "stable" && connection.signalingState !== "have-remote-offer")
    ) {
      // A second offer while one is half-answered means the main window
      // restarted; start over rather than fight the old connection.
      teardown();
      listen();
      connection = peerConnection;
    }
    if (connection === null) {
      return;
    }
    await connection.setRemoteDescription({ type: "offer", sdp: signal.sdp });
    const description = await connection.createAnswer();
    await connection.setLocalDescription(description);
    if (mine !== generation) {
      return;
    }
    report("connecting");
    options.send({
      kind: "answer",
      sdp: localSdp(connection.localDescription, description.sdp ?? ""),
    });
    drainIce();
  };

  const handle = async (signal: LoopbackSignal): Promise<void> => {
    if (closed) {
      return;
    }
    switch (signal.kind) {
      case "offer":
        await answer(signal);
        return;
      case "ice": {
        const connection = peerConnection;
        if (connection === null) {
          return;
        }
        if (connection.remoteDescription === null) {
          pendingIce.push(iceInit(signal));
          return;
        }
        await connection.addIceCandidate(iceInit(signal));
        return;
      }
      case "bye":
        teardown();
        report("idle");
        return;
      case "ready":
      case "answer":
        // Only the caller offers and only this side answers.
        return;
    }
  };

  const transport: PipReceiver = {
    restart() {
      if (closed) {
        return;
      }
      teardown();
      report("connecting");
      listen();
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      options.send({ kind: "bye" });
      teardown();
      report("closed");
    },
    state() {
      return state;
    },
  };

  transport.restart();

  return {
    transport,
    receive(signal) {
      void handle(signal).catch(() => {
        report("failed");
      });
    },
  };
}
