import { DotGrid } from "@aulora/ui-web";
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { DesktopBridge } from "./components/DesktopBridge";
import { ServerRail } from "./components/ServerRail";
import { ProfileProvider } from "./providers/ProfileProvider";
import { ConnectRoute } from "./routes/ConnectRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { RedeemRoute } from "./routes/RedeemRoute";

function RootLayout() {
  return (
    <ProfileProvider>
      <DotGrid className="desktop-dot-grid" />
      <DesktopBridge />
      <div className="relative flex min-h-screen text-text">
        <ServerRail />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
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

const routeTree = rootRoute.addChildren([indexRoute, connectRoute, redeemRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
