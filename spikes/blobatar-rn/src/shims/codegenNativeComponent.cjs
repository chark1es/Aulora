"use strict";

/*
 * Test double for
 *   react-native/Libraries/Utilities/codegenNativeComponent
 *
 * Returned as a string so react-test-renderer treats it as a host element
 * (e.g. "RNSVGPath"), which is what lets us see a real element tree without a
 * native runtime.
 */
function codegenNativeComponent(name) {
  return name;
}

module.exports = { __esModule: true, default: codegenNativeComponent };
