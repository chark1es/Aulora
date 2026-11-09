import type { TranscriptSummary } from "@aulora/core";

/**
 * Pairs each entry with a key built from its text and how often that text has
 * appeared so far, so keys are stable without using the array index.
 */
function withKeys<T>(
  items: readonly T[],
  textOf: (item: T) => string,
): { readonly key: string; readonly item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { key: `${count}:${text}`, item };
  });
}

/**
 * A rendered summary. Every value is a text node: the summary is model output
 * derived from untrusted speech, so nothing here is ever interpreted as HTML or
 * markdown. `parseTranscriptSummary` has already bounded and cleaned the text.
 */
export function SummaryView({ summary }: { readonly summary: TranscriptSummary }) {
  return (
    <div className="flex flex-col gap-5" data-testid="transcript-summary">
      {summary.overview.length > 0 && (
        <section aria-labelledby="summary-overview" className="flex flex-col gap-1.5">
          <h3 id="summary-overview" className="text-[13px] font-semibold text-text">
            Overview
          </h3>
          <p className="max-w-[68ch] whitespace-pre-line text-[13.5px] leading-relaxed text-text">
            {summary.overview}
          </p>
        </section>
      )}
      <ListSection id="summary-points" title="Key points" items={summary.keyPoints} />
      <ListSection id="summary-decisions" title="Decisions" items={summary.decisions} />
      {summary.actionItems.length > 0 && (
        <section aria-labelledby="summary-actions" className="flex flex-col gap-1.5">
          <h3 id="summary-actions" className="text-[13px] font-semibold text-text">
            Action items
          </h3>
          <ul className="flex max-w-[68ch] flex-col gap-1.5">
            {withKeys(summary.actionItems, (entry) => entry.text).map(({ key, item }) => (
              <li
                key={key}
                className="flex items-baseline gap-2 text-[13.5px] leading-relaxed text-text"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
                <span className="min-w-0 flex-1">{item.text}</span>
                {item.owner !== null && (
                  <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                    {item.owner}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.speakerHighlights.length > 0 && (
        <section aria-labelledby="summary-speakers" className="flex flex-col gap-1.5">
          <h3 id="summary-speakers" className="text-[13px] font-semibold text-text">
            Speaker highlights
          </h3>
          <dl className="flex max-w-[68ch] flex-col gap-2">
            {withKeys(summary.speakerHighlights, (entry) => `${entry.speaker}:${entry.text}`).map(
              ({ key, item }) => (
                <div key={key}>
                  <dt className="text-[12.5px] font-medium text-text">{item.speaker}</dt>
                  <dd className="text-[13px] leading-relaxed text-text-muted">{item.text}</dd>
                </div>
              ),
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

function ListSection({
  id,
  title,
  items,
}: {
  readonly id: string;
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-[13px] font-semibold text-text">
        {title}
      </h3>
      <ul className="flex max-w-[68ch] flex-col gap-1.5">
        {withKeys(items, (entry) => entry).map(({ key, item }) => (
          <li
            key={key}
            className="flex items-baseline gap-2 text-[13.5px] leading-relaxed text-text"
          >
            <span
              aria-hidden="true"
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted"
            />
            <span className="min-w-0 flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
