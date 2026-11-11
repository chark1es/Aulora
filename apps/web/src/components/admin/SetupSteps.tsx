export interface SetupStep {
  readonly label: string;
  /** One concrete sentence: what happens, in the product’s own words. */
  readonly body: string;
}

/**
 * The compact "how it works" hint used inside an empty state: a short ordered
 * list of steps with no icons or tiles. The sequence is information here, so
 * the numbers earn their place.
 */
export function SetupSteps({ steps }: { readonly steps: readonly SetupStep[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, index) => (
        <li key={step.label} className="flex gap-2.5 text-[13px] leading-snug">
          <span className="w-3.5 shrink-0 tabular-nums text-text-muted">{index + 1}</span>
          <span>
            <span className="font-medium text-text">{step.label}.</span>{" "}
            <span className="text-text-muted">{step.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
