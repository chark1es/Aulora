// Stages a disposable Metro workspace. The shipping app and review demo stay unchanged.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stage = join(root, ".cache/store-capture");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "package.json"), join(stage, "package.json"));
symlinkSync(join(root, "node_modules"), join(stage, "node_modules"));
cpSync(join(root, "packages"), join(stage, "packages"), {
  recursive: true,
  filter: (path) => !/(?:\/node_modules|\/dist|\/\.cache)(?:\/|$)/.test(path),
});
for (const name of readdirSync(join(root, "packages"))) {
  const dependencies = join(root, "packages", name, "node_modules");
  if (existsSync(dependencies))
    symlinkSync(dependencies, join(stage, "packages", name, "node_modules"));
}
const mobile = join(stage, "apps/mobile");
mkdirSync(mobile, { recursive: true });
for (const name of [
  "app",
  "src",
  "assets",
  "package.json",
  "app.json",
  "babel.config.js",
  "metro.config.js",
  "tailwind.config.ts",
  "global.css",
  "tsconfig.json",
])
  cpSync(join(root, "apps/mobile", name), join(mobile, name), { recursive: true });
symlinkSync(join(root, "apps/mobile/node_modules"), join(mobile, "node_modules"));
const metroPath = join(mobile, "metro.config.js");
writeFileSync(
  metroPath,
  readFileSync(metroPath, "utf8").replace(
    "config.watchFolders = [workspaceRoot];",
    `config.watchFolders = [workspaceRoot, ${JSON.stringify(root)}];`,
  ),
);

// The capture shell renders the shipping review demo unchanged; it just hides
// the offline label and opens a chosen conversation. No source patching, so a
// demo redesign can never silently break the capture fixtures.
writeFileSync(
  join(mobile, "src/lib/capture-state.ts"),
  "export const CAPTURE_VIEW: string = 'general';\n",
);
writeFileSync(
  join(mobile, "app/store-capture.tsx"),
  `import { useEffect } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { ReviewDemoScreen } from '../src/components/ReviewDemoScreen';
import { CAPTURE_VIEW } from '../src/lib/capture-state';

const VIEW_BY_NAME: Record<string, { channel: string; thread?: string }> = {
  general: { channel: 'general' },
  direct: { channel: 'Sam Chen' },
  design: { channel: 'design' },
  group: { channel: 'Launch crew' },
  thread: { channel: 'general', thread: 'explore' },
};

export default function StoreCapture() {
  useEffect(() => {
    const timer = setInterval(() => TurboModuleRegistry.get<{ hide(): void }>('DevLoadingView')?.hide(), 500);
    return () => clearInterval(timer);
  }, []);
  const view = VIEW_BY_NAME[CAPTURE_VIEW] ?? { channel: 'general' };
  return (
    <ReviewDemoScreen
      showNotice={false}
      initialChannelName={view.channel}
      initialThreadRootId={view.thread}
      onExit={() => {}}
    />
  );
}
`,
);
writeFileSync(join(mobile, "app/index.tsx"), "export { default } from './store-capture';\n");
const layoutPath = join(mobile, "app/_layout.tsx");
writeFileSync(
  layoutPath,
  readFileSync(layoutPath, "utf8")
    .replace(
      'import { configureNotificationHandler } from "../src/lib/push";',
      'import { LogBox } from "react-native";\nLogBox.ignoreAllLogs();',
    )
    .replace(
      "    configureNotificationHandler();",
      "    // Local capture workspace has no notification registration.",
    ),
);
console.log(
  `Capture workspace: ${mobile}\nStart Metro: cd ${mobile} && bun run start -- --port 8081\nOpen aulora://store-capture on a simulator or emulator debug build.`,
);
