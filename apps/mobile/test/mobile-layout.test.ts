import ts from "typescript";
import { describe, expect, it } from "vitest";
import { layoutExceptions } from "./mobile-layout-allowlist";

declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { eager: true; query: string; import: string },
    ): Record<string, string>;
  }
}
const content = import.meta.glob(
  [
    "../src/components/**/*.tsx",
    "../src/providers/*.tsx",
    "../app/**/*.tsx",
    "../../../packages/ui-native/src/*.tsx",
  ],
  { eager: true, query: "?raw", import: "default" },
);
const configs = import.meta.glob(
  ["../tailwind.config.ts", "../../../packages/tokens/src/scales.ts"],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);
const tailwindConfig = configs["../tailwind.config.ts"] ?? "";
const tokenScales = configs["../../../packages/tokens/src/scales.ts"] ?? "";
const sourceFiles = Object.fromEntries(
  Object.entries(content).map(([path, source]) => [path.slice(3), source]),
);
const sources = Object.keys(sourceFiles).filter((path) => !path.startsWith("../../packages/"));
const root = "";
const resolve = (...parts: string[]) => parts.filter(Boolean).join("/");
const read = (path: string): string => {
  const source = sourceFiles[path];
  if (source === undefined) throw new Error(`Missing source: ${path}`);
  return source;
};
const relative = (path: string) => path;

// Nested screens must declare their inset-owning host. New screens have no implicit exemption.
const hosts: Record<string, string> = {
  "src/components/ConnectScreen.tsx": "app/connect.tsx",
  "src/components/SetupScreen.tsx": "src/components/SessionGate.tsx",
  "src/components/SignInScreen.tsx": "src/components/SessionGate.tsx",
  "src/components/voice/JoinedElsewhereScreen.tsx": "src/components/chat/ChatConversation.tsx",
  "src/components/notes/NotesScreen.tsx": "src/components/chat/ChatHubPane.tsx",
  "src/components/kanban/KanbanScreen.tsx": "src/components/chat/ChatHubPane.tsx",
  "src/components/notes/NoteEditorScreen.tsx": "src/components/chat/ChatHubPane.tsx",
  "src/components/notes/NoteHistoryScreen.tsx": "src/components/chat/ChatHubPane.tsx",
  "src/components/notes/NotePreview.tsx": "src/components/chat/Sheet.tsx",
  "src/components/chat/ThreadModal.tsx": "src/components/chat/SlideOver.tsx",
  "src/components/voice/CallVideo.tsx": "src/components/voice/CallScreen.tsx",
};
// The composer is split across sibling files; guards read them together.
const COMPOSER_FILES = [
  "src/components/chat/Composer.tsx",
  "src/components/chat/ComposerNotices.tsx",
  "src/components/chat/ComposerSuggestions.tsx",
  "src/components/chat/ComposerInputRow.tsx",
];
const composerSource = () => COMPOSER_FILES.map((path) => read(resolve(root, path))).join("\n");
const safe = /ScreenContainer|useScreenInsets|<(?:Sheet|BottomSheet|SlideOver)\b/;

const parseTsx = (path: string) =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Visits every node of a parsed file, depth first. */
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => {
    walk(child, visit);
  });
}

const FILL_EDGES = [/top:\s*0/, /bottom:\s*0/, /left:\s*0/, /right:\s*0/];

const absoluteOffsetFailures = (path: string): string[] => {
  const ast = parseTsx(path);
  const exempt = layoutExceptions[relative(path)] !== undefined;
  const failures: string[] = [];
  walk(ast, (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const text = node.getText(ast);
      const placed =
        /position:\s*["']absolute["']/.test(text) && /(?:top|bottom):\s*-?\d/.test(text);
      const fill = FILL_EDGES.every((edge) => edge.test(text));
      if (placed && !fill && !/insets\./.test(text) && !exempt) failures.push(relative(path));
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const text = node.getText(ast);
      if (/\babsolute\b/.test(text) && /\b(?:top|bottom)-\d/.test(text) && !exempt)
        failures.push(relative(path));
    }
  });
  return failures;
};

const ROW = /flex-row|flexDirection:\s*["']row/;
const FIXED_HEIGHT = /(?<![\w-])h-(?:\d|\[)|\bheight:\s*\d/;
const RN_TEXT_IMPORT = /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*["']react-native["']/;

/** Row text must shrink or truncate, and its container must not fix a height. */
const rowTextFailures = (path: string): string[] => {
  const ast = parseTsx(path);
  const source = read(path);
  const failures: string[] = [];
  walk(ast, (node) => {
    if (
      !ts.isJsxElement(node) ||
      !/^(Text|Heading)$/.test(node.openingElement.tagName.getText(ast))
    )
      return;
    let parent: ts.Node | undefined = node.parent;
    while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
    if (!parent || !ts.isJsxElement(parent)) return;
    const tag = parent.openingElement.getText(ast);
    const text = node.openingElement.getText(ast);
    const inRow = ROW.test(tag);
    if (
      inRow &&
      RN_TEXT_IMPORT.test(source) &&
      !/numberOfLines|flexShrink|shrink|min-w-0/.test(text)
    )
      failures.push(`${relative(path)}: raw row Text requires a shrink or line limit`);
    if (inRow && /flexShrink:\s*0/.test(text) && !/numberOfLines/.test(text))
      failures.push(`${relative(path)}: row Text disables shrinking`);
    if (FIXED_HEIGHT.test(tag.replace(/shadowOffset:\s*\{[^}]*\}/g, "")))
      failures.push(`${relative(path)}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}`);
  });
  return failures;
};

describe("mobile safe layout source guards", () => {
  it("requires an inset owner for every route, screen and native modal", () => {
    const failures: string[] = [];
    for (const path of sources) {
      const source = read(path);
      if (
        !(
          /Screen\.tsx$|Modal\.tsx$/.test(path) ||
          relative(path).startsWith("app/") ||
          /<Modal\b/.test(source)
        )
      )
        continue;
      if (safe.test(source)) continue;
      const host = hosts[relative(path)];
      if (!host || !safe.test(read(resolve(root, host)))) failures.push(relative(path));
    }
    expect(failures).toEqual([]);
  });

  it("rejects hard-coded absolute window offsets without an inset expression", () => {
    const failures = sources.flatMap((path) => absoluteOffsetFailures(path));
    expect(failures).toEqual([]);
  });

  it("keeps row text shrinkable and text-bearing containers free of fixed heights", () => {
    const failures = sources.flatMap((path) => rowTextFailures(path));
    expect(failures).toEqual([]);
  });

  // Shared Text/Heading carry flexShrink/minWidth defaults, so row text without its own limit still shrinks.
  it("gives the shared Text and Heading a shrinking default", () => {
    for (const file of ["Text", "Heading"])
      expect(read(resolve(root, `../../packages/ui-native/src/${file}.tsx`))).toContain(
        "flexShrink: 1",
      );
  });

  it("centralizes safe-area reads and avoids a duplicate home-indicator inset above the IME", () => {
    const layout = read(resolve(root, "src/components/layout/ScreenContainer.tsx"));
    expect(layout).toContain("keyboardVisible ? 0 : insets.bottom");
    expect(layout).toContain("Math.max(insets.bottom, 12)");
    for (const path of sources.filter((path) => !path.endsWith("/layout/ScreenContainer.tsx"))) {
      expect(read(path), relative(path)).not.toMatch(/\buseSafeAreaInsets\b|\bSafeAreaView\b/);
    }
    expect(read(resolve(root, "src/components/chat/Composer.tsx"))).toContain(
      "insets.keyboardBottom",
    );
    expect(read(resolve(root, "src/components/chat/ChatConversation.tsx"))).toContain(
      "<KeyboardAvoidingPane",
    );
  });

  // Found on an Android 16 emulator: the keyboard controller's view measures its
  // frame against its parent, so a pane below a banner or inset left the composer
  // under the keyboard. Every keyboard-avoiding pane goes through the shared one,
  // which measures its real window position.
  it("keeps the window-measured keyboard-avoiding wrapper in the shared layout", () => {
    const layout = read(resolve(root, "src/components/layout/ScreenContainer.tsx"));
    expect(layout).toMatch(/export function KeyboardAvoidingPane/);
    expect(layout).toContain("measureInWindow");
    expect(layout).toContain("keyboardVerticalOffset={offset}");
    expect(layout).toContain('"keyboardWillShow"');
  });

  it("never imports the raw keyboard-avoiding view outside the shared wrapper", () => {
    const rawView = /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*["']([^"']+)["']/;
    const direct = sources
      .filter((path) => !path.endsWith("/layout/ScreenContainer.tsx"))
      .filter((path) => {
        const module = rawView.exec(read(path))?.[1];
        return module === "react-native-keyboard-controller" || module === "react-native";
      })
      .map(relative);
    expect(direct).toEqual([]);
  });

  it("routes every pane and form sheet through the shared keyboard-avoiding pane", () => {
    for (const path of [
      "src/components/chat/ChatConversation.tsx",
      "src/components/chat/SlideOver.tsx",
      "src/components/kanban/KanbanScreen.tsx",
      "src/components/notes/NotesScreen.tsx",
      // Form sheets: RN's behavior="height" left fields under the keyboard on
      // edge-to-edge Android, where the window no longer resizes.
      "src/components/chat/Sheet.tsx",
      "src/components/kanban/sheets.tsx",
    ])
      expect(read(resolve(root, path)), path).toContain("<KeyboardAvoidingPane");
  });

  // Edge-to-edge Android no longer resizes the window for the keyboard, so the
  // core view left Continue/Sign in under it at 2x text on a short screen.
  it("keeps pre-session forms in the keyboard-aware auth scroller", () => {
    const scaffold = read(resolve(root, "src/components/AuthScaffold.tsx"));
    expect(scaffold).toContain("<KeyboardAwareScrollView");
    // Auth screens use the shared form scroller at its default clearance.
    expect(scaffold).toContain("bottomOffset = AUTH_KEYBOARD_CLEARANCE,");
    expect(scaffold).toContain("bottomOffset={bottomOffset}");
    expect(scaffold).toContain("return <FormScroll>{children}</FormScroll>;");
    // Settles once shown when system animations are removed (no keyboard frames).
    expect(scaffold).toContain("assureFocusedInputVisible");
    for (const path of [
      "src/components/ConnectScreen.tsx",
      "src/components/JoinGate.tsx",
      "src/components/SignInScreen.tsx",
      "src/components/SetupScreen.tsx",
    ]) {
      const source = read(resolve(root, path));
      expect(source, path).toContain("<AuthScroll>");
      expect(source, path).not.toMatch(/<KeyboardAvoidingView\b/);
    }
  });

  it("keeps the composer input above the keyboard when suggestions or rows grow", () => {
    // Suggestions shrink and scroll instead of pushing the input down.
    const suggestions = read(resolve(root, "src/components/chat/ComposerSuggestions.tsx"));
    expect(suggestions).toMatch(
      /<ScrollView[\s\S]{0,500}flexShrink: 1,[\s\S]{0,200}minHeight:\s*rowHeights\s*\.slice\(0, Math.min\(MEASURED_ROWS, suggestions.length\)\)/,
    );
    expect(suggestions).toContain("const MEASURED_ROWS = 2;");
    const composer = read(resolve(root, "src/components/chat/Composer.tsx"));
    expect(composer).toMatch(
      /flexShrink: 1,\s*paddingBottom: Math\.max\(insets\.keyboardBottom, 8\),\s*justifyContent: "flex-end",\s*overflow: "hidden",/,
    );
  });

  it("does not render the empty length-limit row (an empty line is ~30dp at 2x text)", () => {
    const notices = read(resolve(root, "src/components/chat/ComposerNotices.tsx"));
    expect(notices).toContain("const nearLimit = textLength >= MESSAGE_MAX_LENGTH * 0.9;");
    expect(notices).toContain("if (limitError === null && !nearLimit) return null;");
  });

  it("never splits a short label mid-word in sheet headers or segment rows", () => {
    const sheet = read(resolve(root, "src/components/chat/Sheet.tsx"));
    expect(sheet).not.toContain("max-w-[30%]");
    expect(sheet.match(/max-w-\[45%\] shrink-0/g)).toHaveLength(2);
    const create = read(resolve(root, "src/components/chat/CreateChannelSheet.tsx"));
    expect(create).toContain('className="mt-3 flex-row flex-wrap gap-2"');
    expect(create).not.toMatch(/"flex-1 items-center rounded-input border/);
  });

  // NativeWind's native rem is 14, so spacing keys outside the shared 4px token
  // scale render 12.5% small: `h-11` measured 38.5dp on the emulator.
  it("gives every sized pressable a 44dp touch target", () => {
    expect(tailwindConfig).toContain('spacing: { 9: "36px", 11: "44px" }');
    const px: Record<string, number> = { 9: 36, 11: 44 };
    for (const match of tokenScales.matchAll(/^\s*(\d+): "(\d+)px",$/gm))
      px[match[1] as string] = Number(match[2]);
    const failures: string[] = [];
    for (const path of Object.keys(sourceFiles).filter((path) => path.endsWith(".tsx"))) {
      const source = read(path);
      for (const match of source.matchAll(/<(?:Pressable|TouchableOpacity)\b([\s\S]*?)>/g)) {
        const props = match[1] ?? "";
        const size = /className=\{?[\x60"](?:[^\x60"]*?\s)?(?:min-)?h-(\d+)\b/.exec(props);
        if (!size) continue;
        const height = px[size[1] as string] ?? Number(size[1]) * 3.5;
        const slop = /hitSlop=\{(?:\{ top: )?(\d+)/.exec(props);
        const target = height + 2 * Number(slop?.[1] ?? 0);
        if (target < 44) {
          const line = source.slice(0, match.index).split("\n").length;
          failures.push(`${relative(path)}:${line} is ${target}dp`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // Found at 2x text on a 360dp phone: "Chann…" in the dock, a clipped demo banner.
  it("keeps primary navigation and the demo banner readable at large text", () => {
    const dock = read(resolve(root, "src/components/chat/DockTab.tsx"));
    const tab = dock.slice(dock.indexOf("const DOCK_TAB_BASE"));
    expect(tab).toContain("numberOfLines={dockLabelLines(label)}");
    expect(tab).toContain("adjustsFontSizeToFit");
    expect(tab).not.toContain("numberOfLines={1}");
    expect(tab).toMatch(/min-h-\[52px\]/);
    expect(dock).toContain("return hasWhitespace ? 2 : 1;");
    const demo = read(resolve(root, "src/components/ReviewDemoScreen.tsx"));
    const notice = demo.slice(demo.indexOf("function DemoNotice("));
    expect(notice).not.toContain("numberOfLines={1}");
  });

  it("gives composer chips and dismiss controls whole 44dp targets", () => {
    const notices = read(resolve(root, "src/components/chat/ComposerNotices.tsx"));
    expect(notices).toMatch(
      /accessibilityLabel=\{\x60Remove \$\{entry\.file\.name\}\x60\}\s*className="min-h-11 min-w-11 /,
    );
    expect(notices).toMatch(
      /accessibilityLabel="Dismiss message error"\s*className="[^"]*h-11 w-11/,
    );
  });

  it("keeps one announcement path for the mass-mention hint and no reserved empty row", () => {
    const composer = composerSource();
    expect(composer).not.toContain("accessibilityLiveRegion");
    expect(composer).not.toContain("minHeight: 32");
  });

  // The platform switch is ~35dp; the row is the target, label included.
  it("puts every toggle in a full-row switch target", () => {
    const row = read(resolve(root, "../../packages/ui-native/src/SwitchRow.tsx"));
    expect(row).toContain('accessibilityRole="switch"');
    expect(row).toContain("onValueChange(!value)");
    expect(row).toContain("settingRowClass(");
    const bare = sources.filter((path) => /<Switch\b/.test(read(path))).map(relative);
    expect(bare).toEqual([]);
  });

  // Found on an Android 16 emulator at 2x text on a 360x640dp phone with the
  // keyboard up: each primary action was under the keyboard or the sheet itself was.
  it("keeps every form sheet's primary action above the keyboard", () => {
    for (const path of [
      "src/components/chat/CreateChannelSheet.tsx",
      "src/components/chat/EditChannelSheet.tsx",
      "src/components/chat/UserNoteSheet.tsx",
      "src/components/kanban/NewBoardSheet.tsx",
      "src/components/kanban/BoardSettingsSheet.tsx",
    ])
      expect(read(resolve(root, path)), path).toMatch(/<Sheet[\s\S]{0,400}footer=\{/);
    const profile = read(resolve(root, "src/components/chat/ProfileEditor.tsx"));
    expect(profile).toContain("<KeyboardStickyView>");
    expect(profile.match(/<ProfileFormLayout/g)).toHaveLength(2);
    expect(profile).not.toContain("<KeyboardAvoidingPane");
    // Gorhom sheets: "adjustResize" waited for a window resize edge-to-edge
    // Android never sends, leaving edit/emoji sheets entirely under the keyboard.
    const bottom = read(resolve(root, "src/components/chat/BottomSheet.tsx"));
    expect(bottom).toContain('android_keyboardInputMode="adjustPan"');
    expect(bottom).toContain("topInset={windowTop}");
    expect(bottom).toContain("useWindowInsets().top");
    // The provider spans the window, not just the panes under the demo banner.
    const screen = read(resolve(root, "src/components/chat/ChatScreen.tsx"));
    const panes = screen.slice(screen.indexOf("function ChatScreenPanes("));
    expect(panes).not.toContain("BottomSheetModalProvider");
    expect(screen.match(/<BottomSheetModalProvider>/g)).toHaveLength(2);
    expect(screen).toContain("<RebasedInsets insets={noticeInsets}>");
    const actions = read(resolve(root, "src/components/chat/MessageActionsSheet.tsx"));
    expect(actions).toContain("Math.min(200, windowHeight * 0.2)");
  });

  it("keeps the composer input visible when the screen is too short", () => {
    const demo = read(resolve(root, "src/components/ReviewDemoScreen.tsx"));
    expect(demo).toMatch(/\{!keyboardVisible && \(\s*<Text size="xs" tone="muted"/);
  });

  it("fades scrolled forms under the status bar instead of cutting them", () => {
    const scaffold = read(resolve(root, "src/components/AuthScaffold.tsx"));
    expect(scaffold).toContain("{scrolled && <ScrollEdgeFade surface={surface} />}");
    expect(scaffold).toContain("event.nativeEvent.contentOffset.y > 2");
  });

  it("imports device fixtures only inside the __DEV__ branch Metro folds away in release", () => {
    const route = read(resolve(root, "app/dev-sheets.tsx"));
    const gate = route.indexOf("if (__DEV__) {");
    const imported = route.indexOf('import("../src/dev/SheetFixtures")');
    const fallback = route.indexOf('return <Redirect href="/" />;');
    expect(gate).toBeGreaterThan(-1);
    // The import must sit inside the folded-away branch, before the release redirect.
    expect(imported).toBeGreaterThan(gate);
    expect(fallback).toBeGreaterThan(imported);
    expect(route).not.toMatch(/^import .*SheetFixtures/m);
    expect(route).not.toContain("if (!__DEV__)");
  });

  it("keeps the device fixtures out of every other module", () => {
    for (const path of sources.filter((path) => !path.startsWith("app/dev-sheets")))
      expect(read(path), path).not.toContain("dev/SheetFixtures");
  });

  it("silences only the known third-party Reanimated dependency warning, in dev", () => {
    const layout = read(resolve(root, "app/_layout.tsx"));
    expect(layout).toMatch(
      /if \(__DEV__\) \{[\s\S]*LogBox\.ignoreLogs\(\["\[Reanimated\] Dependencies should only be used on the web"\]\);\s*\}/,
    );
  });
});
