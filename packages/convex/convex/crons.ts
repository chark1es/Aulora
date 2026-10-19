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
// Drops participants/signalling from crashed clients and ends abandoned or
// timed-out calls, so a voice channel never shows a ghost participant.
crons.interval("call sweep", { seconds: 30 }, internal.calls.sweep, {});

// Bot events are a one-hour outbox: `poll` reads them, then they are dropped.
crons.interval("bot events prune", { hours: 1 }, internal.botEvents.prune, {});

// Expired fixed-window rate-limit counters are dropped hourly; the sweep only
// touches counters far older than any window.
crons.interval("rate limit prune", { hours: 1 }, internal.rateLimits.pruneRateLimits, {});

// Six-month audit-log retention; drops only rows past the window.
crons.cron("audit log prune", "0 4 * * *", internal.auditLog.pruneAuditLog, {});

// Reclaims storage for presence rows and device installs that have been gone
// well past any activity window; never touches rows inside retention.
crons.cron("stale presence prune", "30 4 * * *", internal.presence.pruneStalePresence, {});
crons.cron("stale device prune", "45 4 * * *", internal.devices.pruneStaleDevices, {});

// Records the nightly backup intent at 03:00 UTC. The outside backup runner
// (`infra/docker/backup`) performs the actual export + dump + upload.
crons.cron("nightly backup", "0 3 * * *", internal.backups.nightly, {});

// Remote key managers unwrap over the network, which queries and mutations may
// not do, so keep the master key primed. The local provider derives on demand
// and needs no cron.
if (getEkmSettings(process.env).provider !== "local") {
  crons.interval("ekm prime", { minutes: 30 }, internal.encryptionKeys.prime, {});
}

crons.interval(
  "commercial license validation",
  { minutes: 30 },
  internal.licenseActions.refresh,
  {},
);

crons.interval(
  "commercial active-user reports",
  { hours: 1 },
  internal.licenseUsageActions.report,
  {},
);

export default crons;
