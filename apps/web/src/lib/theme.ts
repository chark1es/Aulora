import type { StorageLike } from "@aulora/core";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "aulora.theme.v1";
export const DARK_CLASS = "dark";

const PREFERENCES: readonly ThemePreference[] = ["system", "dark", "light"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

function storage(): StorageLike | null {
  const candidate = (globalThis as { localStorage?: unknown }).localStorage;
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }
  const store = candidate as StorageLike;
  return typeof store.getItem === "function" && typeof store.setItem === "function" ? store : null;
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = storage()?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    storage()?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in private modes; the in-memory choice still applies.
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

/** Applies the resolved theme to `<html>`: the `dark` class and `color-scheme`. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle(DARK_CLASS, resolved === "dark");
    root.style.colorScheme = resolved;
  }
  return resolved;
}

/** Cycles system -> light -> dark -> system, for a one-button toggle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "system") {
    return "light";
  }
  if (current === "light") {
    return "dark";
  }
  return "system";
}
