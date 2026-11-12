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
import { DebugLogsAccess } from "./components/DebugLogsAccess";
import { DesktopBridge } from "./components/DesktopBridge";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { DesktopUpdateNotice } from "./components/DesktopUpdateNotice";
import { RouteError } from "./components/RouteError";
import { DisplaySourcePickerGate } from "./components/voice/DisplaySourcePickerGate";
import { WorkspaceMenu } from "./components/WorkspaceMenu";
import { isGuestCallPath } from "./lib/guest/fragment";
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

// Dev-only visual harness for the pre-session screens (connect, sign in).
const AuthPreviewRoute = import.meta.env.DEV
  ? lazy(() =>
      import("./preview/AuthPreviewRoute").then((module) => ({ default: module.AuthPreviewRoute })),
    )
  : null;

// Dev-only harness for the Kanban board settings, for layout and theme checks.
const KanbanPreviewRoute = import.meta.env.DEV
  ? lazy(() =>
      import("./preview/KanbanPreviewRoute").then((module) => ({
        default: module.KanbanPreviewRoute,
      })),
    )
  : null;

// The guest page is an unauthenticated visit outside the signed-in shell, so
// it loads on demand and nothing of the app chrome wraps it.
const GuestCallRoute = lazy(() =>
  import("./routes/GuestCallRoute").then((module) => ({ default: module.GuestCallRoute })),
);

// Dev-only harness for the call addons (scheduled calls, transcripts, guest
// lobby), over fixtures and a fake Convex client.
const CallAddonsPreviewRoute = import.meta.env.DEV
  ? lazy(() =>
      import("./preview/CallAddonsPreviewRoute").then((module) => ({
        default: module.CallAddonsPreviewRoute,
      })),
    )
  : null;

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (isGuestCallPath(pathname)) {
    return (
      <div className="relative flex h-full flex-col bg-bg text-text">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </div>
    );
  }
  return <AppRootLayout pathname={pathname} />;
}

function AppRootLayout({ pathname }: { readonly pathname: string }) {
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
          <DebugLogsAccess />
          <DesktopBridge />
          <DesktopUpdateNotice />
          <DisplaySourcePickerGate />
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
    <div className="desktop-canvas relative flex h-full flex-col bg-bg text-text">
      <DesktopTitleBar />
      <main className="flex min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
      {showSwitcher && (
        <div className="desktop-titlebar-offset absolute right-3 z-40">
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

const guestCallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/call/guest",
  component: () => (
    <Suspense fallback={null}>
      <GuestCallRoute />
    </Suspense>
  ),
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

const authPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/__preview/auth",
  component: () =>
    AuthPreviewRoute === null ? null : (
      <Suspense fallback={null}>
        <AuthPreviewRoute />
      </Suspense>
    ),
});

const kanbanPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/__preview/kanban",
  component: () =>
    KanbanPreviewRoute === null ? null : (
      <Suspense fallback={null}>
        <KanbanPreviewRoute />
      </Suspense>
    ),
});

const callAddonsPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/__preview/calls",
  component: () =>
    CallAddonsPreviewRoute === null ? null : (
      <Suspense fallback={null}>
        <CallAddonsPreviewRoute />
      </Suspense>
    ),
});

const routeTree = rootRoute.addChildren(
  import.meta.env.DEV
    ? [
        indexRoute,
        connectRoute,
        redeemRoute,
        guestCallRoute,
        previewRoute,
        authPreviewRoute,
        kanbanPreviewRoute,
        callAddonsPreviewRoute,
      ]
    : [indexRoute, connectRoute, redeemRoute, guestCallRoute],
);

export const router = createRouter({ routeTree, defaultErrorComponent: RouteError });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
