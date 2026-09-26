"use strict";

/*
 * Minimal headless test double for the `react-native` host layer.
 *
 * react-native-svg's native (non-web) build imports exactly this surface:
 *   Platform, StyleSheet, processColor, findNodeHandle, PanResponder,
 *   Image, View, PixelRatio, Touchable, TurboModuleRegistry, unstable_createElement
 *
 * There is no iOS/Android runtime on this Windows box and the real `react-native`
 * package ships Flow-typed source that Node cannot parse without the Jest/Babel
 * pipeline. This shim replaces only the host-component layer so the REAL
 * react-native-svg parser and element components can run. No native drawing
 * happens here; see REPORT.md for the limits of this evidence.
 */

const React = require("react");

const flatten = (style) => {
  if (!style) return {};
  const list = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...list.filter(Boolean).map(flatten));
};

const StyleSheet = {
  create: (styles) => styles,
  flatten,
  compose: (a, b) => Object.assign({}, a, b),
  absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  hairlineWidth: 1,
};

const Platform = {
  OS: "ios",
  Version: "17.0",
  isPad: false,
  isTV: false,
  select: (spec) =>
    spec[Platform.OS] !== undefined ? spec[Platform.OS] : spec.default,
};

// RN returns a 32-bit ARGB int for solid colors. blobatar fills are hex strings.
function processColor(color) {
  if (typeof color !== "string") return color ?? null;
  const s = color.trim();
  if (s === "transparent") return 0;
  if (s === "none" || s === "currentColor") return null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    const n = parseInt(h, 16);
    const rgba = (n >>> 0);
    const r = (rgba >>> 24) & 0xff;
    const g = (rgba >>> 16) & 0xff;
    const b = (rgba >>> 8) & 0xff;
    const a = rgba & 0xff;
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseFloat(p));
    const [r, g, b, a = 1] = parts;
    return (
      ((Math.round(a * 255) << 24) |
        (r << 16) |
        (g << 8) |
        b) >>>
      0
    );
  }
  return 0;
}

const Image = "Image";
const View = "View";

module.exports = {
  Platform,
  StyleSheet,
  processColor,
  findNodeHandle: () => null,
  PanResponder: { create: () => ({ panHandlers: {} }) },
  PixelRatio: {
    get: () => 2,
    getFontScale: () => 1,
    roundToNearestPixel: (n) => n,
    getPixelSizeForLayoutSize: (n) => n * 2,
  },
  Touchable: {
    Mixin: {
      touchableGetInitialState: () => ({}),
      touchableHandleStartShouldSetResponder: () => false,
      touchableHandleResponderTerminationRequest: () => true,
      touchableHandleResponderGrant: () => {},
      touchableHandleResponderMove: () => {},
      touchableHandleResponderRelease: () => {},
      touchableHandleResponderTerminate: () => {},
      touchableHandlePress: () => {},
      touchableHandleActivePressIn: () => {},
      touchableHandleActivePressOut: () => {},
      touchableHandleLongPress: () => {},
    },
  },
  TurboModuleRegistry: {
    get: () => null,
    getEnforcing: () => ({}),
  },
  unstable_createElement: (type, props, ...children) =>
    React.createElement(type, props, ...children),
  Image,
  View,
};
