'use client';

import { detectKeyProvider } from '@/lib/ai/providers/detect';
import type { AliasMap } from '@/lib/digest';
import type { InsightsState } from '@/lib/ai/use-insights';
import { Button, Card, Notice } from './ui';

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'var(--good)',
  medium: 'var(--warning)',
  low: 'var(--text-muted)',
};

/**
 * Map a model-produced alias back to the real display name.
 *
 * The model only ever sees `P1`, `P2`, ... so every alias in its output has to
 * be resolved here, at render time, against a map that never left the browser.
 */
const resolve = (alias: string, aliases: AliasMap | null) => aliases?.toName[alias] ?? alias;

/**
 * What the run cost and how it got there.
 *
 * Rows are provider-specific. The Groq path has no effort setting, no tools and
 * no prompt cache, so listing them as "n/a" and "0" reads like three things
 * went wrong rather than three things that do not apply.
 */
function TraceReceipt({ trace }: { trace: NonNullable<InsightsState['trace']> }) {
  const cost = trace.shared
    ? 'free tier'
    : `$${trace.estimatedCostUsd.toFixed(trace.estimatedCostUsd < 0.01 ? 4 : 3)}`;

  const rows: Array<[string, string]> = [
    ['Provider', trace.shared ? `${trace.provider} (shared)` : trace.provider],
    ['Model', trace.model],
    ['Prompt', trace.promptId],
    ['Input tokens', trace.usage.input.toLocaleString()],
    ['Output tokens', trace.usage.output.toLocaleString()],
    ['Duration', `${(trace.durationMs / 1000).toFixed(1)}s`],
    ['Est. cost', cost],
  ];

  // Only meaningful on the Anthropic path, which is the only one that has them.
  if (trace.provider === 'anthropic') {
    rows.splice(3, 0, ['Effort', trace.effort], ['Turns', String(trace.turns)]);
    rows.splice(7, 0, ['Tool calls', String(trace.toolCalls.length)]);
    if (trace.usage.cacheRead > 0) {
      rows.push(['Cache reads', trace.usage.cacheRead.toLocaleString()]);
    }
  }

  return (
    <details className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5">
      <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
        Run receipt &middot; {trace.usage.input.toLocaleString()} in /{' '}
        {trace.usage.output.toLocaleString()} out &middot; {cost}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-[var(--text-muted)]">{label}</dt>
            <dd className="tabular text-[var(--text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--text-muted)]">
        {trace.shared
          ? 'Served by the shared free tier, so this run was billed to nobody.'
          : trace.provider === 'groq'
            ? 'Groq list price. Free on Groq\u2019s free tier, which is what a new key gets.'
            : 'Billed to your Anthropic key at Claude Opus 5 rates.'}
      </p>
    </details>
  );
}

export function InsightsPanel({
  state,
  aliases,
  onRun,
  onReset,
  apiKey,
}: {
  state: InsightsState;
  aliases: AliasMap | null;
  onRun: () => void;
  onReset: () => void;
  /** Raw key from the field; the provider is derived from its prefix. */
  apiKey: string;
}) {
  const data = state.insights ?? state.partial;
  const running = state.phase === 'running';
  const provider = detectKeyProvider(apiKey);

  const subtitle = {
    anthropic: 'Claude Opus 5 on your key: streaming, and it queries the data through tools.',
    groq: 'Groq on your key, so you are not sharing the free tier limits.',
    none: 'Runs on the shared free tier. Paste a key above to get your own quota.',
    unknown: 'That key is not recognised. Fix it above, or clear the field to use the free tier.',
  }[provider];

  const buttonLabel = provider === 'none' ? 'Generate free' : 'Generate';

  return (
    <Card
      title="AI reading"
      subtitle={subtitle}
      action={
        state.phase === 'done' || state.phase === 'error' ? (
          <Button variant="ghost" onClick={onReset}>
            Clear
          </Button>
        ) : (
          <Button onClick={onRun} disabled={running || provider === 'unknown'}>
            {running ? 'Reading...' : buttonLabel}
          </Button>
        )
      }
    >
      {state.phase === 'idle' && !data && (
        <div className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
          <p>
            Nothing has been sent anywhere yet. Generating sends the aggregate digest only
            &mdash; counts, distributions and medians, with participants replaced by P1, P2, and
            so on.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {provider === 'anthropic'
              ? 'It will go to Anthropic, on the key above.'
              : 'It will go to Groq. Groq states it does not train on API data and does not retain it by default, but it is a third party receiving your digest either way.'}
          </p>
        </div>
      )}

      {state.error && <Notice tone="warning">{state.error}</Notice>}

      {(running || state.tools.length > 0) && (
        <div className="mb-4 flex flex-col gap-1.5">
          {running && state.status && (
            <p className="text-xs text-[var(--text-secondary)]">{state.status}</p>
          )}
          {state.tools.map((tool, i) => (
            <p
              key={`${tool.name}-${i}`}
              className="font-mono text-[11px] text-[var(--text-muted)]"
            >
              {tool.isError ? 'x' : '>'} {tool.name}(
              {Object.entries(tool.input)
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(', ')}
              )
            </p>
          ))}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-5">
          {data.headline && (
            <p className="text-lg leading-snug font-semibold text-[var(--text-primary)]">
              {data.headline}
            </p>
          )}
          {data.summary && (
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{data.summary}</p>
          )}

          {data.findings && data.findings.length > 0 && (
            <ul className="flex flex-col gap-3.5">
              {data.findings.map((f, i) => (
                <li
                  key={f?.title ?? i}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{f?.title}</h3>
                    {f?.confidence && (
                      <span className="flex shrink-0 items-center gap-1.5 text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: CONFIDENCE_TONE[f.confidence] }}
                        />
                        {f.confidence}
                      </span>
                    )}
                  </div>
                  {f?.detail && (
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                      {f.detail}
                    </p>
                  )}
                  {f?.evidence && f.evidence.length > 0 && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {f.evidence.map((e, j) => (
                        <li
                          key={`${e}-${j}`}
                          className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                        >
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data.participants && data.participants.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                Participants
              </h3>
              <ul className="flex flex-col gap-2">
                {data.participants.map((p, i) => (
                  <li key={p?.alias ?? i} className="text-sm">
                    <span className="font-medium text-[var(--text-primary)]">
                      {resolve(p?.alias ?? '', aliases)}
                    </span>
                    {p?.role && (
                      <span className="text-[var(--text-muted)]"> &mdash; {p.role}</span>
                    )}
                    {p?.note && (
                      <span className="block text-[var(--text-secondary)]">{p.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.caveats && data.caveats.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                What this cannot tell you
              </h3>
              <ul className="list-inside list-disc text-sm text-[var(--text-secondary)]">
                {data.caveats.map((c, i) => (
                  <li key={`${c}-${i}`}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.trace && <TraceReceipt trace={state.trace} />}
    </Card>
  );
}
