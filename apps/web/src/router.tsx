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
import { ServerRail } from "./components/ServerRail";
import { ProfileProvider } from "./providers/ProfileProvider";
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
  const [previewStore, setPreviewStore] = useState<ProfileStore | undefined>(undefined);
  useEffect(() => {
    if (previewing) {
      void import("./preview/demo").then((module) => setPreviewStore(module.demoProfileStore()));
    }
  }, [previewing]);
  if (previewing && previewStore === undefined) {
    return null;
  }
  return (
    <ProfileProvider {...(previewing && previewStore !== undefined ? { store: previewStore } : {})}>
      <ContextMenuProvider>
        <DesktopBridge />
        <div className="desktop-canvas flex h-full bg-bg text-text">
          <ServerRail />
          <main className="flex min-h-0 min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </ContextMenuProvider>
    </ProfileProvider>
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
