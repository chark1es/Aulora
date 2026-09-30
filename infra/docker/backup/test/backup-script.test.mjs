import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
test("backup shell includes uploaded files in its export", {
  skip: process.platform === "win32",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "aulora-backup-script-"));
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    for (const command of ["pg_dump", "bunx"]) {
      writeFileSync(
        join(bin, command),
        `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BACKUP_TEST_LOG, args.join(" ") + "\\n");
if (args[0] === "convex" && args[1] === "export") {
  fs.writeFileSync(args[args.indexOf("--path") + 1], "test snapshot");
}
`,
        { mode: 0o755 },
      );
    }
    const log = join(directory, "calls");
    const result = spawnSync("bash", [join(root, "infra/docker/backup/backup.sh"), "manual"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BACKUP_TEST_LOG: log,
        BACKUP_DIR: join(directory, "backup"),
        BACKUP_SKIP_UPLOAD: "1",
        CONVEX_PROJECT_DIR: directory,
        BACKUP_PLAN: join(root, "infra/docker/backup/backup-plan.mjs"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(log, "utf8"), /convex export --include-file-storage --path /);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
