import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import { configureNotificationHandler } from "../src/lib/push";
import { useThemeVars } from "../src/lib/theme";
import { ProfileProvider } from "../src/providers/ProfileProvider";

function ThemedStack() {
  const theme = useThemeVars();
  return (
    <View className="flex-1 bg-bg" style={theme}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0A0A0C" } }} />
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
        <ProfileProvider>
          <ThemedStack />
        </ProfileProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
