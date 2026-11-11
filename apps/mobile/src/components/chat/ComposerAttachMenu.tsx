import type { Fn } from "../../lib/function-type";
import { BottomSheet } from "./BottomSheet";
import { ListGroup, ListRow } from "./List";
import { ATTACH_OPTIONS, type AttachOption } from "./use-composer-attachments";

export interface ComposerAttachMenuProps {
  readonly visible: boolean;
  readonly onClose: Fn<[], void>;
  readonly onPick: Fn<[option: AttachOption], void>;
}

/** The "Add to message" sheet listing where an attachment can come from. */
export function ComposerAttachMenu({ visible, onClose, onPick }: ComposerAttachMenuProps) {
  return (
    <BottomSheet
      visible={visible}
      title="Add to message"
      subtitle="Formatting: **bold**, *italic*, `code`"
      onClose={onClose}
    >
      <ListGroup>
        {ATTACH_OPTIONS.map((option) => (
          <ListRow
            key={option.key}
            icon={option.icon}
            title={option.label}
            onPress={() => {
              onPick(option);
            }}
          />
        ))}
      </ListGroup>
    </BottomSheet>
  );
}
