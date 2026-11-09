import { type CallSignalRow, shouldOffer } from "@aulora/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rosterToCallView } from "../guest/guest-voice";
import { PeerMesh, type PeerMeshHost } from "./peer-mesh";

/**
 * Members and guests, each running the REAL PeerMesh (nothing about
 * reconcile/handleSignals is overridden) over a fake network and a fake
 * RTCPeerConnection, fed rosters in the exact shapes the server returns.
 *
 * The election: a member (web, any pair) uses the legacy `shouldOffer(self, remote)`
 * on account ids / guest session ids, exactly as mobile and released clients do.
 * A guest takes the server's `shouldOffer` bit for each MEMBER row of its roster,
 * which the backend computes as `!shouldOffer(M, G)`, and uses the core comparator
 * against other guests. The question is only whether exactly one side offers.
 */

type Side = "member" | "guest";
let creating: Side = "member";
const pcs: FakePc[] = [];
class FakePc {
  readonly owner: Side = creating;
  offers = 0;
  answers = 0;
  signalingState = "stable";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  connectionState = "new";
  iceConnectionState = "new";
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  oniceconnectionstatechange: unknown = null;
  private readonly transceivers: unknown[] = [];

  constructor() {
    pcs.push(this);
  }

  addTransceiver(kind: string) {
    const transceiver = {
      direction: "sendrecv",
      sender: {
        track: null,
        replaceTrack: () => Promise.resolve(),
        getParameters: () => ({ encodings: [] }),
        setParameters: () => Promise.resolve(),
      },
      receiver: { track: { kind } },
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() {
    return this.transceivers;
  }

  createOffer() {
    this.offers += 1;
    return Promise.resolve({ type: "offer", sdp: "v=0\r\n" });
  }

  createAnswer() {
    this.answers += 1;
    return Promise.resolve({ type: "answer", sdp: "v=0\r\n" });
  }

  setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    return Promise.resolve();
  }

  setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    if (description.type === "offer" && this.transceivers.length === 0) {
      this.addTransceiver("audio");
      this.addTransceiver("video");
    }
    return Promise.resolve();
  }

  addIceCandidate() {
    return Promise.resolve();
  }
  restartIce() {}
  close() {}

  get connected(): boolean {
    return (
      this.localDescription !== null &&
      this.remoteDescription !== null &&
      this.signalingState === "stable"
    );
  }
}

class FakeStream {
  private readonly tracks: unknown[] = [];
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  removeTrack() {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return [];
  }
}

beforeEach(() => {
  pcs.length = 0;
  vi.stubGlobal("RTCPeerConnection", FakePc);
  vi.stubGlobal("MediaStream", FakeStream);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** `shouldOffer` exactly as apps/mobile/src/lib/voice/call-engine.ts uses it (lines ~72 and ~308). */
function mobileOffers(selfUserId: string, remoteUserId: string): boolean {
  return selfUserId < remoteUserId;
}

/** What the backend puts on a member row of the guest roster. */
const serverBit = (memberUserId: string, guestSessionId: string) =>
  !shouldOffer(memberUserId, guestSessionId);

function bareHost(userId: string, onSend: (toUserId: string, kind: string) => void): PeerMeshHost {
  return {
    userId,
    getCallId: () => "call-1",
    getIceServers: () => [],
    sendSignal: (signal) => {
      onSend(signal.toUserId, signal.kind);
      return Promise.resolve(null);
    },
    ackSignals: () => Promise.resolve(null),
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

/** The server's guest roster, built through the real guest view-model. */
function guestRoster(args: {
  guestSessionId: string;
  members: { memberUserId: string; memberKey: string; withBit?: boolean }[];
  otherGuests?: string[];
}) {
  return rosterToCallView({
    callId: "call-1",
    callStatus: "active",
    scheduledCallId: null,
    transcribing: false,
    transcriptionSessionId: null,
    participants: [
      ...args.members.map(({ memberUserId, memberKey, withBit }) => ({
        participantKey: memberKey,
        isGuest: false,
        displayName: "Sam",
        muted: false,
        video: false,
        joinedAt: 1,
        session: 3,
        ...(withBit === false ? {} : { shouldOffer: serverBit(memberUserId, args.guestSessionId) }),
      })),
      {
        participantKey: args.guestSessionId,
        isGuest: true,
        displayName: "Alex",
        muted: false,
        video: false,
        joinedAt: 2,
        session: 5,
      },
      ...(args.otherGuests ?? []).map((id) => ({
        participantKey: id,
        isGuest: true,
        displayName: "Kim",
        muted: false,
        video: false,
        joinedAt: 3,
        session: 5,
      })),
    ],
  }).participants;
}

interface Triple {
  /** The member's account id. */
  readonly M: string;
  /** The guest's session id. */
  readonly G: string;
  /** The member's opaque per-call key, which is all the guest knows the member by. */
  readonly K: string;
}

function connect({ M, G, K }: Triple) {
  const memberSession = 3;
  const guestSession = 5;
  const ids = { next: 0 };
  const meshes = {} as Record<Side, PeerMesh>;
  const sent: { from: Side; kind: string }[] = [];

  function host(side: Side): PeerMeshHost {
    const self = side === "member" ? M : G;
    return {
      ...bareHost(self, () => undefined),
      sendSignal: (signal) => {
        const other: Side = side === "member" ? "guest" : "member";
        sent.push({ from: side, kind: signal.kind });
        // The server addresses each side by the key that side knows the sender by.
        const row: CallSignalRow = {
          id: `sig-${ids.next++}`,
          callId: "call-1",
          fromUserId: side === "member" ? K : G,
          toUserId: other === "member" ? M : G,
          kind: signal.kind,
          payload: signal.payload,
          createdAt: 1,
          session: side === "member" ? memberSession : guestSession,
        };
        creating = other;
        void Promise.resolve().then(() => meshes[other].handleSignals([row]));
        return Promise.resolve(null);
      },
      onError: (message) => {
        throw new Error(message);
      },
    };
  }

  meshes.member = new PeerMesh(host("member"));
  meshes.guest = new PeerMesh(host("guest"));
  creating = "member";
  // The member's roster (calls.get): the guest is addressed by its session id.
  meshes.member.reconcile([
    { userId: M, session: memberSession },
    { userId: G, session: guestSession, isGuest: true },
  ]);
  creating = "guest";
  meshes.guest.reconcile(
    guestRoster({ guestSessionId: G, members: [{ memberUserId: M, memberKey: K }] }),
  );
  return { meshes, sent };
}

/** Deterministic pseudo-random ids, so a failure is reproducible. */
function triples(count: number): Triple[] {
  let seed = 20_260_509;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const id = (prefix: string) => `${prefix}${Math.floor(random() * 1e9).toString(36)}`;
  const result: Triple[] = [];
  // Every ordering of the three ids, including the ones the key-based rule broke
  // (K < G < M, M < G < K, ...), with fixed names so the orderings are certain.
  const names = ["a-id", "m-id", "z-id"];
  for (const M of names) {
    for (const G of names) {
      for (const K of names) {
        if (new Set([M, G, K]).size === 3) {
          result.push({ M, G, K });
        }
      }
    }
  }
  while (result.length < count) {
    const triple = { M: id("u"), G: id("g"), K: id("k") };
    if (new Set([triple.M, triple.G, triple.K]).size === 3) {
      result.push(triple);
    }
  }
  return result;
}

describe("member <-> guest election (members use the legacy rule, guests take the server's bit)", () => {
  it("has exactly one offerer, who is the one the legacy rule names, and the pair connects", async () => {
    for (const triple of triples(60)) {
      pcs.length = 0;
      const { sent } = connect(triple);
      await settle();
      const offers = sent.filter((signal) => signal.kind === "offer");
      expect(offers, JSON.stringify(triple)).toHaveLength(1);
      // The legacy rule decides, on the member's own ids.
      expect(offers[0]?.from).toBe(shouldOffer(triple.M, triple.G) ? "member" : "guest");
      expect(pcs.every((pc) => pc.connected)).toBe(true);
    }
  });

  it("agrees with a verbatim copy of mobile's predicate for the member side", async () => {
    for (const { M, G, K } of triples(300)) {
      pcs.length = 0;
      creating = "guest";
      const guestOffers: string[] = [];
      const guest = new PeerMesh(bareHost(G, (to, kind) => guestOffers.push(`${to}:${kind}`)));
      guest.reconcile(
        guestRoster({ guestSessionId: G, members: [{ memberUserId: M, memberKey: K }] }),
      );
      await Promise.resolve();
      // Mobile's predicate for the member toward this guest: remote id is the guest session id.
      const memberOffers = mobileOffers(M, G);
      const guestOffersToMember = pcs.length > 0;
      expect(guestOffersToMember !== memberOffers, JSON.stringify({ M, G, K })).toBe(true);
      expect(guestOffers.every((entry) => entry.startsWith(`${K}:`))).toBe(true);
      guest.reset();
    }
  });

  it("answers a renegotiation by the same decision the roster gave", async () => {
    // Bit true: the guest created the offer toward the member and answers its renegotiation.
    const bitTrue = { M: "z-id", G: "a-id", K: "m-id" };
    expect(serverBit(bitTrue.M, bitTrue.G)).toBe(true);
    // Bit false: the member offers; the guest never takes the offerer branch.
    const bitFalse = { M: "a-id", G: "z-id", K: "m-id" };
    expect(serverBit(bitFalse.M, bitFalse.G)).toBe(false);
    for (const { triple, answers } of [
      { triple: bitTrue, answers: 1 },
      { triple: bitFalse, answers: 1 },
    ]) {
      pcs.length = 0;
      const { meshes } = connect(triple);
      await settle();
      const before = pcs.reduce((total, pc) => total + pc.answers, 0);
      expect(before).toBe(answers);
      creating = "guest";
      await meshes.guest.handleSignals([
        {
          id: "renego",
          callId: "call-1",
          fromUserId: triple.K,
          toUserId: triple.G,
          kind: "renegotiate",
          payload: JSON.stringify({ type: "offer", sdp: "v=0\r\n" }),
          createdAt: 9,
          session: 3,
        },
      ]);
      await settle();
      const after = pcs.reduce((total, pc) => total + pc.answers, 0);
      const guestSide = pcs.find((pc) => pc.owner === "guest");
      // The guest answers the renegotiation exactly when the server told it to offer.
      expect(guestSide !== undefined).toBe(true);
      expect(after - before).toBe(serverBit(triple.M, triple.G) ? 1 : 0);
    }
  });

  it("never crashes when an older server sends no bit, and falls back to the legacy rule on the ids it has", async () => {
    const G = "g-id";
    const K = "k-key";
    const sent: string[] = [];
    creating = "guest";
    const guest = new PeerMesh(bareHost(G, (to, kind) => sent.push(`${to}:${kind}`)));
    guest.reconcile(
      guestRoster({
        guestSessionId: G,
        members: [{ memberUserId: "u", memberKey: K, withBit: false }],
      }),
    );
    await settle();
    // Legacy rule on (self id, the id the roster gives for the member).
    expect(sent.includes(`${K}:offer`)).toBe(shouldOffer(G, K));
  });
});

describe("guest <-> guest election (both web, core comparator)", () => {
  it("is complementary for every pair", async () => {
    for (const [a, b] of [
      ["g-a", "g-b"],
      ["g-z", "g-b"],
      ["g1", "g2"],
    ] as const) {
      const offers: string[] = [];
      const meshA = new PeerMesh(bareHost(a, (to) => offers.push(`A>${to}`)));
      const meshB = new PeerMesh(bareHost(b, (to) => offers.push(`B>${to}`)));
      creating = "guest";
      pcs.length = 0;
      meshA.reconcile(guestRoster({ guestSessionId: a, members: [], otherGuests: [b] }));
      meshB.reconcile(guestRoster({ guestSessionId: b, members: [], otherGuests: [a] }));
      await settle();
      expect(offers).toHaveLength(1);
      expect(offers[0]).toBe(shouldOffer(a, b) ? `A>${b}` : `B>${a}`);
    }
  });
});

describe("member <-> member pairs keep the legacy account-id election", () => {
  it("agrees with mobile's comparator on many random pairs", async () => {
    for (const { M: webUser, G: mobileUser } of triples(150)) {
      pcs.length = 0;
      creating = "member";
      const web = new PeerMesh(bareHost(webUser, () => undefined));
      web.reconcile([
        { userId: webUser, session: 1 },
        { userId: mobileUser, session: 1 },
      ]);
      await Promise.resolve();
      expect(pcs.length > 0 !== mobileOffers(mobileUser, webUser)).toBe(true);
      expect(pcs.length > 0).toBe(mobileOffers(webUser, mobileUser));
      web.reset();
    }
  });
});

describe("a call with two members and a guest", () => {
  it("yields exactly one offer per pair for every ordering", async () => {
    const names = ["a-id", "m-id", "z-id", "b-id", "y-id"];
    let checked = 0;
    for (const a of names) {
      for (const b of names) {
        for (const g of names) {
          for (const [ak, bk] of [
            ["k1", "k2"],
            ["k2", "k1"],
          ] as const) {
            if (new Set([a, b, g]).size !== 3) {
              continue;
            }
            const offers = new Set<string>();
            const record = (from: string, toIdentity: string) => {
              const pair = [from, toIdentity].sort().join("<->");
              offers.add(`${pair}|${from}`);
              expect([...offers].filter((entry) => entry.startsWith(`${pair}|`))).toHaveLength(1);
            };
            // Each viewer addresses the others differently; map back to identities.
            const identity: Record<string, Record<string, string>> = {
              A: { [b]: "B", [g]: "G" },
              B: { [a]: "A", [g]: "G" },
              G: { [ak]: "A", [bk]: "B" },
            };
            pcs.length = 0;
            const meshes = {
              A: new PeerMesh(bareHost(a, (to) => record("A", identity.A?.[to] ?? to))),
              B: new PeerMesh(bareHost(b, (to) => record("B", identity.B?.[to] ?? to))),
              G: new PeerMesh(bareHost(g, (to) => record("G", identity.G?.[to] ?? to))),
            };
            const memberView = [
              { userId: a, session: 1 },
              { userId: b, session: 1 },
              { userId: g, session: 1, isGuest: true },
            ];
            creating = "member";
            meshes.A.reconcile(memberView);
            meshes.B.reconcile(memberView);
            meshes.G.reconcile(
              guestRoster({
                guestSessionId: g,
                members: [
                  { memberUserId: a, memberKey: ak },
                  { memberUserId: b, memberKey: bk },
                ],
              }),
            );
            await settle();
            const pairs = [...offers].map((entry) => entry.split("|")[0]);
            expect([...new Set(pairs)].sort()).toEqual(["A<->B", "A<->G", "B<->G"]);
            expect(offers.size).toBe(3);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
