import { recordDebugFailure } from "@aulora/core";
import { Alert } from "react-native";
import { type AuloraAuthClient, authActionsFromClient } from "./auth-client";

/**
 * Ends the session, reporting a failure in place.
 *
 * Callers hand this to buttons and boundaries that do not await it (`void
 * signOut()`, `<Button onPress={onSignOut}>`), so a rejection would surface as
 * an unhandled rejection on the recovery and join screens. The person gets the
 * same message either way.
 */
export function signOutAction(authClient: AuloraAuthClient) {
  return async () => {
    try {
      const result = await authActionsFromClient(authClient).signOut();
      if (result.error) {
        // The action result is a handled failure, so it never reaches the
        // global handlers; record it explicitly for the report.
        recordDebugFailure("auth.signout", result.error.message ?? "Sign out failed");
        Alert.alert(
          "Couldn’t sign out",
          result.error.message ?? "Check your connection and try again.",
        );
      }
    } catch (error) {
      recordDebugFailure("auth.signout", error);
      Alert.alert("Couldn’t sign out", "Check your connection and try again.");
    }
  };
}

/** Deletes the account on the server, reporting a failure in place. */
export function deleteAccountAction(authClient: AuloraAuthClient) {
  return async () => {
    try {
      const result = await authActionsFromClient(authClient).deleteAccount();
      if (result.error) {
        recordDebugFailure("auth.deleteAccount", result.error.message ?? "Account deletion failed");
        Alert.alert(
          "Couldn’t delete account",
          result.error.message ?? "Check your connection and try again.",
        );
      }
    } catch (error) {
      recordDebugFailure("auth.deleteAccount", error);
      Alert.alert("Couldn’t delete account", "Check your connection and try again.");
    }
  };
}
