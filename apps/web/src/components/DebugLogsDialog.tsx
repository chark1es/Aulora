import { Modal } from "@aulora/ui-web";
import { DebugLogsSection } from "./chat/DebugLogsSection";

export default function DebugLogsDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <Modal open onClose={onClose} label="Debug logs" size="lg">
      <DebugLogsSection />
    </Modal>
  );
}
