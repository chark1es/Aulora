const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Bun workspace: watch the monorepo root so `@aulora/*` sources and the
// generated Convex client (imported by relative path) are bundled.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// The `@aulora/*` packages are plain TypeScript (Vite resolves their ESM
// `./foo.js` specifiers onto `./foo.ts`). Metro does not rewrite extensions, so
// retry a `.js`/`.jsx`/`.mjs` request without the extension before failing.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (/\.(js|jsx|mjs)$/.test(moduleName)) {
      try {
        return context.resolveRequest(context, moduleName.replace(/\.(js|jsx|mjs)$/, ""), platform);
      } catch {
        throw error;
      }
    }
    throw error;
  }
};

module.exports = withNativeWind(config, { input: "./global.css" });
