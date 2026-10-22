/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS, type BotLanguage } from "@aulora/core";
import {
  Button,
  ChoiceList,
  type ChoiceOption,
  Icon,
  Input,
  Modal,
  Text,
  Textarea,
} from "@aulora/ui-web";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../../packages/convex/convex/_generated/api";
import {
  BOT_TEMPLATE_LABELS,
  type BotTemplate,
  validateBotDescription,
  validateBotName,
} from "./bot-format";

/** A language's mark in its tile: the file extension people already know it by. */
function LanguageMark({ children }: { readonly children: string }) {
  return <span className="font-mono text-[11px] font-semibold">{children}</span>;
}

const LANGUAGE_OPTIONS: readonly ChoiceOption<BotLanguage>[] = [
  { value: "typescript", title: "TypeScript", leading: <LanguageMark>.ts</LanguageMark> },
  { value: "python", title: "Python", leading: <LanguageMark>.py</LanguageMark> },
];

const TEMPLATE_OPTIONS: readonly ChoiceOption<BotTemplate>[] = [
  {
    value: "hello",
    title: BOT_TEMPLATE_LABELS.hello,
    description: "A working bot that answers a message, to edit from",
    leading: <Icon name="message" size={16} />,
  },
  {
    value: "blank",
    title: BOT_TEMPLATE_LABELS.blank,
    description: "Just the connection, nothing else",
    leading: <Icon name="file" size={16} />,
  },
];

export interface BotCreateDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (botId: string) => void;
}

interface BotTemplateFieldProps {
  readonly template: BotTemplate;
  readonly onChange: (value: BotTemplate) => void;
}

function BotTemplateField(props: BotTemplateFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-text">Start from</span>
      <ChoiceList
        label="Template"
        value={props.template}
        options={TEMPLATE_OPTIONS}
        onChange={props.onChange}
      />
    </div>
  );
}

interface BotCreateFieldsProps {
  readonly name: string;
  readonly description: string;
  readonly language: BotLanguage;
  readonly template: BotTemplate;
  readonly error: string | null;
  readonly onNameChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onLanguageChange: (value: BotLanguage) => void;
  readonly onTemplateChange: (value: BotTemplate) => void;
}

function BotCreateFields(props: BotCreateFieldsProps) {
  const {
    name,
    description,
    language,
    template,
    error,
    onNameChange,
    onDescriptionChange,
    onLanguageChange,
    onTemplateChange,
  } = props;
  return (
    <div className="flex flex-col gap-5">
      <Input
        label="Name"
        value={name}
        maxLength={BOT_LIMITS.maxNameLength}
        autoComplete="off"
        hint={`1 to ${BOT_LIMITS.maxNameLength} characters.`}
        onChange={(event) => {
          onNameChange(event.currentTarget.value);
        }}
      />
      <Textarea
        label="Description (optional)"
        value={description}
        maxLength={BOT_LIMITS.maxDescriptionLength}
        rows={2}
        onChange={(event) => {
          onDescriptionChange(event.currentTarget.value);
        }}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-text">Language</span>
        <ChoiceList
          label="Language"
          layout="grid"
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={onLanguageChange}
        />
      </div>
      <BotTemplateField template={template} onChange={onTemplateChange} />
      {error !== null && (
        <Text role="alert" tone="danger" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}

interface BotCreateFooterProps {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}

function BotCreateFooter(props: BotCreateFooterProps) {
  const { busy, onClose, onSubmit } = props;
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button loading={busy} disabled={busy} onClick={onSubmit}>
        Create bot
      </Button>
    </>
  );
}

/**
 * Creates a disabled bot from a starter template. It opens with no permissions,
 * so the admin grants access on the Permissions tab once the code is ready.
 */
export function BotCreateDialog(props: BotCreateDialogProps) {
  const { open, onClose, onCreated } = props;
  const create = useMutation(api.bots.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState<BotLanguage>("typescript");
  const [template, setTemplate] = useState<BotTemplate>("hello");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    const invalid = validateBotName(name) ?? validateBotDescription(description);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    const trimmedDescription = description.trim();
    setBusy(true);
    setError(null);
    void create({
      name: name.trim(),
      language,
      template,
      ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
    })
      .then((result) => {
        onCreated(result.botId);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not create the bot.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      label="New bot"
      title="New bot"
      description="It starts switched off with no permissions. Add code and grant access once it exists."
      icon={<Icon name="code" size={18} />}
      footer={<BotCreateFooter busy={busy} onClose={onClose} onSubmit={submit} />}
    >
      <BotCreateFields
        name={name}
        description={description}
        language={language}
        template={template}
        error={error}
        onNameChange={setName}
        onDescriptionChange={setDescription}
        onLanguageChange={setLanguage}
        onTemplateChange={setTemplate}
      />
    </Modal>
  );
}
