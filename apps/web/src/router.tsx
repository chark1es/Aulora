import { DotGrid } from "@aulora/ui-web";
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { ServerRail } from "./components/ServerRail";
import { ProfileProvider } from "./providers/ProfileProvider";
import { ConnectRoute } from "./routes/ConnectRoute";
import { HomeRoute } from "./routes/HomeRoute";

function RootLayout() {
  return (
    <ProfileProvider>
      <DotGrid />
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
  component: ConnectRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, connectRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
