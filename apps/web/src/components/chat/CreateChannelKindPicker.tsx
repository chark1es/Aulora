/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { ChoiceList, type ChoiceOption, Icon } from "@aulora/ui-web";

export type ChannelKind = "text" | "announcement" | "voice";

const KINDS: readonly ChoiceOption<ChannelKind>[] = [
  {
    value: "text",
    title: "Text",
    description: "Messages, files and threads",
    leading: <Icon name="hash" size={16} />,
  },
  {
    value: "voice",
    title: "Voice",
    description: "Talk, share your screen and video",
    leading: <Icon name="volume" size={16} />,
  },
  {
    value: "announcement",
    title: "Announcement",
    description: "Only people with permission can post",
    leading: <Icon name="announce" size={16} />,
  },
];

/** The channel-type choice: the shared radio rows, one per kind. */
export function CreateChannelKindPicker(props: {
  readonly value: ChannelKind;
  readonly onChange: (kind: ChannelKind) => void;
}) {
  return (
    <ChoiceList
      label="Channel type"
      value={props.value}
      options={KINDS}
      onChange={props.onChange}
    />
  );
}
