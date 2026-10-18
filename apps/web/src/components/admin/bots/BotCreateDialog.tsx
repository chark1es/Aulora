/* eslint-disable no-unused-vars -- the base rule reports parameter names in type signatures; Biome checks real unused code */
import { BOT_LIMITS, type BotLanguage } from "@aulora/core";
import {
  Button,
  Input,
  Modal,
  SegmentedControl,
  Select,
  type SelectOption,
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

const LANGUAGE_OPTIONS: readonly SelectOption<BotLanguage>[] = [
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
];

const TEMPLATE_OPTIONS: readonly { value: BotTemplate; label: string }[] = [
  { value: "hello", label: BOT_TEMPLATE_LABELS.hello },
  { value: "blank", label: BOT_TEMPLATE_LABELS.blank },
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
  const { template, onChange } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text-muted">Template</span>
      <SegmentedControl
        label="Template"
        value={template}
        options={TEMPLATE_OPTIONS}
        onChange={(next) => {
          onChange(next);
        }}
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
    <div className="flex flex-col gap-4">
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
      <Select
        label="Language"
        value={language}
        options={LANGUAGE_OPTIONS}
        onChange={(next) => {
          onLanguageChange(next);
        }}
      />
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
      description="Bots start disabled with no permissions. Add code and grants once it exists."
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
