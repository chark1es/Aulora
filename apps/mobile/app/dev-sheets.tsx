import { Redirect } from "expo-router";
import type { ComponentType } from "react";
import { ScreenContainer } from "../src/components/layout/ScreenContainer";

/**
 * Development only: opens form sheets the offline review demo cannot reach
 * (its workspace has no Kanban addon), so they can be checked with the
 * keyboard up on a device. The fixture module is required inside the
 * `if (__DEV__)` branch. Metro constant-folds `__DEV__` before it collects
 * dependencies, so release bundles drop the branch and never include the
 * fixtures; the route itself redirects home.
 */
export default function DevSheetsRoute() {
  if (__DEV__) {
    const { SheetFixtures } = require("../src/dev/SheetFixtures") as {
      readonly SheetFixtures: ComponentType;
    };
    return (
      <ScreenContainer className="flex-1 bg-bg">
        <SheetFixtures />
      </ScreenContainer>
    );
  }
  return <Redirect href="/" />;
}
