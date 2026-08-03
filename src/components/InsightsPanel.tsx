'use client';

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

function TraceReceipt({ trace }: { trace: NonNullable<InsightsState['trace']> }) {
  const rows: Array<[string, string]> = [
    ['Provider', trace.shared ? `${trace.provider} (shared free tier)` : trace.provider],
    ['Model', trace.model],
    ['Effort', trace.effort],
    ['Prompt', trace.promptId],
    ['Turns', String(trace.turns)],
    ['Tool calls', String(trace.toolCalls.length)],
    ['Input tokens', trace.usage.input.toLocaleString()],
    ['Output tokens', trace.usage.output.toLocaleString()],
    ['Cache reads', trace.usage.cacheRead.toLocaleString()],
    ['Duration', `${(trace.durationMs / 1000).toFixed(1)}s`],
    ['Est. cost', trace.shared ? 'free' : `$${trace.estimatedCostUsd.toFixed(4)}`],
  ];

  return (
    <details className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5">
      <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
        Run receipt &middot; {trace.usage.input.toLocaleString()} in /{' '}
        {trace.usage.output.toLocaleString()} out &middot;{' '}
        {trace.shared ? 'free tier' : `$${trace.estimatedCostUsd.toFixed(4)}`}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-[var(--text-muted)]">{label}</dt>
            <dd className="tabular text-[var(--text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function InsightsPanel({
  state,
  aliases,
  onRun,
  onReset,
  hasKey,
}: {
  state: InsightsState;
  aliases: AliasMap | null;
  onRun: () => void;
  onReset: () => void;
  /** Whether the visitor supplied their own Anthropic key. */
  hasKey: boolean;
}) {
  const data = state.insights ?? state.partial;
  const running = state.phase === 'running';

  return (
    <Card
      title="AI reading"
      subtitle={
        hasKey
          ? 'Claude Opus 5 on your key: streaming, and it queries the data through tools.'
          : 'Runs on a shared free tier. Add your own key above for a better, unlimited reading.'
      }
      action={
        state.phase === 'done' || state.phase === 'error' ? (
          <Button variant="ghost" onClick={onReset}>
            Clear
          </Button>
        ) : (
          <Button onClick={onRun} disabled={running}>
            {running ? 'Reading...' : hasKey ? 'Generate' : 'Generate free'}
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
            {hasKey
              ? 'It will go to Anthropic on the key above.'
              : 'Without a key it goes to Groq, which runs the shared free tier. Groq states it does not train on API data, but it is a third party either way \u2014 add your own key above to keep the run with Anthropic instead.'}
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
