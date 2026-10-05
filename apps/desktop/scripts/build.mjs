// Cross-platform Tauri build driver for the Aulora desktop shell.
//
// Wraps `bunx tauri build` with sccache injected, and wires up the off-Windows
// cross paths: cargo-xwin for a Windows NSIS installer from macOS/Linux, and
// cargo-zigbuild for Linux from macOS.
//
//   node scripts/build.mjs --target macos
//   node scripts/build.mjs --target windows [--native] [--debug] [--no-cache]
//   node scripts/build.mjs --target linux
//   node scripts/build.mjs --target all
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..", "..");

const WIN_TARGET = "x86_64-pc-windows-msvc";
const LINUX_TARGET = "x86_64-unknown-linux-gnu";
const isWindowsHost = process.platform === "win32";

const rawArgs = process.argv.slice(2);

function hasFlag(name) {
  return rawArgs.includes(name);
}

function readOption(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) {
    return inline.slice(name.length + 1);
  }
  const index = rawArgs.indexOf(name);
  const next = rawArgs[index + 1];
  if (index !== -1 && next !== undefined && !next.startsWith("--")) {
    return next;
  }
  return undefined;
}

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
    return { command: onPath, onPath: true };
  }
  const cargoBin = resolve(homedir(), ".cargo", "bin");
  const candidate = resolve(cargoBin, isWindowsHost ? "sccache.exe" : "sccache");
  if (existsSync(candidate)) {
    return { command: candidate, onPath: false, dir: cargoBin };
  }
  return null;
}

// On Windows the runnable is a real file (`bun.exe`, `cargo.exe`, ...); resolve
// it explicitly so we never need to spawn through a shell. Elsewhere the bare
// command name is enough.
function executable(command) {
  return isWindowsHost ? (findOnPath(command) ?? command) : command;
}

function run(command, args) {
  const result = spawnSync(executable(command), args, {
    cwd: desktopDir,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    process.stderr.write(`build: failed to run ${command}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function commandOk(command, args) {
  return spawnSync(executable(command), args, { stdio: "ignore" }).status === 0;
}

function setupCache(disabled) {
  if (disabled) {
    process.stdout.write("build: sccache disabled (--no-cache)\n");
    return;
  }
  const found = findSccache();
  if (found === null) {
    process.stdout.write(
      "build: sccache not found; install it with `cargo install --locked sccache` to cache Rust builds. Continuing without caching.\n",
    );
    return;
  }
  if (!found.onPath && found.dir !== undefined) {
    process.env.PATH = `${found.dir}${delimiter}${process.env.PATH ?? ""}`;
  }
  process.env.RUSTC_WRAPPER = found.onPath ? "sccache" : found.command;
  if (process.env.SCCACHE_DIR === undefined) {
    const cacheDir = resolve(repoRoot, ".cache", "sccache");
    mkdirSync(cacheDir, { recursive: true });
    process.env.SCCACHE_DIR = cacheDir;
  }
  spawnSync(executable(found.command), ["--start-server"], { stdio: "ignore" });
  process.stdout.write(`build: caching with sccache (${process.env.SCCACHE_DIR})\n`);
}

function runTauri(extraArgs, debug) {
  const args = ["x", "tauri", "build", ...extraArgs];
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    args.push("--config", "src-tauri/tauri.release.conf.json");
  }
  if (debug) {
    args.push("--debug");
  }
  process.stdout.write(`build: bun ${args.join(" ")}\n`);
  return run("bun", args);
}

function ensureLlvm() {
  if (findOnPath("lld-link") !== null) {
    return true;
  }
  const prefix = spawnSync(executable("brew"), ["--prefix", "llvm"], {
    encoding: "utf8",
  });
  if (prefix.status === 0) {
    const bin = resolve(prefix.stdout.trim(), "bin");
    process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
    return findOnPath("lld-link") !== null;
  }
  return false;
}

function buildMacos(debug) {
  return runTauri([], debug);
}

function buildWindows(debug, native) {
  if (native || isWindowsHost) {
    return runTauri([], debug);
  }
  const missing = [];
  if (!commandOk("cargo", ["xwin", "--version"])) {
    missing.push("cargo-xwin");
  }
  if (!ensureLlvm()) {
    missing.push("llvm (lld-link)");
  }
  if (missing.length > 0) {
    process.stderr.write(
      `build: cannot cross-compile Windows from this host, missing: ${missing.join(", ")}\n` +
        "  cargo install --locked cargo-xwin\n" +
        `  rustup target add ${WIN_TARGET}\n` +
        "  brew install llvm  # then add /opt/homebrew/opt/llvm/bin to PATH\n",
    );
    return 1;
  }
  return runTauri(["--runner", "cargo-xwin", "--target", WIN_TARGET], debug);
}

function buildLinux(debug) {
  if (process.platform !== "darwin") {
    return runTauri(["--target", LINUX_TARGET], debug);
  }
  if (!commandOk("cargo", ["zigbuild", "--version"])) {
    process.stderr.write(
      "build: cannot cross-compile Linux from macOS, missing: cargo-zigbuild\n" +
        "  cargo install --locked cargo-zigbuild\n" +
        "  brew install zig\n",
    );
    return 1;
  }
  return runTauri(["--target", LINUX_TARGET], debug);
}

const target = readOption("--target");
if (target === undefined || !["macos", "windows", "linux", "all"].includes(target)) {
  process.stderr.write(
    "usage: node scripts/build.mjs --target macos|windows|linux|all [--debug] [--no-cache] [--native]\n",
  );
  process.exit(1);
}

const debug = hasFlag("--debug");
const native = hasFlag("--native");

setupCache(hasFlag("--no-cache"));

let code = 0;
if (target === "macos") {
  code = buildMacos(debug);
} else if (target === "windows") {
  code = buildWindows(debug, native);
} else if (target === "linux") {
  code = buildLinux(debug);
} else {
  code = buildMacos(debug);
  if (code === 0) {
    code = buildWindows(debug, native);
  }
}

process.exit(code);
