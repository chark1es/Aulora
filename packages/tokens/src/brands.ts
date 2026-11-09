/**
 * Brand marks for the sign-in providers the server ships with.
 *
 * The sign-in screen shows a provider's real mark, never a generated initial
 * or a generic glyph. A provider with no mark here is drawn as text only, which
 * is why {@link providerBrand} returns `null` rather than a fallback.
 *
 * Paths are the providers' official marks in a 0 0 24 24 view box. A fill of
 * `"currentColor"` lets the client tint the monochrome marks to match the
 * surrounding button in both themes; the multi-colour marks keep their
 * official brand colours. Each mark is a trademark of its owner and is used
 * only to identify the provider the workspace has configured.
 */

export type ProviderBrand = "apple" | "github" | "google" | "microsoft";

export interface BrandIconPath {
  readonly d: string;
  /** A CSS colour, or `"currentColor"` to follow the surrounding text. */
  readonly fill: string;
}

export interface BrandIcon {
  /** The provider's own short name, used for the compact button label. */
  readonly label: string;
  readonly paths: readonly BrandIconPath[];
}

const MONO = "currentColor";
const GOOGLE_BLUE = "#4285F4";
const GOOGLE_GREEN = "#34A853";
const GOOGLE_YELLOW = "#FBBC05";
const GOOGLE_RED = "#EA4335";
const MICROSOFT_RED = "#F25022";
const MICROSOFT_GREEN = "#7FBA00";
const MICROSOFT_BLUE = "#00A4EF";
const MICROSOFT_YELLOW = "#FFB900";

export const brandIcons: Readonly<Record<ProviderBrand, BrandIcon>> = {
  google: {
    label: "Google",
    paths: [
      {
        d: "M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.46c-.28 1.5-1.13 2.77-2.4 3.63v3.02h3.88c2.27-2.09 3.58-5.17 3.58-8.76z",
        fill: GOOGLE_BLUE,
      },
      {
        d: "M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.44 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11C3.23 21.31 7.31 24 12 24z",
        fill: GOOGLE_GREEN,
      },
      {
        d: "M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.26a12 12 0 0 0 0 10.78z",
        fill: GOOGLE_YELLOW,
      },
      {
        d: "M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0 7.31 0 3.23 2.69 1.26 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z",
        fill: GOOGLE_RED,
      },
    ],
  },
  github: {
    label: "GitHub",
    paths: [
      {
        d: "M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z",
        fill: MONO,
      },
    ],
  },
  apple: {
    label: "Apple",
    paths: [
      {
        d: "M16.37 12.72c.02 2.6 2.28 3.46 2.31 3.47-.02.06-.36 1.23-1.19 2.43-.72 1.04-1.47 2.08-2.64 2.1-1.15.02-1.53-.68-2.85-.68-1.32 0-1.73.66-2.82.7-1.14.04-2-1.12-2.72-2.16-1.49-2.15-2.63-6.08-1.1-8.73.76-1.32 2.12-2.16 3.6-2.18 1.11-.02 2.16.75 2.84.75.68 0 1.97-.93 3.32-.79.57.02 2.16.23 3.18 1.73-.08.05-1.9 1.11-1.88 3.31M14.4 4.9c.6-.73 1.01-1.75.9-2.76-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.58-1.23",
        fill: MONO,
      },
    ],
  },
  microsoft: {
    label: "Microsoft",
    paths: [
      { d: "M1 1h10v10H1z", fill: MICROSOFT_RED },
      { d: "M13 1h10v10H13z", fill: MICROSOFT_GREEN },
      { d: "M1 13h10v10H1z", fill: MICROSOFT_BLUE },
      { d: "M13 13h10v10H13z", fill: MICROSOFT_YELLOW },
    ],
  },
};

/** Provider ids that use a shipped brand mark, including common aliases. */
const BRAND_ALIASES: Readonly<Record<string, ProviderBrand>> = {
  apple: "apple",
  icloud: "apple",
  github: "github",
  gh: "github",
  google: "google",
  "google-workspace": "google",
  googleworkspace: "google",
  gmail: "google",
  microsoft: "microsoft",
  "microsoft-entra": "microsoft",
  microsoftentra: "microsoft",
  "microsoft-entra-id": "microsoft",
  entra: "microsoft",
  "entra-id": "microsoft",
  azure: "microsoft",
  "azure-ad": "microsoft",
  azuread: "microsoft",
  office365: "microsoft",
  outlook: "microsoft",
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * The brand mark for a provider id or display name, or `null` when it has no
 * shipped mark. The id wins, so an operator's custom display name for a
 * built-in provider still gets the right mark.
 */
export function providerBrand(id: string, displayName = ""): ProviderBrand | null {
  const fromId = BRAND_ALIASES[normalize(id)];
  if (fromId !== undefined) {
    return fromId;
  }
  const fromName = BRAND_ALIASES[normalize(displayName)];
  if (fromName !== undefined) {
    return fromName;
  }
  const name = normalize(displayName);
  if (name.includes("google")) {
    return "google";
  }
  if (name.includes("github")) {
    return "github";
  }
  if (name.includes("apple") || name.includes("icloud")) {
    return "apple";
  }
  if (
    name.includes("microsoft") ||
    name.includes("entra") ||
    name.includes("azure") ||
    name.includes("office-365")
  ) {
    return "microsoft";
  }
  return null;
}

/**
 * The short label for a compact provider button: the brand's own name when it
 * has a mark, otherwise the operator's display name unchanged.
 */
export function providerButtonLabel(id: string, displayName: string): string {
  const brand = providerBrand(id, displayName);
  return brand === null ? displayName : brandIcons[brand].label;
}
