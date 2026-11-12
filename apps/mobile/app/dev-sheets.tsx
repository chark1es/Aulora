import { Redirect } from "expo-router";
import { type ComponentType, lazy, Suspense } from "react";
import { ScreenContainer } from "../src/components/layout/ScreenContainer";

/**
 * Development only: opens form sheets the offline review demo cannot reach
 * (its workspace has no Kanban addon), so they can be checked with the
 * keyboard up on a device. The fixture module is imported inside the
 * `if (__DEV__)` branch. Metro constant-folds `__DEV__` before it collects
 * dependencies, so release bundles drop the branch and never include the
 * fixtures; the route itself redirects home.
 */
let SheetFixtures: ComponentType | undefined;
if (__DEV__) {
  SheetFixtures = lazy(() =>
    import("../src/dev/SheetFixtures").then((module) => ({ default: module.SheetFixtures })),
  );
}

export default function DevSheetsRoute() {
  if (SheetFixtures === undefined) return <Redirect href="/" />;
  return (
    <ScreenContainer className="flex-1 bg-bg">
      <Suspense fallback={null}>
        <SheetFixtures />
      </Suspense>
    </ScreenContainer>
  );
}
