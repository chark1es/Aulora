import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const source = `apps/desktop/src-tauri/target/${process.env.RELEASE_TARGET}/release/bundle`;
const output = "dist/release-desktop";
mkdirSync(output, { recursive: true });
let artifacts = 0;
for (const file of readdirSync(source, { recursive: true })) {
  if (!/\.(dmg|app\.tar\.gz|app\.tar\.gz\.sig|exe|exe\.sig|AppImage|AppImage\.sig|deb)$/.test(file))
    continue;
  let name = basename(file);
  if (name === "Aulora.app.tar.gz" || name === "Aulora.app.tar.gz.sig") {
    name = `Aulora_${process.env.RELEASE_VERSION}_${process.env.RELEASE_PLATFORM}.app.tar.gz${name.endsWith(".sig") ? ".sig" : ""}`;
  }
  if (existsSync(join(output, name))) throw new Error(`Duplicate artifact: ${name}`);
  copyFileSync(join(source, file), join(output, name));
  artifacts++;
}
if (artifacts === 0) throw new Error("No distributable desktop artifacts found.");
console.log(`Collected ${artifacts} distributable files.`);
