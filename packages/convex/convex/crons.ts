import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { getEkmSettings } from "./lib/ekm";

/**
 * Recurring maintenance: presence staleness and typing cleanup run on the same
 * 30s cadence as the client heartbeat.
 */
const crons = cronJobs();

crons.interval("presence sweep", { seconds: 30 }, internal.presence.sweepStale, {});
crons.interval("presence idle sweep", { seconds: 30 }, internal.presence.sweepIdle, {});
crons.interval("typing purge", { seconds: 30 }, internal.typing.purgeExpired, {});
// Drops participants/signalling from crashed clients and ends abandoned or
// timed-out calls, so a voice channel never shows a ghost participant.
crons.interval("call sweep", { seconds: 30 }, internal.calls.sweep, {});

// Bot events are a one-hour outbox: `poll` reads them, then they are dropped.
crons.interval("bot events prune", { hours: 1 }, internal.botEvents.prune, {});

// Scheduled calls flip to `open` at their open time; the per-call job is the
// primary trigger and this pass is the backstop (plus ends stale rooms).
crons.interval("scheduled call sweep", { minutes: 1 }, internal.scheduledCalls.sweep, {});

// Ended transcripts that still need a summary, and the daily retention purge.
crons.interval(
  "transcription summary queue",
  { minutes: 5 },
  internal.transcription.sessionsNeedingSummary,
  {},
);
crons.cron("transcription retention", "15 4 * * *", internal.transcription.purgeExpired, {});

// Expired guest sessions and lobby requests are dropped in bounded batches.
crons.interval("guest session prune", { hours: 1 }, internal.guestCalls.pruneExpired, {});

// A failed account deletion can leave an ownership reservation behind. A
// reservation keeps counting as a present owner until this prune has confirmed
// the auth user is gone and released it, so an expired reservation fails
// closed: if this cron stops running, account deletion stays blocked rather
// than risking an ownerless workspace. The prune drops released rows.
crons.interval(
  "owner deletion reservation prune",
  { hours: 1 },
  internal.owners.pruneAccountDeletionReservations,
  {},
);

// Expired fixed-window rate-limit counters are dropped hourly; the sweep only
// touches counters far older than any window.
crons.interval("rate limit prune", { hours: 1 }, internal.rateLimits.pruneRateLimits, {});

// Native/desktop OAuth handoff codes live for two minutes. The prune only reads
// rows past `expiresAt` through an index and drains a backlog in batches.
crons.interval(
  "native auth handoff prune",
  { minutes: 5 },
  internal.nativeAuthHandoff.pruneExpired,
  {},
);
// Started transactions have the same short lifetime as the codes they later
// mint; the sweep keeps abandoned browser flows from accumulating.
crons.interval(
  "native auth transaction prune",
  { minutes: 5 },
  internal.nativeAuthHandoff.pruneExpiredTransactions,
  {},
);

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
