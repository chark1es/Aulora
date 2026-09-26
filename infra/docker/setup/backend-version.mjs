// Prints the backend `/version` body, or exits non-zero when unreachable.
// Used only as a reachability probe by entrypoint.sh.
const base = process.env.CONVEX_SELF_HOSTED_URL ?? "http://convex-backend:3210";

try {
  const response = await fetch(`${base}/version`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    process.exit(1);
  }
  process.stdout.write(await response.text());
} catch {
  process.exit(1);
}
