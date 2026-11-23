import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMatrix, IMAGES, releaseTags } from "./docker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("every published image has a Dockerfile and a Compose service that names it", () => {
  const coolify = read("infra/docker/docker-compose.coolify.yml");
  const compose = read("infra/docker/docker-compose.yml");
  for (const image of IMAGES) {
    expect(existsSync(resolve(root, image.dockerfile))).toBe(true);
    expect(existsSync(resolve(root, image.context))).toBe(true);
    expect(compose).toContain(
      `\${AULORA_IMAGE_REGISTRY:-ghcr.io/chark1es}/${image.name}:\${AULORA_IMAGE_TAG:-`,
    );
    // The Coolify file omits the smtp gateway, which Coolify cannot run.
    if (image.name !== "aulora-smtp-gateway") expect(coolify).toContain(`/${image.name}:`);
    expect(read(image.dockerfile)).toContain("org.opencontainers.image.version");
  }
});

test("the matrix builds each image on a native runner per architecture", () => {
  const { include } = buildMatrix();
  expect(include).toHaveLength(IMAGES.length * 2);
  const web = include.filter((row) => row.image === "aulora-web");
  expect(web.map((row) => [row.platform, row.runner])).toEqual([
    ["linux/amd64", "ubuntu-24.04"],
    ["linux/arm64", "ubuntu-24.04-arm"],
  ]);
  expect(buildMatrix("linux/amd64").include.every((row) => row.arch === "amd64")).toBe(true);
  expect(buildMatrix("linux/amd64,linux/amd64").include).toHaveLength(IMAGES.length);
  expect(() => buildMatrix("linux/s390x")).toThrow("Unsupported");
  expect(() => buildMatrix(" , ")).toThrow("at least one");
});

test("a new release gets exact, minor, major and latest tags", () => {
  expect(releaseTags("1.6.2", ["v1.6.1", "v1.5.0", "v1.0.0"])).toEqual([
    "1.6.2",
    "1.6",
    "1",
    "latest",
  ]);
  expect(releaseTags("1.0.0")).toEqual(["1.0.0", "1.0", "1", "latest"]);
});

test("floating tags never move backward when an old release is re-published", () => {
  const existing = ["v1.6.2", "v1.6.1", "v1.5.3", "v2.0.0"];
  expect(releaseTags("1.6.1", existing)).toEqual(["1.6.1"]);
  expect(releaseTags("1.5.3", existing)).toEqual(["1.5.3", "1.5"]);
  expect(releaseTags("1.7.0", ["v1.6.2", "v2.0.0"])).toEqual(["1.7.0", "1.7", "1"]);
  // Re-running the newest release is idempotent and ignores its own tag.
  expect(releaseTags("2.0.0", existing)).toEqual(["2.0.0", "2.0", "2", "latest"]);
  expect(() => releaseTags("v1.0.0")).toThrow();
});
