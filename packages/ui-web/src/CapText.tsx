import { Children, type ReactNode } from "react";

/**
 * Trims a label's box to Inter's cap band (cap height to alphabetic baseline),
 * so a flex parent's `items-center` centres the letters themselves rather than
 * the line box. Pure CSS, no measuring: use it inside controls with a fixed
 * height. Engines without `text-box` keep the normal line box, which Inter's
 * symmetric metrics already centre to within half a pixel.
 */
export const CAP_TEXT_CLASS = "[text-box:trim-both_cap_alphabetic]";

/** Wraps plain-text children in one cap-trimmed span; elements pass through. */
export function CapText({ children }: { readonly children: ReactNode }) {
  const parts = Children.toArray(children);
  if (
    parts.length > 0 &&
    parts.every((part) => typeof part === "string" || typeof part === "number")
  ) {
    return <span className={CAP_TEXT_CLASS}>{parts.join("")}</span>;
  }
  return Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <span className={CAP_TEXT_CLASS}>{child}</span>
    ) : (
      child
    ),
  );
}
