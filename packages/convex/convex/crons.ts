import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

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

export default crons;
