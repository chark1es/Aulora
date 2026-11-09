import { describe, expect, it } from "vitest";
import { hasAuthHandoffParams } from "./auth-handoff-location";

describe("hasAuthHandoffParams", () => {
  it("ignores an ordinary address", () => {
    expect(hasAuthHandoffParams("", "")).toBe(false);
    expect(hasAuthHandoffParams("#/connect", "?server=https%3A%2F%2Fchat.example.com")).toBe(false);
    expect(hasAuthHandoffParams("#/note/tx-notes", "?q=tx")).toBe(false);
  });

  it("finds a callback code or error in the fragment", () => {
    expect(hasAuthHandoffParams("#aulora-auth-code=abc", "")).toBe(true);
    expect(hasAuthHandoffParams("#aulora-auth-server=https%3A%2F%2Fx", "")).toBe(true);
    expect(hasAuthHandoffParams("#aulora-auth-error=denied", "")).toBe(true);
  });

  it("finds the echoed transaction id in the fragment or query", () => {
    expect(hasAuthHandoffParams("#tx=abc", "")).toBe(true);
    expect(hasAuthHandoffParams("", "?tx=abc")).toBe(true);
    expect(hasAuthHandoffParams("#aulora-auth-tx=abc", "")).toBe(true);
  });

  it("finds an error redirect that names the workspace in the query", () => {
    expect(hasAuthHandoffParams("", "?aulora-auth-error=denied&server=https%3A%2F%2Fx")).toBe(true);
  });
});
