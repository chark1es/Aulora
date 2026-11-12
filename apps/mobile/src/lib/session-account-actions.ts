import { recordDebugFailure } from "@aulora/core";
import { Alert } from "react-native";
import { type AccountScope, createAccountScope } from "./account-scope";
import { type AuloraAuthClient, authActionsFromClient } from "./auth-client";

/**
 * Ends the session, reporting a failure in place.
 *
 * Callers hand this to buttons and boundaries that do not await it (`void
 * signOut()`, `<Button onPress={onSignOut}>`), so a rejection would surface as
 * an unhandled rejection on the recovery and join screens. The person gets the
 * same message either way.
 */
export function signOutAction(
  authClient: AuloraAuthClient,
  scope: AccountScope = createAccountScope(recordDebugFailure),
) {
  return async () => {
    if (!scope.active) return;
    try {
      const result = await authActionsFromClient(authClient, scope).signOut();
      if (!scope.active) return;
      if (result.error) {
        // The action result is a handled failure, so it never reaches the
        // global handlers; record it explicitly for the report.
        scope.record("auth.signout", result.error.message ?? "Sign out failed");
        Alert.alert(
          "Couldn’t sign out",
          result.error.message ?? "Check your connection and try again.",
        );
      }
    } catch (error) {
      if (!scope.active) return;
      scope.record("auth.signout", error);
      Alert.alert("Couldn’t sign out", "Check your connection and try again.");
    }
  };
}

/** Deletes the account on the server, reporting a failure in place. */
export function deleteAccountAction(
  authClient: AuloraAuthClient,
  scope: AccountScope = createAccountScope(recordDebugFailure),
) {
  return async () => {
    if (!scope.active) return;
    try {
      const result = await authActionsFromClient(authClient, scope).deleteAccount();
      if (!scope.active) return;
      if (result.error) {
        scope.record("auth.deleteAccount", result.error.message ?? "Account deletion failed");
        Alert.alert(
          "Couldn’t delete account",
          result.error.message ?? "Check your connection and try again.",
        );
      }
    } catch (error) {
      if (!scope.active) return;
      scope.record("auth.deleteAccount", error);
      Alert.alert("Couldn’t delete account", "Check your connection and try again.");
    }
  };
}
