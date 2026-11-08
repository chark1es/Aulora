import { describe, expect, it, vi } from "vitest";
import { PeerMesh, type PeerMeshHost } from "./peer-mesh";

/** The mesh stops sending/receiving audio while an SFU carries the call. */

function host(): PeerMeshHost {
  return {
    userId: "local",
    getCallId: () => "call-1",
    getIceServers: () => [],
    sendSignal: async () => null,
    ackSignals: async () => null,
    onError: () => undefined,
    onChange: () => undefined,
    getAudioTrack: () => null,
    getVideoTrack: () => null,
    isScreenSharing: () => false,
    getScreenProfile: () => ({ maxBitrate: 0, frameRate: 0 }),
    getCameraProfile: () => ({ maxBitrate: 0, frameRate: 0 }),
    getVideoCodec: () => "auto",
    onRemoteLevel: () => undefined,
  };
}

function fakePeer(track: MediaStreamTrack) {
  return {
    pc: {} as RTCPeerConnection,
    stream: { getAudioTracks: () => [track] } as unknown as MediaStream,
    initiator: true,
    pendingCandidates: [],
    connection: "connected" as const,
    levelUnsub: null,
    session: 1,
  };
}

describe("PeerMesh.setRemoteAudioEnabled", () => {
  it("silences and restores every remote audio track without dropping peers", () => {
    const mesh = new PeerMesh(host());
    const track = { kind: "audio", enabled: true } as unknown as MediaStreamTrack;
    mesh.peers.set("remote-1", fakePeer(track));

    mesh.setRemoteAudioEnabled(false);
    expect(track.enabled).toBe(false);
    expect(mesh.peers.has("remote-1")).toBe(true);

    mesh.setRemoteAudioEnabled(true);
    expect(track.enabled).toBe(true);
    expect(mesh.peers.has("remote-1")).toBe(true);
  });
});

describe("PeerMesh in-flight track updates", () => {
  it("does not touch the next call's peers when the call ends during a swap", async () => {
    const mesh = new PeerMesh(host());
    const track = { kind: "audio", enabled: true } as unknown as MediaStreamTrack;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const senderFor = (replace: () => Promise<void>) => ({
      track: null,
      replaceTrack: vi.fn(replace),
    });
    const oldFirst = senderFor(() => gate);
    const oldSecond = senderFor(async () => {});
    const next = senderFor(async () => {});
    const peerWith = (sender: ReturnType<typeof senderFor>) => ({
      ...fakePeer(track),
      audioTx: { sender, direction: "sendrecv" } as unknown as RTCRtpTransceiver,
    });
    mesh.peers.set("old-1", peerWith(oldFirst));
    mesh.peers.set("old-2", peerWith(oldSecond));

    // The update stops at the first peer's swap...
    const pending = mesh.applyAudioTrack(null);
    // ...the call ends and the next one gets a peer while it is suspended...
    mesh.peers.clear();
    mesh.peers.set("new-1", peerWith(next));
    release();
    await pending;

    // ...and the finished update must not reach the new peer.
    expect(next.replaceTrack).not.toHaveBeenCalled();
    expect(oldSecond.replaceTrack).toHaveBeenCalledWith(null);
  });
});
