import { IconButton } from "@aulora/ui-web";
import { useEffect, useState } from "react";
import {
  applyTheme,
  nextThemePreference,
  readThemePreference,
  type ThemePreference,
  writeThemePreference,
} from "../lib/theme";

function ThemeGlyph({ preference }: { readonly preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <path
          d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (preference === "dark") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Cycles system -> light -> dark, applying and persisting the choice. */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());

  useEffect(() => {
    applyTheme(preference);
  }, [preference]);

  const next = nextThemePreference(preference);
  return (
    <IconButton
      label={`Theme: ${preference}. Switch to ${next}.`}
      variant="ghost"
      onClick={() => {
        writeThemePreference(next);
        setPreference(next);
      }}
    >
      <ThemeGlyph preference={preference} />
    </IconButton>
  );
}
