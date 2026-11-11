import { describe, expect, it } from "vitest";
import { channelOpening, conversationOpening, firstNameOf } from "../src/index";

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
    expect(opening.body).toBe("The first message is yours.");
    expect(opening.sayHi).toBe("Hi Alex");
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
    expect(opening.body).toBe("Everyone here will see your message.");
    expect(opening.sayHi).toBe("Hi everyone");
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

    expect(opening.sayHi).toBe("Hi");
    expect(opening.showActions).toBe(true);
  });
});

describe("channelOpening", () => {
  it("uses the same hash format for text and announcement channels", () => {
    for (const kind of ["text", "announcement"] as const) {
      expect(channelOpening(kind, "announcements")).toEqual({
        heading: "Welcome to #announcements",
        body: "Say hello to the channel.",
      });
    }
  });
  it("gives voice channels one short call invitation", () => {
    expect(channelOpening("voice", "lounge").heading).toBe("Welcome to lounge");
    expect(channelOpening("voice", "lounge").body).toBe("Join the call when you are ready.");
  });
});
