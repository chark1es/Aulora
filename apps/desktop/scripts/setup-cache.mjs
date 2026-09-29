// Prepares the Rust build cache and the Windows cross-compile target.
//
//   node scripts/setup-cache.mjs            # report sccache, print instructions
//   node scripts/setup-cache.mjs --install  # run cargo install --locked sccache
//
// Nothing heavy runs unless --install is passed. Adding the MSVC target needs
// rustup, which is printed rather than run so this stays safe on Homebrew-only
// Rust installs.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve } from "node:path";

const WIN_TARGET = "x86_64-pc-windows-msvc";
const isWindowsHost = process.platform === "win32";
const install = process.argv.slice(2).includes("--install");

function findOnPath(command) {
  const exts = isWindowsHost ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    for (const ext of exts) {
      const candidate = resolve(dir, `${command}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function findSccache() {
  const onPath = findOnPath("sccache");
  if (onPath !== null) {
    return onPath;
  }
  const cargoBin = resolve(homedir(), ".cargo", "bin");
  const candidate = resolve(cargoBin, isWindowsHost ? "sccache.exe" : "sccache");
  return existsSync(candidate) ? candidate : null;
}

const found = findSccache();
if (found !== null) {
  const version = spawnSync(found, ["--version"], { encoding: "utf8", shell: isWindowsHost });
  const text = version.stdout?.trim();
  process.stdout.write(
    `${text !== undefined && text !== "" ? text : `sccache found at ${found}`}\n`,
  );
} else if (install) {
  process.stdout.write("Installing sccache with `cargo install --locked sccache`...\n");
  const result = spawnSync("cargo", ["install", "--locked", "sccache"], {
    stdio: "inherit",
    shell: isWindowsHost,
  });
  if (result.status !== 0) {
    process.stderr.write("sccache install failed\n");
    process.exit(result.status ?? 1);
  }
  process.stdout.write("sccache installed\n");
} else {
  process.stdout.write(
    "sccache is not installed.\n" +
      "  Install it with: cargo install --locked sccache\n" +
      "  Then re-run: node scripts/setup-cache.mjs\n",
  );
}

const rustup = spawnSync("rustup", ["--version"], { stdio: "ignore", shell: isWindowsHost });
process.stdout.write("\nWindows cross-compilation target (needs rustup):\n");
process.stdout.write(
  rustup.status === 0
    ? `  rustup target add ${WIN_TARGET}\n`
    : `  rustup is not installed; install rustup, then run: rustup target add ${WIN_TARGET}\n`,
);
