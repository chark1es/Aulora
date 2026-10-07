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
  const xml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character],
    );
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(bunPath)}</string><string>${xml(resolve(dockerDir, "update/host.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(dockerDir)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(logPath)}</string>
<key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>
`;
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
    for (const file of [".env", "update/host.mjs"])
      if (!existsSync(resolve(dockerDir, file)))
        throw new Error(
          `Missing ${file} in ${dockerDir}. Install from the checkout running your Docker stack.`,
        );
    // Check the exact project's backend before installing a service that would repeatedly fail.
    await run("docker", ["compose", "exec", "-T", "convex-backend", "true"], dockerDir);
    mkdirSync(dirname(service.plistPath), { recursive: true });
    mkdirSync(service.logDir, { recursive: true, mode: 0o700 });
    await run("launchctl", ["bootout", `${domain}/${service.label}`], dockerDir).catch(
      () => undefined,
    );
    writeFileSync(service.plistPath, service.plist, { mode: 0o600 });
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
