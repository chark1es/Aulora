import { useCallback } from "react";
import { Alert } from "react-native";
import { errorMessage } from "../components/chat/chat-screen-types";
import { useAccountScope } from "./use-account-scope";

export function useActionError(identity: unknown) {
  const scope = useAccountScope(identity);
  const format = useCallback(
    (error: unknown) => {
      scope.record("ui.action", error);
      return errorMessage(error);
    },
    [scope],
  );
  const show = useCallback(
    (title: string, error: unknown) => {
      if (scope.active) Alert.alert(title, format(error));
    },
    [scope, format],
  );
  return { format, show, scope };
}
