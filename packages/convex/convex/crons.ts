import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { getEkmSettings } from "./lib/ekm";

/**
 * Recurring maintenance: presence staleness and typing cleanup run on the same
 * 30s cadence as the client heartbeat.
 */
const crons = cronJobs();

crons.interval("presence sweep", { seconds: 30 }, internal.presence.sweepStale, {});
crons.interval("typing purge", { seconds: 30 }, internal.typing.purgeExpired, {});

// Records the nightly backup intent at 03:00 UTC. The outside backup runner
// (`infra/docker/backup`) performs the actual export + dump + upload.
crons.cron("nightly backup", "0 3 * * *", internal.backups.nightly, {});

// Remote key managers unwrap over the network, which queries and mutations may
// not do, so keep the master key primed. The local provider derives on demand
// and needs no cron.
if (getEkmSettings(process.env).provider !== "local") {
  crons.interval("ekm prime", { minutes: 30 }, internal.encryptionKeys.prime, {});
}

export default crons;
