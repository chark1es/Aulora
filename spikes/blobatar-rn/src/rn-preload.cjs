"use strict";

/*
 * Preloaded with `node --require ./src/rn-preload.cjs`.
 *
 * Node's module customization hooks (module.register / --loader) did NOT
 * intercept bare `require("react-native")` from inside node_modules on this
 * Windows + Node 22.18 combination (verified: resolve hook never fired; require
 * failed MODULE_NOT_FOUND). Patching the CJS resolver directly is reliable and
 * keeps everything inside the spike (no node_modules edits).
 */
const Module = require("node:module");
const path = require("node:path");

const original = Module._resolveFilename;
const rnShim = path.resolve(__dirname, "shims", "react-native.cjs");
const codegenShim = path.resolve(
  __dirname,
  "shims",
  "codegenNativeComponent.cjs"
);

Module._resolveFilename = function (request, ...rest) {
  if (request === "react-native") return rnShim;
  if (request === "react-native/Libraries/Utilities/codegenNativeComponent") {
    return codegenShim;
  }
  if (request.startsWith("react-native/")) {
    throw new Error(`[spike] unmapped react-native subpath: ${request}`);
  }
  return original.call(this, request, ...rest);
};
