import { readFileSync, writeFileSync } from "node:fs";
import { assertInstalledRuntime, nativeRuntime, updateConfig } from "./mobile-ota.cjs";

const projectId = process.env.EAS_PROJECT_ID;
const manifest = {
  enabled: Boolean(projectId),
  projectId: projectId || null,
  runtimeVersion: nativeRuntime(),
  channel: "production",
};
if (projectId) updateConfig(projectId, manifest.runtimeVersion);
if (process.argv[2] === "check") {
  const base = JSON.parse(readFileSync(process.argv[3], "utf8"));
  assertInstalledRuntime(base, manifest);
} else {
  writeFileSync(process.argv[2], `${JSON.stringify(manifest, null, 2)}\n`);
}
