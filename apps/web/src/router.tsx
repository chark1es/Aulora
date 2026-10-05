import type { ProfileStore } from "@aulora/core";
import { ContextMenuProvider } from "@aulora/ui-web";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { DesktopBridge } from "./components/DesktopBridge";
import { DesktopUpdateNotice } from "./components/DesktopUpdateNotice";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import { DesktopUpdateProvider } from "./providers/DesktopUpdateProvider";
import { ProfileProvider, useProfiles } from "./providers/ProfileProvider";
import { ConnectRoute } from "./routes/ConnectRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { RedeemRoute } from "./routes/RedeemRoute";

// Dev-only UI preview over the in-memory chat port; compiled out of production.
const PreviewRoute = import.meta.env.DEV
  ? lazy(() =>
      import("./preview/PreviewRoute").then((module) => ({ default: module.PreviewRoute })),
    )
  : null;

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previewing = import.meta.env.DEV && pathname.startsWith("/__preview");
  const [previewStore, setPreviewStore] = useState<ProfileStore>();
  useEffect(() => {
    if (previewing) {
      void import("./preview/demo").then((module) => {
        setPreviewStore(module.demoProfileStore());
      });
    }
  }, [previewing]);
  if (previewing && previewStore === undefined) {
    return null;
  }
  return (
    <ProfileProvider {...(previewing && previewStore !== undefined ? { store: previewStore } : {})}>
      <DesktopUpdateProvider>
        <ContextMenuProvider>
          <DesktopBridge />
          <DesktopUpdateNotice />
          <AppShell />
        </ContextMenuProvider>
      </DesktopUpdateProvider>
    </ProfileProvider>
  );
}

function AppShell() {
  const { profiles, activeProfile } = useProfiles();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Pre-session screens have no sidebar, so surface the switcher here instead of
  // the removed rail: on the connect route, or on home before a workspace is
  // chosen — but only once at least one workspace has been joined.
  const showSwitcher =
    profiles.length >= 1 &&
    (pathname === "/connect" || (pathname === "/" && activeProfile === undefined));
  return (
    <div className="desktop-canvas relative flex h-full bg-bg text-text">
      <main className="flex min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
      {showSwitcher && (
        <div className="absolute right-3 top-3 z-40">
          <WorkspaceMenu variant="compact" align="right" />
        </div>
      )}
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect",
  validateSearch: (search: Record<string, unknown>): { server?: string } => {
    const server = search.server;
    return typeof server === "string" ? { server } : {};
  },
  component: ConnectRoute,
});

const redeemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$code",
  component: RedeemRoute,
});

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/__preview",
  component: () =>
    PreviewRoute === null ? null : (
      <Suspense fallback={null}>
        <PreviewRoute />
      </Suspense>
    ),
});

const routeTree = rootRoute.addChildren(
  import.meta.env.DEV
    ? [indexRoute, connectRoute, redeemRoute, previewRoute]
    : [indexRoute, connectRoute, redeemRoute],
);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
