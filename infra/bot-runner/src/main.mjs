#!/usr/bin/env node
// Aulora bot runner entrypoint.
//
// Supervises user-created bots: polls the desired state from Convex, launches
// one sandboxed process per enabled bot, ships logs, and stops everything on
// SIGTERM/SIGINT. See ../../docs/bots-design.md for the contract.

import { createRunnerApi } from "./api.mjs";
import { loadConfig } from "./config.mjs";
import { createIdleKeeper } from "./idle.mjs";
import { createRunner } from "./runner.mjs";

async function main() {
  const config = loadConfig();
  // Bots are switched off (`BOT_RUNNER_ENABLED=false`), or there is no token yet
  // (first boot before `setup`, or before the next Compose `up` re-reads
  // `.env`): stay healthy and idle instead of exiting into a restart loop. The
  // token is read from the environment at process start.
  if (!config.enabled || config.runnerToken === undefined) {
    const idle = createIdleKeeper({
      healthFile: config.healthFile,
      ...(config.enabled
        ? {}
        : {
            reason:
              "BOT_RUNNER_ENABLED is false; idling. Set it to true and restart the container to run bots.",
          }),
    });
    idle.start();
    const stopIdle = () => {
      idle.stop();
      process.exit(0);
    };
    process.on("SIGTERM", stopIdle);
    process.on("SIGINT", stopIdle);
    return;
  }

  const api = createRunnerApi(config);
  const runner = createRunner({ config, api });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`bot runner: received ${signal}, stopping bots`);
    try {
      await runner.stop();
    } catch (error) {
      console.error(`bot runner: shutdown error: ${error.message}`);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(
    `bot runner: supervising up to ${config.maxBots} bots (poll ${config.pollIntervalMs}ms active, ${config.pollIdleIntervalMs}ms idle)`,
  );
  runner.start();
}

main().catch((error) => {
  console.error(`bot runner: fatal: ${error.message}`);
  process.exit(1);
});
