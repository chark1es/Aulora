import { Text, View } from "react-native";

export default function IndexScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <Text className="text-lg font-semibold text-text">Aulora</Text>
      <Text className="text-sm text-text-muted">Secure team chat on your own server.</Text>
    </View>
  );
}
