import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { releaseNotes } from "./release-notes.mjs";

const release = { version: "1.1.0", repository: "chark1es/Aulora", commit: "built-commit" };
const unexpectedCall = () => {
  throw new Error("Should not call GitHub for supplied notes.");
};

test("manual notes override defaults and preserve Markdown", () => {
  const notes = "# Changes\n\n- Migration instructions\n";
  for (const version of ["1.0.0", "1.1.0"])
    expect(releaseNotes({ ...release, version, notes }, unexpectedCall)).toBe(notes);
});

test("v1 uses its checked-in release notes when the input is blank", () => {
  expect(releaseNotes({ ...release, version: "1.0.0", notes: " \n" }, unexpectedCall)).toBe(
    readFileSync("docs/release-notes-v1.md", "utf8"),
  );
});

test("later releases generate notes for the exact version and built commit", () => {
  const generated = "## What's Changed\n\n- Fix reconnects by @contributor\n";
  let calls = 0;
  const notes = releaseNotes({ ...release, notes: " \n" }, (command, args, options) => {
    calls += 1;
    expect(command).toBe("gh");
    expect(args).toEqual([
      "api",
      "--method",
      "POST",
      "repos/chark1es/Aulora/releases/generate-notes",
      "-f",
      "tag_name=v1.1.0",
      "-f",
      "target_commitish=built-commit",
      "--jq",
      ".body",
    ]);
    expect(options.encoding).toBe("utf8");
    return generated;
  });
  expect(calls).toBe(1);
  expect(notes).toBe(generated);
});

test("generation errors stop assembly instead of leaving blank notes", () => {
  expect(() => releaseNotes(release, () => " \n")).toThrow("empty release notes");
  expect(() =>
    releaseNotes(release, () => {
      throw new Error("GitHub API unavailable");
    }),
  ).toThrow("GitHub API unavailable");
});
