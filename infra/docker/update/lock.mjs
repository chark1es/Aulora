import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// A login service must recover after a crash or reboot, while keeping a live
// watcher's lock intact. Legacy locks without a PID still require manual cleanup.
export function acquireWatcherLock(directory) {
  const pidFile = resolve(directory, "pid");
  try {
    mkdirSync(directory);
  } catch (cause) {
    if (cause.code !== "EEXIST") throw cause;
    let pid;
    try {
      pid = Number(readFileSync(pidFile, "utf8"));
    } catch {
      throw new Error(
        "The update watcher lock already exists. If the watcher crashed, remove infra/docker/.update-host.lock before starting it again.",
      );
    }
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error("The update watcher lock contains an invalid PID.");
    try {
      process.kill(pid, 0);
      throw new Error("The update watcher is already running.");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    rmSync(directory, { recursive: true });
    mkdirSync(directory);
  }
  writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
  return () => rmSync(directory, { recursive: true });
}
