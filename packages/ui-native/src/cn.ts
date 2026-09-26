/** Tiny class-name joiner, mirroring `@aulora/ui-web`'s `cn`. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}
