import { Heading } from "@aulora/ui-native";
import { Modal, Pressable, View } from "react-native";
import { DeviceSettingsSection } from "./DeviceSettingsSection";

export interface VoiceSettingsSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

/** Bottom sheet hosting {@link DeviceSettingsSection}. */
export function VoiceSettingsSheet({ visible, onClose }: VoiceSettingsSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable onPress={() => {}} className="max-h-[85%] rounded-t-card bg-surface-1 p-4">
          <Heading level={3}>Voice &amp; video</Heading>
          <View className="mt-2 flex-1">
            <DeviceSettingsSection />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
