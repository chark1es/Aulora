#!/usr/bin/env node
/**
 * Regenerates `src/icons.ts` from Google's Material Symbols via Iconify
 * (`@iconify-json/material-symbols`, Apache-2.0: commercial use allowed,
 * preserve its license and notices). Run with `bun run icons` after editing ICONS.
 *
 * Each entry maps an Aulora icon name to a Material Symbols icon. Only the
 * icons listed here are shipped, so nothing is fetched at runtime.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICONS = {
  search: "search-rounded",
  plus: "add-rounded",
  x: "close-rounded",
  hash: "tag-rounded",
  clock: "schedule-rounded",
  kanban: "view-kanban-outline-rounded",
  calendar: "calendar-today-outline-rounded",
  flag: "flag-rounded",
  timer: "timer-outline-rounded",
  play: "play-arrow-rounded",
  stop: "stop-rounded",
  archive: "archive-outline-rounded",
  unarchive: "unarchive-outline-rounded",
  link: "link-rounded",
  copy: "content-copy-outline-rounded",
  label: "label-outline-rounded",
  checklist: "checklist-rounded",
  "list-bulleted": "format-list-bulleted-rounded",
  "list-numbered": "format-list-numbered-rounded",
  history: "history-rounded",
  "arrow-up": "arrow-upward-rounded",
  at: "alternate-email-rounded",
  megaphone: "campaign-outline-rounded",
  announce: "rss-feed-rounded",
  message: "chat-bubble-outline-rounded",
  compose: "edit-square-outline-rounded",
  send: "send-outline-rounded",
  paperclip: "attach-file-rounded",
  smile: "mood-outline-rounded",
  code: "code-rounded",
  reply: "reply-rounded",
  thread: "forum-outline-rounded",
  pencil: "edit-outline-rounded",
  trash: "delete-outline-rounded",
  pin: "keep-outline-rounded",
  "chevron-down": "keyboard-arrow-down-rounded",
  "chevron-left": "chevron-left-rounded",
  "chevron-right": "chevron-right-rounded",
  users: "group-outline-rounded",
  "user-plus": "person-add-outline-rounded",
  lock: "lock-outline-rounded",
  check: "check-rounded",
  settings: "settings-outline-rounded",
  shield: "shield-outline-rounded",
  sun: "light-mode-outline-rounded",
  moon: "dark-mode-outline-rounded",
  desktop: "desktop-windows-outline-rounded",
  "more-vertical": "more-vert-rounded",
  "more-horizontal": "more-horiz-rounded",
  menu: "menu-rounded",
  logout: "logout-rounded",
  bell: "notifications-outline-rounded",
  "arrow-down": "arrow-downward-rounded",
  file: "description-outline-rounded",
  image: "image-outline-rounded",
  camera: "photo-camera-outline-rounded",
  sidebar: "dock-to-right-outline-rounded",
  download: "download-rounded",
  phone: "call-outline-rounded",
  "phone-off": "phone-disabled-rounded",
  "phone-hangup": "call-end-outline-rounded",
  "phone-incoming": "call-received-rounded",
  video: "videocam-outline-rounded",
  "video-off": "videocam-off-outline-rounded",
  mic: "mic-outline-rounded",
  "mic-off": "mic-off-outline-rounded",
  headphones: "headphones-outline-rounded",
  "headphones-off": "headset-off-outline-rounded",
  monitor: "screen-share-outline-rounded",
  "monitor-off": "stop-screen-share-outline-rounded",
  pip: "picture-in-picture-alt-outline-rounded",
  volume: "volume-up-outline-rounded",
  "volume-off": "volume-off-outline-rounded",
  signal: "signal-cellular-alt-rounded",
  expand: "open-in-full-rounded",
  grid: "grid-view-outline-rounded",
  hand: "pan-tool-outline-rounded",
  "bell-off": "notifications-off-outline-rounded",
  eye: "visibility-outline-rounded",
  "eye-off": "visibility-off-outline-rounded",
  note: "sticky-note-2-outline-rounded",
  mail: "mail-outline-rounded",
  ban: "block-outline-rounded",
  "image-plus": "add-photo-alternate-outline-rounded",
  shieldoff: "remove-moderator-outline-rounded",
  key: "key-outline-rounded",
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const set = require("@iconify-json/material-symbols/icons.json");
const iconMap = new Map(Object.entries(set.icons));
const aliasMap = new Map(Object.entries(set.aliases ?? {}));
const seen = new Set();

function resolve(name) {
  if (seen.has(name)) {
    throw new Error(`Material Symbols alias cycle at "${name}"`);
  }
  seen.add(name);
  const icon = iconMap.get(name);
  if (icon !== undefined) return icon;
  const alias = aliasMap.get(name);
  if (alias && !alias.hFlip && !alias.vFlip && !alias.rotate) return resolve(alias.parent);
  throw new Error(`Material Symbols has no icon "${name}"`);
}

const PATH = /<path\s+(?:fill="currentColor"\s+)?d="([^"]+)"\s*\/>/g;
const viewBox = { width: 24, height: 24, left: 0, top: 0 };
const lines = [];
for (const [name, source] of Object.entries(ICONS)) {
  const icon = resolve(source);
  const box = { ...viewBox, ...set, ...icon };
  if (box.width !== 24 || box.height !== 24 || box.left !== 0 || box.top !== 0) {
    throw new Error(`${source}: expected a 24x24 view box`);
  }
  const paths = [...icon.body.matchAll(PATH)].map((m) => m[1]);
  if (paths.length === 0 || icon.body.replace(PATH, "").trim() !== "") {
    throw new Error(`${source}: body is not plain <path d> markup: ${icon.body}`);
  }
  const key = /^[a-z_]\w*$/i.test(name) ? name : JSON.stringify(name);
  lines.push(`  ${key}: [${paths.map((d) => JSON.stringify(d)).join(", ")}],`);
}

const out = `/**
 * Shared icon set: Google Material Symbols (rounded, 24x24 grid, weight 400)
 * via Iconify, licensed Apache-2.0 (commercial use allowed, preserve its license
 * and notices). Every glyph is a filled path drawn with \`currentColor\`. Both
 * \`@aulora/ui-web\` (SVG) and \`@aulora/ui-native\` (react-native-svg) render
 * these same paths, so an icon looks identical on every client.
 *
 * GENERATED by \`scripts/generate-icons.mjs\`; edit the ICONS map there and run
 * \`bun run icons\` instead of editing this file.
 */
export const iconPaths = {
${lines.join("\n")}
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof iconPaths;

export const ICON_NAMES = Object.keys(iconPaths) as IconName[];
`;
writeFileSync(join(root, "src/icons.ts"), out);
console.log(`Wrote ${lines.length} icons`);
