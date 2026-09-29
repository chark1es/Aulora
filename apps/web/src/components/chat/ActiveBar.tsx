import { cn } from "@aulora/ui-web";

/** The Ember bar that marks the active conversation, identical in every row. */
export function ActiveBar({ active }: { readonly active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
