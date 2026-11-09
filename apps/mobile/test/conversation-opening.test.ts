import { describe, expect, it } from "vitest";
import { conversationOpening, firstNameOf } from "../src/lib/conversation-opening";

const names = new Map([
  ["me", "Casey Nguyen"],
  ["alex", "Alex Rivera"],
  ["sam", "Sam Chen"],
]);

describe("firstNameOf", () => {
  it("uses the first word and handles extra spacing", () => {
    expect(firstNameOf("  Alex   Rivera ")).toBe("Alex");
    expect(firstNameOf("Alex")).toBe("Alex");
  });
});

describe("conversationOpening", () => {
  it("opens a one-to-one conversation with presence and a personal suggestion", () => {
    const opening = conversationOpening({
      channel: { kind: "dm", memberIds: ["me", "alex"] },
      title: "Alex Rivera",
      ownUserId: "me",
      memberNames: names,
      partnerStatus: "online",
      canSend: true,
      canStartCall: true,
    });

    expect(opening.partnerId).toBe("alex");
    expect(opening.isSelf).toBe(false);
    expect(opening.meta).toBe("Online · Direct message");
    expect(opening.body).toBe("The first message is yours.");
    expect(opening.sayHi).toBe("Hey Alex 👋");
    expect(opening.showActions).toBe(true);
  });

  it("opens a group with stacked people, a member count and a group greeting", () => {
    const opening = conversationOpening({
      channel: { kind: "group_dm", memberIds: ["me", "alex", "sam", "riley"] },
      title: "Alex Rivera, Sam Chen and 1 other",
      ownUserId: "me",
      memberNames: names,
      canSend: true,
      canStartCall: false,
    });

    expect(opening.isGroup).toBe(true);
    expect(opening.otherIds).toEqual(["alex", "sam", "riley"]);
    expect(opening.meta).toBe("4 people in this conversation");
    expect(opening.body).toBe("The first message is yours. Everyone here will see it.");
    expect(opening.sayHi).toBe("Hey everyone 👋");
  });

  it("keeps notes to self quiet and free of actions", () => {
    const opening = conversationOpening({
      channel: { kind: "dm", memberIds: ["me"] },
      title: "Notes to self",
      ownUserId: "me",
      memberNames: names,
      canSend: true,
      canStartCall: true,
    });

    expect(opening.isSelf).toBe(true);
    expect(opening.meta).toBe("Just you");
    expect(opening.body).toBe("A place for notes, links, and reminders to yourself.");
    expect(opening.sayHi).toBeNull();
    expect(opening.showActions).toBe(false);
  });

  it("offers a call but no greeting when the viewer cannot post", () => {
    const opening = conversationOpening({
      channel: { kind: "dm", memberIds: ["me", "alex"] },
      title: "Alex Rivera",
      ownUserId: "me",
      memberNames: names,
      partnerStatus: "offline",
      canSend: false,
      canStartCall: true,
    });

    expect(opening.meta).toBe("Offline · Direct message");
    expect(opening.body).toBe("This is the beginning of your conversation with Alex.");
    expect(opening.sayHi).toBeNull();
    expect(opening.showActions).toBe(true);
  });

  it("falls back to a neutral greeting when the name is unknown", () => {
    const opening = conversationOpening({
      channel: { kind: "dm", memberIds: ["me", "unknown"] },
      title: "Unknown member",
      ownUserId: "me",
      memberNames: names,
      canSend: true,
      canStartCall: false,
    });

    expect(opening.sayHi).toBe("Hey 👋");
    expect(opening.showActions).toBe(true);
  });
});
