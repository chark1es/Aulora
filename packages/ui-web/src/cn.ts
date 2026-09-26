/**
 * Joins truthy class-name fragments. Kept tiny on purpose: ui-web has no
 * runtime dependencies beyond React.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}
