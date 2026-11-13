import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { BackHandler } from "react-native";
import { type BackPressRouter, createBackPressRouter } from "../../lib/back-navigation";

const BackPressContext = createContext<BackPressRouter | null>(null);

/**
 * Owns the chat surface's one Android back listener.
 *
 * Nested views register through {@link useBackPress} while they are the
 * visible surface; when none consumes the press, `onBack` retraces the chat's
 * own history and returns `false` at the root so Android leaves the app.
 */
export function BackPressProvider({
  onBack,
  children,
}: {
  readonly onBack: () => boolean;
  readonly children: ReactNode;
}) {
  const fallback = useRef(onBack);
  fallback.current = onBack;
  const router = useRef<BackPressRouter | null>(null);
  if (router.current === null) {
    router.current = createBackPressRouter(() => fallback.current());
  }

  useEffect(() => {
    const active = router.current;
    if (active === null) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => active.handle());
    return () => {
      subscription.remove();
    };
  }, []);

  return <BackPressContext.Provider value={router.current}>{children}</BackPressContext.Provider>;
}

/**
 * Makes a nested view the back-button owner while `active` is true.
 *
 * The handler is read through a ref so typing or other re-renders do not
 * re-register the listener; only becoming visible (or hidden) changes
 * ownership.
 */
export function useBackPress(active: boolean, handler: () => boolean): void {
  const router = useContext(BackPressContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active || router === null) {
      return;
    }
    return router.register(() => latest.current());
  }, [active, router]);
}
