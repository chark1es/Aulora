import { cn } from "@aulora/ui-web";

/**
 * The small Ember tick that anchors the active conversation. It sits inside
 * the row's own padding rather than on its edge, so selection reads as a
 * quiet marker instead of a second container.
 */
export function ActiveBar({ active }: { readonly active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-1 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
