import { describe, expect, it } from "vitest";
import { isGithubRepositoryName, isKanbanGithubLink, kanbanDuration } from "../src/kanban";

describe("isKanbanGithubLink", () => {
  it("accepts repositories, issues and pull requests on github.com", () => {
    expect(isKanbanGithubLink("https://github.com/aulora/chat")).toBe(true);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/")).toBe(true);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/issues/12")).toBe(true);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/pull/7/")).toBe(true);
  });
  it("rejects other hosts, schemes and paths", () => {
    expect(isKanbanGithubLink("http://github.com/aulora/chat")).toBe(false);
    expect(isKanbanGithubLink("https://github.com.evil.test/aulora/chat")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/issues")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/issues/abc")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/pull/7/files")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/chat/wiki")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/chat?tab=readme")).toBe(false);
    expect(isKanbanGithubLink("https://github.com/aulora/..")).toBe(false);
  });
});

describe("isGithubRepositoryName", () => {
  it("needs an owner and a repository", () => {
    expect(isGithubRepositoryName("aulora/chat")).toBe(true);
    expect(isGithubRepositoryName("aulora")).toBe(false);
    expect(isGithubRepositoryName("-bad/chat")).toBe(false);
    expect(isGithubRepositoryName("aulora/.")).toBe(false);
  });
});

describe("kanbanDuration", () => {
  it("formats tracked time as hours, minutes and seconds", () => {
    expect(kanbanDuration(0)).toBe("00:00:00");
    expect(kanbanDuration(3_725_000)).toBe("01:02:05");
    expect(kanbanDuration(-5)).toBe("00:00:00");
  });
});
