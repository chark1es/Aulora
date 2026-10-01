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

const seedPath = join(mobile, "src/lib/review-demo.ts");
let seed = readFileSync(seedPath, "utf8");
seed = seed.replaceAll("Date.now()", "new Date('2026-10-02T09:41:00').getTime()");
const start = seed.indexOf('  seed(\n    "welcome"');
const end = seed.indexOf("  for (const member of REVIEW_MEMBERS)", start);
if (start < 0 || end < 0) throw new Error("Review demo seed changed; update capture fixture.");
seed = `${seed.slice(0, start)}
  seed("welcome", generalId, "sam", "Good morning, team! The launch checklist is ready. Let's keep updates in this channel.", 35, { pinnedAt: now - 35 * 60_000 });
  seed("explore", generalId, "jordan", "The refreshed homepage is ready for review. I've shared the final notes in #design.", 30, { replyCount: 3, lastReplyAt: now - 22 * 60_000 });
  seed("reply", generalId, REVIEW_USER_ID, "The spacing looks good on mobile. Can we use the same layout for the welcome page?", 25, { threadRootId: "explore" });
  seed("reply-two", generalId, "sam", "Yes. I'll update the welcome page after the review.", 23, { threadRootId: "explore" });
  seed("reply-three", generalId, "jordan", "Perfect. The final assets are in the shared folder.", 22, { threadRootId: "explore" });
  seed("general-3", generalId, REVIEW_USER_ID, "I'll review the copy this morning and leave feedback in the thread.", 28);
  seed("general-4", generalId, "sam", "Thanks, Alex. The handoff is at **10:30**. We can walk through the remaining questions together.", 24);
  seed("general-5", generalId, "jordan", "A quick checklist for today:\\n- Review the homepage\\n- Check the mobile layout\\n- Share the final launch notes", 20);
  seed("general-6", generalId, REVIEW_USER_ID, "Mobile review is done. Everything is ready on my side.", 16);
  seed("general-7", generalId, "sam", "Great. I'll take the accessibility review next.", 12);
  seed("general-8", generalId, "jordan", "I've also updated #announcements so everyone has the latest plan.", 9);
  seed("general-9", generalId, REVIEW_USER_ID, "Thanks! See you all at the handoff.", 5);
  seed("design", designId, "jordan", "The **ember** accent gives the new welcome screen a warm, clear focus.", 32, { replyCount: 2, lastReplyAt: now - 20 * 60_000 });
  seed("design-thread-1", designId, "sam", "Let's keep the accent for the primary action.", 23, { threadRootId: "design" });
  seed("design-thread-2", designId, REVIEW_USER_ID, "Agreed. The secondary controls can stay neutral.", 20, { threadRootId: "design" });
  seed("design-reply", designId, REVIEW_USER_ID, "Looks good in light and dark mode. The text is easy to read in both.", 28, { editedAt: now - 10 * 60_000 });
  seed("design-3", designId, "sam", "The navigation labels are much clearer now. Can we keep these in the final handoff?", 24);
  seed("design-4", designId, "jordan", "Yes, the labels and spacing are final. I've added the details to the notes.", 19);
  seed("design-5", designId, REVIEW_USER_ID, "I'll check the tablet layout before we wrap up.", 14);
  seed("design-6", designId, "sam", "Thank you! The wider view should make the longer conversations easier to follow.", 8);
  seed("announcement", announcementsId, "sam", "**Launch handoff**\\n\\nThe workspace is ready for our next project. Share updates in #general and design feedback in #design.", 20, { pinnedAt: now - 20 * 60_000 });
  seed("announcement-2", announcementsId, "jordan", "Today's handoff starts at **10:30**. Please bring any open questions and the final review notes.", 10);
  seed("dm", dm.channelId, "sam", "Hey Alex, do you have a moment to review the launch notes?", 30);
  seed("dm-2", dm.channelId, REVIEW_USER_ID, "Sure. I've just finished the mobile review.", 27);
  seed("dm-3", dm.channelId, "sam", "Thank you! I'd like a second pair of eyes on the welcome message and the channel descriptions.", 24);
  seed("dm-4", dm.channelId, REVIEW_USER_ID, "The welcome message reads well. I'd shorten the design channel description to one sentence.", 20);
  seed("dm-5", dm.channelId, "sam", "Good call. I'll update it before the handoff.", 16);
  seed("dm-6", dm.channelId, REVIEW_USER_ID, "Everything else looks ready. I'll share my notes in #general.", 11);
  seed("dm-7", dm.channelId, "sam", "Perfect, thanks for the quick review!", 5);
  seed("group", group.channelId, "jordan", "Let's use this conversation to coordinate the handoff.", 30);
  seed("group-2", group.channelId, "sam", "The launch notes are ready. Alex is reviewing the final copy.", 25);
  seed("group-3", group.channelId, REVIEW_USER_ID, "Copy review is done. I've left two small suggestions in #design.", 19);
  seed("group-4", group.channelId, "jordan", "Both changes are in. We are ready for the team review.", 12);
  seed("group-5", group.channelId, "sam", "See you at 10:30!", 5);
  port.state.reactions.set("design", [{ id: "reaction-design", emoji: "🔥", userId: "sam" }]);
  port.state.reactions.set("general-6", [{ id: "reaction-general", emoji: "🙌", userId: "sam" }, { id: "reaction-general-2", emoji: "🙌", userId: "jordan" }]);
  port.state.reactions.set("dm-7", [{ id: "reaction-dm", emoji: "👍", userId: REVIEW_USER_ID }]);
${seed.slice(end)}`;
writeFileSync(seedPath, seed);

const screenPath = join(mobile, "src/components/ReviewDemoScreen.tsx");
let screen = readFileSync(screenPath, "utf8");
screen = `import { CAPTURE_VIEW } from '../lib/capture-state';\n${screen}`;
screen = screen.replace(
  "setChannelId(workspace.firstChannelId);",
  `
        const name = CAPTURE_VIEW === 'direct' ? 'Sam Chen' : CAPTURE_VIEW === 'design' ? 'design' : CAPTURE_VIEW === 'group' ? 'Launch crew' : 'general';
        const selected = [...workspace.port.state.channels.values()].find(row => row.name === name);
        setChannelId(selected?.id ?? workspace.firstChannelId);
        if (CAPTURE_VIEW === 'thread') setThreadRoot(workspace.port.state.messages.get('explore') ?? null);
`,
);
const bannerStart = screen.indexOf("      {fontScale <= 1.5 && (");
const bannerEnd = screen.indexOf("      {demo === undefined", bannerStart);
screen = screen.slice(0, bannerStart) + screen.slice(bannerEnd);
const footerStart = screen.indexOf(
  '              <View className="flex-row items-center justify-between border-t',
);
const footerEnd = screen.indexOf("              <Composer", footerStart);
screen = screen.slice(0, footerStart) + screen.slice(footerEnd);
screen = screen
  .replace('label="Exit demo"', 'label="Workspace"')
  .replace('name="x"', 'name="menu"');
screen = screen
  .replaceAll("Search demo messages", "Search messages")
  .replaceAll("Demo members", "Members")
  .replaceAll("Simulated online presence", "Online");
writeFileSync(screenPath, screen);
writeFileSync(
  join(mobile, "src/lib/capture-state.ts"),
  "export const CAPTURE_VIEW: string = 'general';\n",
);
writeFileSync(
  join(mobile, "app/store-capture.tsx"),
  `import { SafeAreaView } from 'react-native-safe-area-context';
import { ReviewDemoScreen } from '../src/components/ReviewDemoScreen';
import { useEffect } from 'react';
import { TurboModuleRegistry } from 'react-native';
import { CAPTURE_VIEW } from '../src/lib/capture-state';
export default function StoreCapture() {
  useEffect(() => {
    const timer = setInterval(() => TurboModuleRegistry.get<{ hide(): void }>('DevLoadingView')?.hide(), 500);
    return () => clearInterval(timer);
  }, []);
  return <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}><ReviewDemoScreen key={CAPTURE_VIEW} onExit={() => {}} /></SafeAreaView>;
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
