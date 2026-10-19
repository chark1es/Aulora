#!/usr/bin/env node
// Aulora bot runner entrypoint.
//
// Supervises user-created bots: polls the desired state from Convex, launches
// one sandboxed process per enabled bot, ships logs, and stops everything on
// SIGTERM/SIGINT. See ../../docs/bots-design.md for the contract.

import { createRunnerApi } from "./api.mjs";
import { loadConfig } from "./config.mjs";
import { createRunner } from "./runner.mjs";

async function main() {
  const config = loadConfig();
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
    `bot runner: supervising up to ${config.maxBots} bots every ${config.pollIntervalMs}ms`,
  );
  runner.start();
}

main().catch((error) => {
  console.error(`bot runner: fatal: ${error.message}`);
  process.exit(1);
});
