import { cn, Icon } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import {
  applyTheme,
  nextThemePreference,
  readThemePreference,
  type ThemePreference,
  writeThemePreference,
} from "../lib/theme";

function ThemeGlyph({
  preference,
  size = 20,
}: {
  readonly preference: ThemePreference;
  readonly size?: number;
}) {
  const name = preference === "system" ? "desktop" : preference === "light" ? "sun" : "moon";
  return <Icon name={name} size={size} />;
}

/** Cycles system -> light -> dark, applying and persisting the choice. */
export function ThemeToggle({ variant = "rail" }: { readonly variant?: "rail" | "inline" }) {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system" || typeof window.matchMedia !== "function") {
      return;
    }
    // Follow the OS live while on "system" (e.g. macOS auto appearance at dusk).
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [preference]);

  const next = nextThemePreference(preference);
  const label = preference === "system" ? "System" : preference === "light" ? "Light" : "Dark";

  if (variant === "inline") {
    return (
      <fieldset
        aria-label="Appearance"
        className="inline-flex items-center gap-0.5 rounded-[7px] bg-surface-3 p-0.5"
      >
        {THEME_OPTIONS.map((option) => {
          const active = preference === option.value;
          return (
            <label
              key={option.value}
              aria-label={option.label}
              title={option.label}
              className={cn(
                "flex h-6 w-7 cursor-pointer items-center justify-center rounded-[5px] transition",
                active ? "bg-surface-2 text-text shadow-sm" : "text-text-muted hover:text-text",
              )}
            >
              <input
                type="radio"
                name="aulora-appearance"
                value={option.value}
                checked={active}
                onChange={() => {
                  writeThemePreference(option.value);
                  setPreference(option.value);
                }}
                className="sr-only"
              />
              <ThemeGlyph preference={option.value} size={15} />
            </label>
          );
        })}
      </fieldset>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Theme: ${preference}. Switch to ${next}.`}
      title={`Theme: ${label}`}
      className="flex h-9 w-9 items-center justify-center rounded-[8px] text-rail-text transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={() => {
        writeThemePreference(next);
        setPreference(next);
      }}
    >
      <ThemeGlyph preference={preference} />
    </button>
  );
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
