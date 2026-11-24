import { describe, expect, it } from "vitest";
import { personOptions } from "../components/kanban/controls";

const members = [
  { userId: "u1", displayName: "Ada" },
  { userId: "bot_helper", displayName: "Helper" },
];

describe("personOptions", () => {
  it("never offers a bot account", () => {
    expect(personOptions(members, []).map((option) => option.id)).toEqual(["u1"]);
  });

  it("keeps an already selected bot listed by name so it can be removed", () => {
    expect(personOptions(members, ["bot_helper"]).map((option) => option.label)).toEqual([
      "Ada",
      "Helper",
    ]);
  });
});
