import { useCallback, useState } from "react";

/** Hold a navigation action until profile edits have been explicitly discarded. */
export function useSettingsNavigation(open: boolean, dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const navigate = useCallback(
    (action: () => void) => {
      if (open && dirty) setPending(() => action);
      else action();
    },
    [open, dirty],
  );
  return {
    navigate,
    pending,
    cancel: () => setPending(null),
    discard: () => {
      setPending(null);
      pending?.();
    },
  };
}
