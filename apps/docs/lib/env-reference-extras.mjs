// Environment variables operators can set that live outside the server's
// catalog in `packages/convex/convex/lib`. They are hand-maintained because
// they are read by shell scripts, containers and the apps rather than by the
// catalog, so they cannot be generated. This module declares the display order
// and combines the server and client entries for the reference page.

import { CLIENT_ENV_VARS } from "./env-reference-client.mjs";
import { SERVER_ENV_VARS } from "./env-reference-server.mjs";

/** Display order and labels for the generated groups outside the catalog. */
export const EXTRA_GROUPS = [
  { id: "instance", label: "Instance and installer" },
  { id: "origins", label: "Origins and proxy" },
  { id: "database", label: "Database" },
  { id: "storage", label: "Object storage" },
  { id: "backups", label: "Backups" },
  { id: "email-bridge", label: "Email bridge" },
  { id: "push-providers", label: "Mobile push providers" },
  { id: "web-build", label: "Web client build" },
  { id: "mobile-build", label: "Mobile build" },
  { id: "desktop", label: "Desktop app" },
  { id: "internal", label: "Internal and diagnostics" },
];

/** Every operator-facing variable that is not part of the server catalog. */
export const EXTRA_ENV_VARS = [...SERVER_ENV_VARS, ...CLIENT_ENV_VARS];
