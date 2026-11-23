// Image list, build matrix and release tags for the Docker workflows.
//
//   node scripts/ci/docker.mjs matrix [--platforms linux/amd64,linux/arm64]
//   node scripts/ci/docker.mjs images
//   node scripts/ci/docker.mjs tags --version 1.6.2 [--existing "v1.6.1 v1.6.0"]
//
// `matrix` and `images` print JSON for GitHub Actions `fromJSON`; `tags` prints
// one tag per line. The compose files name the same images (see docker.test.mjs).
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateVersion } from "../../apps/desktop/scripts/release-version.mjs";

// Image names are published as ghcr.io/<owner>/<name>. Contexts and Dockerfiles
// are relative to the repository root.
export const IMAGES = [
  { name: "aulora-web", dockerfile: "infra/docker/web.Dockerfile", context: "." },
  { name: "aulora-setup", dockerfile: "infra/docker/setup.Dockerfile", context: "." },
  {
    name: "aulora-smtp-gateway",
    dockerfile: "infra/docker/smtp-gateway/Dockerfile",
    context: ".",
  },
  { name: "aulora-bot-runner", dockerfile: "infra/docker/bot-runner.Dockerfile", context: "." },
  { name: "aulora-transcriber", dockerfile: "infra/transcriber/Dockerfile", context: "." },
  { name: "aulora-backup", dockerfile: "infra/docker/backup/backup.Dockerfile", context: "." },
  {
    name: "aulora-push-relay",
    dockerfile: "infra/push-relay/Dockerfile",
    context: "infra/push-relay",
  },
];

// Native runners per architecture: no QEMU emulation.
export const PLATFORMS = {
  "linux/amd64": { arch: "amd64", runner: "ubuntu-24.04" },
  "linux/arm64": { arch: "arm64", runner: "ubuntu-24.04-arm" },
};

export function buildMatrix(platforms = Object.keys(PLATFORMS).join(",")) {
  const requested = platforms
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);
  if (requested.length === 0) throw new Error("Choose at least one platform.");
  for (const platform of requested) {
    if (!Object.hasOwn(PLATFORMS, platform)) throw new Error(`Unsupported platform: ${platform}`);
  }
  const unique = [...new Set(requested)];
  return {
    include: IMAGES.flatMap((image) =>
      unique.map((platform) => ({
        image: image.name,
        dockerfile: image.dockerfile,
        context: image.context,
        platform,
        arch: PLATFORMS[platform].arch,
        runner: PLATFORMS[platform].runner,
      })),
    ),
  };
}

const parse = (version) => version.split(".").map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

// Tags for a published release: always the exact version. The floating tags move
// only forward, so re-publishing an old release never points `latest`, `X.Y` or
// `X` at older code. `existing` holds the other release tags (`v1.2.3`).
export function releaseTags(version, existing = []) {
  validateVersion(version);
  const current = parse(version);
  const others = existing
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag.trim())?.[1])
    .filter((other) => other !== undefined && other !== version)
    .map(parse);
  const isNewest = (scope) => !others.some((other) => scope(other) && newer(other, current));
  const tags = [version];
  if (isNewest((other) => other[0] === current[0] && other[1] === current[1]))
    tags.push(`${current[0]}.${current[1]}`);
  if (isNewest((other) => other[0] === current[0])) tags.push(`${current[0]}`);
  if (isNewest(() => true)) tags.push("latest");
  return tags;
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      platforms: { type: "string" },
      version: { type: "string" },
      existing: { type: "string", default: "" },
    },
  });
  const [command] = positionals;
  if (command === "matrix") {
    process.stdout.write(`${JSON.stringify(buildMatrix(values.platforms))}\n`);
  } else if (command === "images") {
    process.stdout.write(`${JSON.stringify(IMAGES.map((image) => image.name))}\n`);
  } else if (command === "tags") {
    if (!values.version) throw new Error("tags needs --version");
    process.stdout.write(
      `${releaseTags(values.version, values.existing.split(/\s+/)).join("\n")}\n`,
    );
  } else {
    throw new Error("usage: docker.mjs matrix|images|tags");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
