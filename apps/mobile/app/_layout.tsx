import { ScreenContainer } from "../src/components/layout/ScreenContainer";
import "../src/lib/debug-log";
import { classifyError, debugLog } from "@aulora/core";
import { useFonts } from "expo-font";
import { type ErrorBoundaryProps, SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import { Button, Text, usePalette } from "@aulora/ui-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { FONT_ASSETS } from "../src/lib/fonts";
import { configureNotificationHandler } from "../src/lib/push";
import { useThemeVars } from "../src/lib/theme";
import { ProfileProvider } from "../src/providers/ProfileProvider";

// Dev-only, upstream race in expo-router@57: its forked NavigationContainer
// (build/react-navigation/native/NavigationContainer.js) passes its
// `setLastUnhandledLink` state setter as `onUnhandledLinking` into
// build/fork/useLinking.native.js, whose `getInitialState` invokes it from a
// promise `.then`. On Android `Linking.getInitialURL()` resolves asynchronously
// and can fire before NavigationContainer has mounted, so React warns:
//   "Can't perform a React state update on a component that hasn't mounted yet."
// The warning originates entirely inside the framework (no app frame) and never
// occurs in production. `LogBox.ignoreLogs` is not enough: React Native mirrors
// `console.error` to the Metro dev server before LogBox filters it
// (Libraries/Core/ExceptionsManager.js reactConsoleErrorHandler), so suppress
// this single upstream message at the console boundary instead.
if (__DEV__) {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith(
        "Can't perform a React state update on a component that hasn't mounted yet",
      )
    ) {
      return;
    }
    originalConsoleError(...args);
  };
  // react-native-keyboard-controller 1.22's KeyboardAvoidingView passes a
  // dependency list to `useAnimatedStyle`, which Reanimated 4 ignores on native
  // and warns about once per mount. The dev-only toast covered sheet footers
  // and the composer on device; nothing in the app's own code triggers it.
  LogBox.ignoreLogs(["[Reanimated] Dependencies should only be used on the web"]);
}

// Keep the splash up until Inter is registered, so the first frame already uses
// the shipped face and nothing reflows when it arrives.
void SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const theme = useThemeVars();
  const palette = usePalette();
  return (
    <View className="flex-1 bg-bg" style={theme}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}
      />
      <StatusBar style="auto" />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const fontsReady = fontsLoaded || fontError !== null;
  useEffect(() => {
    configureNotificationHandler();
  }, []);
  useEffect(() => {
    if (fontError !== null) debugLog.record("fonts.error", fontError);
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady, fontError]);
  // A failed load falls back to the system face rather than blocking launch.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ProfileProvider>
            <BottomSheetModalProvider>
              <ThemedStack />
            </BottomSheetModalProvider>
          </ProfileProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Recoverable fallback for an error that escapes the session's own boundary.
 * Expo Router shows this instead of the dev error overlay; `retry` re-mounts
 * the route, and a transient failure is framed as reconnecting.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    debugLog.record("route.error", error);
  }, [error]);
  const reconnecting = classifyError(error) === "reconnecting";
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ScreenContainer scrollable className="flex-1 items-center justify-center gap-3 bg-bg px-6">
          <Text size="md" className="text-center font-medium">
            {reconnecting ? "Reconnecting…" : "Something went wrong"}
          </Text>
          <Text size="sm" tone="muted" className="text-center">
            {reconnecting
              ? "Check your connection, then try again."
              : "This view could not load. Try again to reload it."}
          </Text>
          <Button onPress={() => void retry()}>Try again</Button>
        </ScreenContainer>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
