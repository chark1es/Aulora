import type { WellKnownAuth } from "./well-known";

/**
 * Which sign-in methods an instance offers, derived purely from its public
 * `auth` block. Shared by the web and mobile sign-in screens so the two stay in
 * step: when local email/password sign-in is off, only the configured
 * SSO/OIDC provider buttons are shown.
 */
export interface SignInMethods {
  /** At least one OAuth/OIDC provider is configured and enabled. */
  readonly hasProviders: boolean;
  /** The email/password form should be shown. */
  readonly showLocalForm: boolean;
  /** A divider should separate the provider buttons from the local form. */
  readonly showDivider: boolean;
  /** The sign-up toggle should be offered (local sign-up is open). */
  readonly showSignUp: boolean;
  /** The instance offers at least one way in. */
  readonly hasAnyMethod: boolean;
}

/** Resolves the sign-in methods from an instance's public auth block. */
export function resolveSignInMethods(auth: WellKnownAuth): SignInMethods {
  const hasProviders = auth.providers.length > 0;
  const showLocalForm = auth.local.enabled;
  return {
    hasProviders,
    showLocalForm,
    showDivider: hasProviders && showLocalForm,
    showSignUp: showLocalForm && auth.local.signup,
    hasAnyMethod: hasProviders || showLocalForm,
  };
}
