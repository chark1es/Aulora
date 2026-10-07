// Install the host watcher as a per-user macOS LaunchAgent.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./stage.mjs";

export function watcherService({ dockerDir, bunPath, userHome, path }) {
  const instance = createHash("sha256").update(dockerDir).digest("hex").slice(0, 12);
  const label = `io.aulora.updater.${instance}`;
  const logDir = resolve(userHome, "Library/Logs/Aulora");
  const logPath = resolve(logDir, `update-${instance}.log`);
  const plistPath = resolve(userHome, "Library/LaunchAgents", `${label}.plist`);
  // plutil converts structured JSON to a plist without hand-written XML escaping.
  const plist = JSON.stringify({
    Label: label,
    ProgramArguments: [bunPath, resolve(dockerDir, "update/host.mjs")],
    WorkingDirectory: dockerDir,
    EnvironmentVariables: { PATH: path },
    RunAtLoad: true,
    KeepAlive: true,
    ThrottleInterval: 30,
    StandardOutPath: logPath,
    StandardErrorPath: logPath,
  });
  return { label, plist, plistPath, logDir, logPath };
}

async function main() {
  if (process.platform !== "darwin")
    throw new Error(
      "This installer supports macOS. On Linux, run update.sh --watch under your host service manager.",
    );
  const command = process.argv[2];
  if (!["install", "remove"].includes(command))
    throw new Error("usage: service.mjs install|remove [DOCKER_DIRECTORY]");
  const dockerDir = resolve(
    process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const service = watcherService({
    dockerDir,
    bunPath: process.execPath,
    userHome: homedir(),
    path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  });
  const domain = `gui/${process.getuid()}`;
  if (command === "install") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The checkout is selected by the local operator; file names are fixed here.
    for (const file of [".env", "update/host.mjs"])
      if (!existsSync(resolve(dockerDir, file)))
        throw new Error(
          `Missing ${file} in ${dockerDir}. Install from the checkout running your Docker stack.`,
        );
    // Check the exact project's backend before installing a service that would repeatedly fail.
    await run("docker", ["compose", "exec", "-T", "convex-backend", "true"], dockerDir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Generated under this user's Library/LaunchAgents with a hashed checkout label.
    mkdirSync(dirname(service.plistPath), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Generated under this user's Library/Logs/Aulora; no remote input.
    mkdirSync(service.logDir, { recursive: true, mode: 0o700 });
    await run("launchctl", ["bootout", `${domain}/${service.label}`], dockerDir).catch(
      () => undefined,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Generated under this user's Library/LaunchAgents with a hashed checkout label.
    writeFileSync(service.plistPath, service.plist, { mode: 0o600 });
    await run("plutil", ["-convert", "xml1", service.plistPath], dockerDir);
    await run("launchctl", ["bootstrap", domain, service.plistPath], dockerDir);
    console.log(`[update] Installed ${service.label}. The watcher starts now and at login.`);
    console.log(`[update] Logs: ${service.logPath}`);
  } else {
    await run("launchctl", ["bootout", `${domain}/${service.label}`], dockerDir).catch(
      () => undefined,
    );
    rmSync(service.plistPath, { force: true });
    console.log(`[update] Removed ${service.label}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    console.error(`[update] ${cause.message}`);
    process.exitCode = 1;
  });
}
