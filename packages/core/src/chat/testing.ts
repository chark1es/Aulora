/**
 * Test doubles for the chat session.
 *
 * `createMemoryMlsEngine()` is a real two-party-capable MLS engine stand-in
 * with the same observable contract as `@aulora/crypto`'s `MlsEngine`
 * (epochs, add/remove, welcome exchange, forward secrecy around removed
 * members) but with no cryptography. `createMockPort()` is an in-memory
 * `ChatPort` plus subscription plumbing so session behaviour can be tested
 * without a backend.
 */

import type { MlsEngine, MlsMember } from "@aulora/crypto";
import { utf8Decode, utf8Encode } from "@aulora/crypto";
import type {
  ChannelSummary,
  ChatPort,
  ChatSubscriptions,
  JoinIntentRow,
  MessagePayload,
  PresenceRow,
  ReactionRow,
  ReadStateRow,
  TypingRow,
} from "./port.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface MemoryGroup {
  members: { identity: string; signingKey: string }[];
  epoch: bigint;
}

/** Formats a raw secret key into the MLS identity string for a device. */
function identityFor(secret: string): { credential: string; groupId: string } {
  return { credential: `aulora:device:${secret}`, groupId: secret };
}

/** A decryption failure for a member who was removed from the group. */
export class MemoryDecryptError extends Error {
  constructor() {
    super("not a group member");
    this.name = "MemoryDecryptError";
  }
}

class MemoryEngine implements MlsEngine {
  private readonly secret: string;
  private group: MemoryGroup | undefined;
  private readonly onVoid: () => void;

  constructor(secret: string, onVoid: () => void) {
    this.secret = secret;
    this.onVoid = onVoid;
  }

  get identity(): string {
    return identityFor(this.secret).credential;
  }

  private requireGroup(): MemoryGroup {
    if (!this.group) {
      throw new Error("no active MLS group; create or join one first");
    }
    return this.group;
  }

  private isMember(): boolean {
    const group = this.requireGroup();
    return group.members.some((member) => member.identity === this.identity);
  }

  async generateKeyPackage(): Promise<Uint8Array> {
    return encoder.encode(this.secret);
  }

  async createGroup(_groupId: Uint8Array, _keyPackage: Uint8Array): Promise<void> {
    this.onVoid();
    this.group = {
      members: [{ identity: this.identity, signingKey: this.secret }],
      epoch: 0n,
    };
  }

  async joinFromWelcome(welcome: Uint8Array, keyPackage: Uint8Array): Promise<void> {
    this.onVoid();
    const payload = JSON.parse(decoder.decode(welcome)) as {
      epoch: string;
      members: { identity: string; signingKey: string }[];
    };
    const mySecret = decoder.decode(keyPackage);
    const invited = payload.members.some((member) => member.signingKey === mySecret);
    if (!invited) {
      throw new Error("welcome does not address this KeyPackage");
    }
    this.group = {
      members: payload.members.slice(),
      epoch: BigInt(payload.epoch),
    };
  }

  async addMembers(keyPackages: readonly Uint8Array[]): Promise<{
    commit: Uint8Array;
    welcome: Uint8Array;
  }> {
    this.onVoid();
    const group = this.requireGroup();
    const additions = keyPackages.map((keyPackage) => {
      const secret = decoder.decode(keyPackage);
      return { identity: identityFor(secret).credential, signingKey: secret };
    });
    const next = { members: [...group.members, ...additions], epoch: group.epoch + 1n };
    this.group = next;
    const commit = encoder.encode(
      JSON.stringify({ members: next.members, epoch: next.epoch.toString() }),
    );
    const welcome = encoder.encode(
      JSON.stringify({ members: next.members, epoch: next.epoch.toString() }),
    );
    return { commit, welcome };
  }

  async removeMembers(leafIndexes: readonly number[]): Promise<Uint8Array> {
    this.onVoid();
    const group = this.requireGroup();
    const removed = new Set(leafIndexes);
    const next = {
      members: group.members.filter((_, index) => !removed.has(index)),
      epoch: group.epoch + 1n,
    };
    this.group = next;
    return encoder.encode(JSON.stringify({ members: next.members, epoch: next.epoch.toString() }));
  }

  async processCommit(commit: Uint8Array): Promise<void> {
    this.onVoid();
    this.requireGroup();
    const payload = JSON.parse(decoder.decode(commit)) as {
      members: { identity: string; signingKey: string }[];
      epoch: string;
    };
    this.group = { members: payload.members, epoch: BigInt(payload.epoch) };
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const group = this.requireGroup();
    if (!this.isMember()) {
      throw new MemoryDecryptError();
    }
    return encoder.encode(
      JSON.stringify({
        group: group.members.map((m) => m.signingKey),
        body: decoder.decode(plaintext),
      }),
    );
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const group = this.requireGroup();
    const payload = JSON.parse(decoder.decode(ciphertext)) as {
      group: string[];
      body: string;
    };
    if (!payload.group.includes(this.secret) || !this.isMember()) {
      throw new MemoryDecryptError();
    }
    void group;
    return encoder.encode(payload.body);
  }

  async epoch(): Promise<bigint> {
    return this.requireGroup().epoch;
  }

  async members(): Promise<readonly MlsMember[]> {
    const group = this.requireGroup();
    return group.members.map((member, leafIndex) => ({ leafIndex, identity: member.identity }));
  }

  async exportState(): Promise<Uint8Array> {
    const group = this.requireGroup();
    return encoder.encode(
      JSON.stringify({ members: group.members, epoch: group.epoch.toString() }),
    );
  }

  async importState(state: Uint8Array): Promise<void> {
    const parsed = JSON.parse(decoder.decode(state)) as {
      members: { identity: string; signingKey: string }[];
      epoch: string;
    };
    this.group = { members: parsed.members, epoch: BigInt(parsed.epoch) };
  }
}

export interface MemoryEngineHandle {
  readonly engine: MlsEngine;
  /** Devices this engine has seen and could build a group for. */
  readonly registry: MemoryEngineRegistry;
}

/** Creates a pair of engines that share a registry so add/join line up. */
export class MemoryEngineRegistry {
  private readonly devices: MlsEngine[] = [];

  create(secret: string): MlsEngine {
    const engine = new MemoryEngine(secret, () => {
      if (!this.devices.includes(engine)) {
        this.devices.push(engine);
      }
    });
    return engine;
  }
}

export function createMemoryMlsEngine(secret: string): MlsEngine {
  return new MemoryEngine(secret, () => {});
}

export interface MockPortState {
  readonly calls: { method: string; args: unknown }[];
  readonly channels: Map<string, ChannelSummary>;
  readonly messages: Map<string, MessagePayload>;
  readonly commits: Map<
    string,
    { id: string; epoch: number; commitCiphertext: string; welcomeCiphertext: string | null }[]
  >;
  readonly joinIntents: Map<string, JoinIntentRow[]>;
  readonly keyPackages: Map<string, string[]>;
  readonly reactions: Map<string, ReactionRow[]>;
  readonly presence: PresenceRow[];
  readonly typing: Map<string, TypingRow[]>;
  readonly readStates: Map<string, ReadStateRow>;
  readonly members: Map<string, string[]>;
  deviceId: string;
}

export interface MockPort extends ChatPort, ChatSubscriptions {
  readonly state: MockPortState;
}

let messageSeq = 0;
let entitySeq = 0;

function nextId(prefix: string): string {
  entitySeq += 1;
  return `${prefix}-${entitySeq}`;
}

/**
 * In-memory {@link ChatPort} + {@link ChatSubscriptions}. Writes are recorded
 * and observable through the watch callbacks, so hooks can be exercised in
 * tests without Convex.
 */
export function createMockPort(): MockPort {
  const state: MockPortState = {
    calls: [],
    channels: new Map(),
    messages: new Map(),
    commits: new Map(),
    joinIntents: new Map(),
    keyPackages: new Map(),
    reactions: new Map(),
    presence: [],
    typing: new Map(),
    readStates: new Map(),
    members: new Map(),
    deviceId: "device-1",
  };

  const channelListeners: ((channels: readonly ChannelSummary[]) => void)[] = [];
  const messageListeners = new Map<string, ((m: readonly MessagePayload[]) => void)[]>();
  const commitListeners = new Map<string, ((c: readonly unknown[]) => void)[]>();
  const intentListeners = new Map<string, ((i: readonly JoinIntentRow[]) => void)[]>();
  const reactionListeners = new Map<string, ((r: readonly ReactionRow[]) => void)[]>();
  const presenceListeners: ((p: readonly PresenceRow[]) => void)[] = [];
  const typingListeners = new Map<string, ((t: readonly TypingRow[]) => void)[]>();
  const readStateListeners = new Map<string, ((s: ReadStateRow | null) => void)[]>();

  const record = (method: string, args: unknown) => {
    state.calls.push({ method, args });
  };

  const emitChannels = () => {
    const list = [...state.channels.values()];
    for (const listener of channelListeners) {
      listener(list);
    }
  };
  const emitMessages = (channelId: string) => {
    const list = [...state.messages.values()]
      .filter((message) => message.channelId === channelId && message.threadRootId === null)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const listener of messageListeners.get(channelId) ?? []) {
      listener(list);
    }
  };
  const emitCommits = (channelId: string) => {
    for (const listener of commitListeners.get(channelId) ?? []) {
      listener(state.commits.get(channelId) ?? []);
    }
  };
  const emitIntents = (channelId: string) => {
    for (const listener of intentListeners.get(channelId) ?? []) {
      listener(state.joinIntents.get(channelId) ?? []);
    }
  };
  const emitTyping = (channelId: string) => {
    for (const listener of typingListeners.get(channelId) ?? []) {
      listener(state.typing.get(channelId) ?? []);
    }
  };

  const port: MockPort = {
    state,
    async upsertDevice(args) {
      record("upsertDevice", args);
      return { deviceId: state.deviceId };
    },
    async publishKeyPackage(args) {
      record("publishKeyPackage", args);
      const list = state.keyPackages.get(args.deviceId) ?? [];
      list.push(args.keyPackage);
      state.keyPackages.set(args.deviceId, list);
      return nextId("kp");
    },
    async consumeKeyPackages(args) {
      record("consumeKeyPackages", args);
      const list = state.keyPackages.get(args.deviceId) ?? [];
      return list.splice(0, args.count);
    },
    async createChannel(args) {
      record("createChannel", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: args.kind,
        categoryId: args.categoryId ?? null,
        nameCiphertext: args.nameCiphertext,
        topicCiphertext: args.topicCiphertext ?? null,
        mlsGroupId: args.mlsGroupId,
        archived: false,
        currentEpoch: null,
      });
      state.members.set(id, []);
      emitChannels();
      return id;
    },
    async setMlsGroupId(args) {
      record("setMlsGroupId", args);
      const channel = state.channels.get(args.channelId) ?? {
        id: args.channelId,
        kind: "text" as const,
        categoryId: null,
        nameCiphertext: null,
        topicCiphertext: null,
        mlsGroupId: null,
        archived: false,
        currentEpoch: null,
      };
      state.channels.set(args.channelId, { ...channel, mlsGroupId: args.mlsGroupId });
      emitChannels();
      return null;
    },
    async joinChannel(args) {
      record("joinChannel", args);
      return null;
    },
    async leaveChannel(args) {
      record("leaveChannel", args);
      return null;
    },
    async createDm(args) {
      record("createDm", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: "dm",
        categoryId: null,
        nameCiphertext: null,
        topicCiphertext: null,
        mlsGroupId: args.mlsGroupId ?? null,
        archived: false,
        currentEpoch: null,
        memberIds: ["me", args.otherUserId],
      });
      state.members.set(id, ["me", args.otherUserId]);
      emitChannels();
      return { channelId: id, created: true };
    },
    async createGroupDm(args) {
      record("createGroupDm", args);
      const id = nextId("channel");
      state.channels.set(id, {
        id,
        kind: "group_dm",
        categoryId: null,
        nameCiphertext: null,
        topicCiphertext: null,
        mlsGroupId: args.mlsGroupId ?? null,
        archived: false,
        currentEpoch: null,
        memberIds: ["me", ...args.memberIds],
      });
      state.members.set(id, ["me", ...args.memberIds]);
      emitChannels();
      return { channelId: id, created: true };
    },
    async getChannelMemberIds(args) {
      record("getChannelMemberIds", args);
      return state.members.get(args.channelId) ?? [];
    },
    async appendCommit(args) {
      record("appendCommit", args);
      const list = state.commits.get(args.channelId) ?? [];
      list.push({
        id: nextId("commit"),
        epoch: args.epoch,
        commitCiphertext: args.commitCiphertext,
        welcomeCiphertext: args.welcomeCiphertext ?? null,
      });
      state.commits.set(args.channelId, list);
      emitCommits(args.channelId);
      return nextId("commit");
    },
    async publishJoinIntent(args) {
      record("publishJoinIntent", args);
      const list = state.joinIntents.get(args.channelId) ?? [];
      const existing = list.find((intent) => intent.deviceId === args.deviceId);
      if (existing !== undefined) {
        return existing.id;
      }
      const intent: JoinIntentRow = {
        id: nextId("intent"),
        userId: "me",
        deviceId: args.deviceId,
        keyPackage: args.keyPackage,
        createdAt: Date.now(),
      };
      list.push(intent);
      state.joinIntents.set(args.channelId, list);
      emitIntents(args.channelId);
      return intent.id;
    },
    async markJoinIntentServiced(args) {
      record("markJoinIntentServiced", args);
      for (const [channelId, list] of state.joinIntents) {
        const next = list.filter((intent) => intent.id !== args.intentId);
        state.joinIntents.set(channelId, next);
        // Defer so we never re-enter auto-approve from inside its own write.
        queueMicrotask(() => emitIntents(channelId));
      }
      return null;
    },
    async sendMessage(args) {
      record("sendMessage", args);
      messageSeq += 1;
      const id = nextId("message");
      state.messages.set(id, {
        id,
        channelId: args.channelId,
        authorId: "me",
        authorDeviceId: args.authorDeviceId ?? null,
        ciphertext: args.ciphertext,
        epoch: args.epoch,
        threadRootId: args.threadRootId ?? null,
        attachmentIds: [...(args.attachmentIds ?? [])],
        mentionUserIds: [...(args.mentionUserIds ?? [])],
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        createdAt: messageSeq,
      });
      emitMessages(args.channelId);
      return id;
    },
    async editMessage(args) {
      record("editMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, {
          ...message,
          ciphertext: args.ciphertext,
          epoch: args.epoch,
          editedAt: Date.now(),
        });
        emitMessages(message.channelId);
      }
      return null;
    },
    async deleteMessage(args) {
      record("deleteMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, deletedAt: Date.now() });
        emitMessages(message.channelId);
      }
      return null;
    },
    async pinMessage(args) {
      record("pinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: Date.now() });
        emitMessages(message.channelId);
      }
      return null;
    },
    async unpinMessage(args) {
      record("unpinMessage", args);
      const message = state.messages.get(args.messageId);
      if (message !== undefined) {
        state.messages.set(args.messageId, { ...message, pinnedAt: null });
        emitMessages(message.channelId);
      }
      return null;
    },
    async toggleReaction(args) {
      record("toggleReaction", args);
      const list = state.reactions.get(args.messageId) ?? [];
      const index = list.findIndex(
        (reaction) => reaction.userId === "me" && reaction.emojiCiphertext === args.emojiCiphertext,
      );
      const next = [...list];
      if (index >= 0) {
        next.splice(index, 1);
        state.reactions.set(args.messageId, next);
        for (const listener of reactionListeners.get(args.messageId) ?? []) {
          listener(next);
        }
        return { added: false };
      }
      next.push({ id: nextId("reaction"), userId: "me", emojiCiphertext: args.emojiCiphertext });
      state.reactions.set(args.messageId, next);
      for (const listener of reactionListeners.get(args.messageId) ?? []) {
        listener(next);
      }
      return { added: true };
    },
    async heartbeat(args) {
      record("heartbeat", args);
      return null;
    },
    async setStatus(args) {
      record("setStatus", args);
      state.presence.splice(
        0,
        state.presence.length,
        ...state.presence.filter((row) => row.userId !== "me"),
        {
          userId: "me",
          status: args.status,
          customStatusCiphertext: args.customStatusCiphertext ?? null,
          lastHeartbeat: Date.now(),
        },
      );
      for (const listener of presenceListeners) {
        listener(state.presence);
      }
      return null;
    },
    async setTyping(args) {
      record("setTyping", args);
      const list = state.typing.get(args.channelId) ?? [];
      const next = [
        ...list.filter((row) => row.userId !== "me"),
        { userId: "me", expiresAt: Date.now() + 8000 },
      ];
      state.typing.set(args.channelId, next);
      emitTyping(args.channelId);
      return { expiresAt: next[next.length - 1]?.expiresAt ?? 0 };
    },
    async clearTyping(args) {
      record("clearTyping", args);
      state.typing.set(
        args.channelId,
        (state.typing.get(args.channelId) ?? []).filter((row) => row.userId !== "me"),
      );
      emitTyping(args.channelId);
      return null;
    },
    async setReadState(args) {
      record("setReadState", args);
      const state0: ReadStateRow = {
        channelId: args.channelId,
        lastReadMessageId: args.lastReadMessageId,
        mentionCount: 0,
      };
      state.readStates.set(args.channelId, state0);
      for (const listener of readStateListeners.get(args.channelId) ?? []) {
        listener(state0);
      }
      return null;
    },
    watchChannels(onChange) {
      channelListeners.push(onChange);
      onChange([...state.channels.values()]);
      return () => {
        const index = channelListeners.indexOf(onChange);
        if (index >= 0) {
          channelListeners.splice(index, 1);
        }
      };
    },
    watchMessages(channelId, onChange) {
      const list = messageListeners.get(channelId) ?? [];
      list.push(onChange);
      messageListeners.set(channelId, list);
      onChange(
        [...state.messages.values()]
          .filter((message) => message.channelId === channelId && message.threadRootId === null)
          .sort((a, b) => a.createdAt - b.createdAt),
      );
      return () => {
        messageListeners.set(
          channelId,
          (messageListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchReactions(messageId, onChange) {
      const list = reactionListeners.get(messageId) ?? [];
      list.push(onChange);
      reactionListeners.set(messageId, list);
      onChange(state.reactions.get(messageId) ?? []);
      return () => {
        reactionListeners.set(
          messageId,
          (reactionListeners.get(messageId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchCommits(channelId, _afterEpoch, onChange) {
      const list = (commitListeners.get(channelId) ?? []) as ((c: readonly unknown[]) => void)[];
      const typed = onChange as (c: readonly unknown[]) => void;
      list.push(typed);
      commitListeners.set(channelId, list);
      typed(state.commits.get(channelId) ?? []);
      return () => {
        commitListeners.set(
          channelId,
          ((commitListeners.get(channelId) ?? []) as ((c: readonly unknown[]) => void)[]).filter(
            (listener) => listener !== typed,
          ),
        );
      };
    },
    watchJoinIntents(channelId, onChange) {
      const list = intentListeners.get(channelId) ?? [];
      list.push(onChange);
      intentListeners.set(channelId, list);
      onChange(state.joinIntents.get(channelId) ?? []);
      return () => {
        intentListeners.set(
          channelId,
          (intentListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchPresence(onChange) {
      presenceListeners.push(onChange);
      onChange(state.presence);
      return () => {
        const index = presenceListeners.indexOf(onChange);
        if (index >= 0) {
          presenceListeners.splice(index, 1);
        }
      };
    },
    watchTyping(channelId, onChange) {
      const list = typingListeners.get(channelId) ?? [];
      list.push(onChange);
      typingListeners.set(channelId, list);
      onChange(state.typing.get(channelId) ?? []);
      return () => {
        typingListeners.set(
          channelId,
          (typingListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
    watchReadState(channelId, onChange) {
      const list = readStateListeners.get(channelId) ?? [];
      list.push(onChange);
      readStateListeners.set(channelId, list);
      onChange(state.readStates.get(channelId) ?? null);
      return () => {
        readStateListeners.set(
          channelId,
          (readStateListeners.get(channelId) ?? []).filter((listener) => listener !== onChange),
        );
      };
    },
  };

  return port;
}

/** Encodes plaintext the way the session does, for assertions. */
export function encodeForTest(text: string): Uint8Array {
  return utf8Encode(text);
}

/** Decodes decrypted bytes the way the session does, for assertions. */
export function decodeForTest(bytes: Uint8Array): string {
  return utf8Decode(bytes);
}
