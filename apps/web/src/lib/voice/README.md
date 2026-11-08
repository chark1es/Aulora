# Call media paths

Calls are WebRTC. Two transports exist; the peer mesh is the default and the
fallback, and the optional LiveKit server adds an SFU path for large calls and
screen shares.

## Peer mesh (default)

`peer-mesh.ts` opens one `RTCPeerConnection` per remote participant with a
persistent audio and video transceiver. Each client encodes and uploads one copy
of its camera per peer, so a 720p30 camera at 1.5 Mbps costs `N-1` times that
upload. This is the lowest-latency path and needs no media server, which is why
it stays the default and the fallback. TURN (`ice-servers.ts`,
`turn.credentials` in the backend) relays media when peers cannot connect
directly.

## Streaming server (optional)

`sfu-room.ts` carries screen shares whenever the workspace has `LIVEKIT_*`
configured. `sfu-call.ts` carries the microphone and camera for a large call:

- The mesh is used unless the call has **more than `SFU_CALL_THRESHOLD` (4)**
  participants (`sfu-call-policy.ts`).
- The workspace must have a streaming server this member can join
  (`callStreaming.access` with `scope: "call"` returns a grant).
- **Every** participant must advertise the additive `sfu-call` capability on its
  roster row. One mobile or older client keeps the whole call on the mesh, so a
  mixed room never splits its media across two paths.
- A client that cannot join the server (unreachable, rejected grant, or a lost
  connection) withdraws its capability on the roster, which returns every
  client to the mesh. A room never ends up with half its audio on the SFU and
  the other half on the mesh. The remaining call runs on the mesh.
- `SFU_CALL_ENABLED` in `sfu-call-policy.ts` is the kill switch; set it to
  `false` to keep every call on the mesh.

The call's audio and camera use their own room (`call_<id>_media`), separate
from the screen-share room (`call_<id>`). A device can therefore hold both
connections without a participant-identity clash.

### Hand-over

Crossing the threshold does not drop the call:

1. The engine asks the backend once per call for a `scope: "call"` grant.
2. It opens the media room with a 4 s timeout (`SFU_CONNECT_TIMEOUT_MS`).
   Failure leaves the call untouched on the mesh and backs off before retrying.
3. Only after the room is connected and the microphone is published does the
   engine stop the mesh path: local audio is replaced with `null`, remote mesh
   audio tracks are disabled (`PeerMesh.setRemoteAudioEnabled`), and video
   senders are cleared. Nothing is heard or uploaded twice.
4. If the room later disconnects, the engine re-enables mesh audio, re-attaches
   the microphone and camera, and continues the call on the mesh.
5. Dropping back below the threshold, or gaining a participant without the
   capability, performs the same mesh return.

Mute, push-to-talk, deafen and the speaking indicator are unchanged: the local
microphone track is the one published (so `track.enabled` still gates it), the
hidden audio elements still play `remoteStreams`, and audio levels come from
the same meter on the SFU's per-user stream.

### Encoding

- Microphone: ~32 kbps Opus, DTX and RED.
- Camera: three simulcast layers — 1080p30/2.5 Mbps, 540p15/700 kbps,
  270p15/200 kbps — with `dynacast`, so only watched layers are encoded.
- Subscribers: `adaptiveStream: true` and `attachRemoteVideo` binds the tile's
  `<video>` element. The SDK cannot size a `srcObject`-only element, so the new
  path attaches the real tile element; the mesh path keeps using `srcObject`.
- Token: 4 h (`SFU_CALL_TOKEN_TTL_SECONDS`), re-minted five minutes before
  expiry and used to reconnect so a long call can survive a network blip.

## LiveKit server notes

`infra/docker/livekit/livekit.yaml` runs the bundled server:

- `rtc.tcp_port: 7881` and `rtc.udp_port: 7882` are one port each; keep them and
  publish both on the host.
- Behind 1:1 NAT, replace `use_external_ip` with an explicit `rtc.node_ip` set to
  the address clients can reach.
- For networks that block UDP, enable LiveKit's built-in TURN (`turn.enabled`,
  `turn.domain`, `turn.tls_port: 443`, certificate files). That is an
  alternative to the bundled coturn profile; either works, and the backend's
  `TURN_*` settings only describe the coturn-style relay.
