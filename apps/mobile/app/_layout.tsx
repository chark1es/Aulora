import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import { usePalette } from "@aulora/ui-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
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
}

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
  useEffect(() => {
    configureNotificationHandler();
  }, []);

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
