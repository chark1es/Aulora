import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseNotes({ version, repository, commit, notes = "" }, run = execFileSync) {
  if (notes.trim()) return notes;
  if (version === "1.0.0") return readFileSync("docs/release-notes-v1.md", "utf8");
  const generated = run(
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${repository}/releases/generate-notes`,
      "-f",
      `tag_name=v${version}`,
      "-f",
      `target_commitish=${commit}`,
      "--jq",
      ".body",
    ],
    { encoding: "utf8" },
  );
  if (!generated.trim()) throw new Error("GitHub generated empty release notes.");
  return generated;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const notes = releaseNotes({
    version: process.env.RELEASE_VERSION,
    repository: process.env.GITHUB_REPOSITORY,
    commit: process.env.GITHUB_SHA,
    notes: process.env.RELEASE_NOTES,
  });
  writeFileSync("dist/release/RELEASE_NOTES.md", notes);
}
