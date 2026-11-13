import { recordDebugFailure } from "@aulora/core";
import { useEffect, useRef, useState } from "react";
import { createAccountScope } from "./account-scope";

/** A render-bound scope: old callbacks retain a closed scope after teardown. */
export function useAccountScope(identity: unknown) {
  const [scope, setScope] = useState(() => createAccountScope(recordDebugFailure));
  const current = useRef(scope);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity defines which account owns the callbacks.
  useEffect(() => {
    current.current.close();
    const next = createAccountScope(recordDebugFailure);
    current.current = next;
    setScope(next);
    return () => next.close();
  }, [identity]);
  return scope;
}
