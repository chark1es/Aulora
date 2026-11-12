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
    const result = await authActionsFromClient(authClient)
      .signOut()
      .catch(() => null);
    if (result === null || result.error) {
      Alert.alert(
        "Couldn’t sign out",
        result?.error?.message ?? "Check your connection and try again.",
      );
    }
  };
}

/** Deletes the account on the server, reporting a failure in place. */
export function deleteAccountAction(authClient: AuloraAuthClient) {
  return async () => {
    const result = await authActionsFromClient(authClient)
      .deleteAccount()
      .catch(() => null);
    if (result === null || result.error) {
      Alert.alert(
        "Couldn’t delete account",
        result?.error?.message ?? "Check your connection and try again.",
      );
    }
  };
}
