import { describe, expect, it } from "vitest";
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
