import { brandIcons, type ProviderBrand } from "@aulora/tokens";

export interface ProviderIconProps {
  readonly brand: ProviderBrand;
  /** Rendered size in pixels (square). */
  readonly size?: number;
}

/**
 * A provider's real brand mark. Decorative: the surrounding button carries the
 * accessible name. Monochrome marks follow the current text colour so they
 * read in both themes; the multi-colour marks keep their official colours.
 */
export function ProviderIcon({ brand, size = 18 }: ProviderIconProps) {
  const icon = brandIcons[brand];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <title>{icon.label}</title>
      {icon.paths.map((path) => (
        <path key={path.d} d={path.d} fill={path.fill} />
      ))}
    </svg>
  );
}
