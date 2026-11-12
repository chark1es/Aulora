import { debugLog, installDebugConsole } from "@aulora/core";

installDebugConsole();

// React Native forwards fatal JS exceptions through ErrorUtils. Preserve its
// handler so the native crash reporter and development overlay keep working.
const runtime = globalThis as typeof globalThis & {
  HermesInternal?: {
    enablePromiseRejectionTracker?: (options: {
      allRejections: boolean;
      onUnhandled: (id: number, error: unknown) => void;
      onHandled: (id: number) => void;
    }) => void;
  };
  ErrorUtils?: {
    getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
    setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
  };
};
if (runtime.ErrorUtils) {
  const previous = runtime.ErrorUtils.getGlobalHandler();
  runtime.ErrorUtils.setGlobalHandler((error, isFatal) => {
    debugLog.record(isFatal ? "native.fatal" : "native.error", error);
    previous(error, isFatal);
  });
}
// Also covers Expo web; native rejection warnings flow through console.warn.
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    debugLog.record("unhandledrejection", event.reason);
  });
}

// RN only enables Hermes rejection tracking in development by default. Enable
// it in release builds too. Leave the framework development tracker intact:
// it routes rejections through ExceptionsManager and the development overlay.
if (typeof __DEV__ === "undefined" || !__DEV__) {
  runtime.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id, error) => {
      console.warn(`Unhandled promise rejection ${id}`, error);
    },
    onHandled: (id) => {
      console.warn(`Promise rejection ${id} was handled asynchronously`);
    },
  });
}
