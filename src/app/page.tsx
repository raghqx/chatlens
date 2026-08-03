'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiKeyField, useApiKey } from '@/components/ApiKeyField';
import { BarList } from '@/components/charts/BarList';
import { ActivityHeatmap } from '@/components/charts/ActivityHeatmap';
import { MonthlyTimeline } from '@/components/charts/MonthlyTimeline';
import { Dropzone } from '@/components/Dropzone';
import { InsightsPanel } from '@/components/InsightsPanel';
import { ParticipantTable } from '@/components/ParticipantTable';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Card, Notice, StatTile, Toggle, compact } from '@/components/ui';
import { useInsights } from '@/lib/ai/use-insights';
import type { Analysis } from '@/lib/analytics';
import type { AliasMap, Digest } from '@/lib/digest';
import type { DateOrder, ParseResult } from '@/lib/parser';
import { seriesVar } from '@/lib/theme';
import type { WorkerRequest, WorkerResponse } from '@/workers/analyze.worker';

type ParseMeta = Omit<ParseResult, 'messages'>;

interface Loaded {
  meta: ParseMeta;
  analysis: Analysis;
}

const formatDay = (at: number) =>
  at ? new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-';

export default function Home() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [shareSamples, setShareSamples] = useState(false);
  const [pseudonymize, setPseudonymize] = useState(true);
  const [aliases, setAliases] = useState<AliasMap | null>(null);

  const { apiKey, setApiKey } = useApiKey();
  const insights = useInsights();

  const workerRef = useRef<Worker | null>(null);
  /**
   * The raw transcript is kept in a ref and handed straight to the worker. It
   * is deliberately not component state: nothing in the render tree should be
   * able to read message bodies.
   */
  const rawTextRef = useRef<string | null>(null);
  const digestResolve = useRef<((value: { digest: Digest; aliases: AliasMap }) => void) | null>(
    null,
  );

  useEffect(() => {
    const worker = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      switch (data.type) {
        case 'analyzed':
          setLoaded({ meta: data.parse, analysis: data.analysis });
          setBusy(false);
          break;
        case 'digest':
          setAliases(data.aliases);
          digestResolve.current?.({ digest: data.digest, aliases: data.aliases });
          digestResolve.current = null;
          break;
        case 'error':
          setWorkerError(data.message);
          setBusy(false);
          break;
      }
    });

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const post = useCallback((request: WorkerRequest) => workerRef.current?.postMessage(request), []);

  const handleFile = useCallback(
    (name: string, text: string) => {
      setBusy(true);
      setWorkerError(null);
      setFileName(name);
      insights.reset();
      rawTextRef.current = text;
      post({ type: 'analyze', text });
    },
    [insights, post],
  );

  const setDateOrder = useCallback(
    (dateOrder: DateOrder) => {
      if (!rawTextRef.current) return;
      setBusy(true);
      post({ type: 'analyze', text: rawTextRef.current, dateOrder });
    },
    [post],
  );

  const startOver = useCallback(() => {
    rawTextRef.current = null;
    setLoaded(null);
    setFileName('');
    setAliases(null);
    insights.reset();
    post({ type: 'reset' });
  }, [insights, post]);

  const runInsights = useCallback(async () => {
    const { digest } = await new Promise<{ digest: Digest; aliases: AliasMap }>((resolve) => {
      digestResolve.current = resolve;
      post({ type: 'digest', options: { pseudonymize, includeSamples: shareSamples } });
    });
    await insights.run(digest, apiKey);
  }, [apiKey, insights, post, pseudonymize, shareSamples]);

  const analysis = loaded?.analysis ?? null;

  const participantBars = useMemo(
    () =>
      (analysis?.participants ?? []).slice(0, 8).map((p, i) => ({
        label: p.name,
        value: p.messages,
        color: seriesVar(i),
        display: `${(p.share * 100).toFixed(1)}%`,
      })),
    [analysis],
  );

  const termBars = useMemo(
    () =>
      (analysis?.vocabulary.topTerms ?? [])
        .slice(0, 12)
        .map((t) => ({ label: t.value, value: t.count })),
    [analysis],
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            chatlens
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
            Conversation intelligence for WhatsApp exports. Parsing and every statistic below run
            in your browser &mdash; your chat is never uploaded. The AI reading is opt-in, runs on
            your own key, and only ever sees anonymised aggregates.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {!analysis && <Dropzone onFile={handleFile} busy={busy} />}

      {workerError && (
        <div className="mt-4">
          <Notice tone="warning">{workerError}</Notice>
        </div>
      )}

      {analysis && loaded && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">{fileName}</span>
              {' · '}
              {loaded.meta.format === 'ios' ? 'iOS export' : 'Android export'}
              {' · '}
              {formatDay(analysis.window.from)} to {formatDay(analysis.window.to)}
            </p>
            <button
              type="button"
              onClick={startOver}
              className="text-xs text-[var(--text-secondary)] underline"
            >
              Analyse a different chat
            </button>
          </div>

          {loaded.meta.warnings.map((warning) => (
            <Notice key={warning.code} tone="warning">
              {warning.message}
              {warning.code === 'ambiguous-date-order' && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setDateOrder('month-first')}
                    className="underline"
                  >
                    Read them as month-first instead
                  </button>
                </>
              )}
            </Notice>
          ))}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Messages" value={analysis.totals.messages} />
            <StatTile label="Words" value={analysis.totals.words} />
            <StatTile
              label="Active days"
              value={analysis.window.activeDays}
              hint={`of ${compact(analysis.window.spanDays)} in range`}
            />
            <StatTile
              label="Conversations"
              value={analysis.conversations.count}
              hint={`median ${analysis.conversations.medianMessages} messages`}
            />
          </div>

          <Card title="When you talk" subtitle="Messages by hour of day and day of week.">
            <ActivityHeatmap grid={analysis.activity.byHourWeekday} />
          </Card>

          <Card title="Messages per month" subtitle="Volume over the life of the chat.">
            <MonthlyTimeline data={analysis.activity.byMonth} />
          </Card>

          <Card
            title="Who talks"
            subtitle="Share of messages, median time to reply, and who restarts the conversation."
          >
            <ParticipantTable participants={analysis.participants} />
            {participantBars.length > 1 && (
              <div className="mt-5">
                <BarList data={participantBars} />
              </div>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Most used words" subtitle="Stopwords, numbers and links removed.">
              <BarList data={termBars} />
            </Card>

            <Card title="Rhythm" subtitle="Streaks, silences, and the busiest single day.">
              <dl className="flex flex-col gap-3 text-sm">
                {[
                  ['Longest daily streak', `${analysis.streaks.longestActiveDays} days`],
                  ['Longest silence', `${analysis.streaks.longestSilenceDays} days`],
                  [
                    'Busiest day',
                    analysis.streaks.busiestDate
                      ? `${analysis.streaks.busiestDate.date} (${analysis.streaks.busiestDate.count})`
                      : '-',
                  ],
                  ['Media shared', compact(analysis.totals.media)],
                  ['Links shared', compact(analysis.totals.links)],
                  ['Emoji used', compact(analysis.totals.emoji)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">{label}</dt>
                    <dd className="tabular text-right text-[var(--text-primary)]">{value}</dd>
                  </div>
                ))}
              </dl>
              {analysis.vocabulary.topEmoji.length > 0 && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="mb-2 text-xs text-[var(--text-muted)]">Most used emoji</p>
                  <ul className="flex flex-wrap gap-3">
                    {analysis.vocabulary.topEmoji.slice(0, 8).map((e) => (
                      <li key={e.value} className="text-center">
                        <span className="block text-xl">{e.value}</span>
                        <span className="tabular text-[10px] text-[var(--text-muted)]">
                          {e.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Before you send anything"
            subtitle="You control exactly what leaves the device."
          >
            <div className="flex flex-col gap-4">
              <ApiKeyField apiKey={apiKey} onChange={setApiKey} />
              <Toggle
                checked={pseudonymize}
                onChange={setPseudonymize}
                label="Replace names with P1, P2, ..."
                description="Recommended. Real display names never leave your browser; they are mapped back for display only."
              />
              <Toggle
                checked={shareSamples}
                onChange={setShareSamples}
                label="Include a sample of message text"
                description="Off by default. When on, 40 messages spread across the whole chat are sent with phone numbers, emails, long digit runs and link paths stripped."
              />
            </div>
          </Card>

          <InsightsPanel
            state={insights.state}
            aliases={aliases}
            onRun={() => void runInsights()}
            onReset={insights.reset}
            apiKey={apiKey}
          />
        </div>
      )}

      <footer className="mt-14 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-muted)]">
        <p>
          &copy; {new Date().getFullYear()} Raghav Singhal &middot; MIT licensed &middot;{' '}
          <a
            href="https://github.com/raghqx/chatlens"
            className="underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Source
          </a>
        </p>
        <p className="mt-1.5">
          Not affiliated with WhatsApp or Meta. WhatsApp is a trademark of Meta Platforms, Inc.
        </p>
      </footer>
    </main>
  );
}
