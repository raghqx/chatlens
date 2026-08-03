'use client';

import { useCallback, useRef, useState } from 'react';
import type { Digest } from '@/lib/digest';
import { decodeEventStream } from './events';
import { parsePartialJson } from './partial-json';
import type { Insights } from './schema';
import type { RunTrace } from './trace';

/**
 * Client half of the insights protocol.
 *
 * Renders progressively: text deltas accumulate into a buffer that is repaired
 * and parsed on every chunk, so complete fields appear as they arrive instead
 * of after the whole document lands. The buffer resets when the model starts a
 * new turn, because a turn that ended in a tool call was preamble, not an
 * answer.
 */

export interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
}

export type InsightsPhase = 'idle' | 'running' | 'done' | 'error';

export interface InsightsState {
  phase: InsightsPhase;
  status: string;
  /** Progressively parsed output; fields fill in as they stream. */
  partial: Partial<Insights> | null;
  /** Schema-validated final output. */
  insights: Insights | null;
  tools: ToolEvent[];
  trace: RunTrace | null;
  error: string | null;
}

const INITIAL: InsightsState = {
  phase: 'idle',
  status: '',
  partial: null,
  insights: null,
  tools: [],
  trace: null,
  error: null,
};

export function useInsights() {
  const [state, setState] = useState<InsightsState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const run = useCallback(async (digest: Digest, apiKey: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...INITIAL, phase: 'running', status: 'Starting...' });

    let buffer = '';
    let currentTurn = 0;

    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(digest),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response
          .json()
          .then((b: { message?: string }) => b.message)
          .catch(() => null);
        setState((s) => ({
          ...s,
          phase: 'error',
          error: detail ?? `Request failed with status ${response.status}.`,
        }));
        return;
      }

      for await (const event of decodeEventStream(response.body)) {
        switch (event.type) {
          case 'status':
            setState((s) => ({ ...s, status: event.message }));
            break;

          case 'delta': {
            // A new turn means the previous buffer was preamble to a tool call.
            if (event.turn !== currentTurn) {
              currentTurn = event.turn;
              buffer = '';
            }
            buffer += event.text;
            const partial = parsePartialJson<Partial<Insights>>(buffer);
            if (partial) setState((s) => ({ ...s, partial }));
            break;
          }

          case 'tool':
            setState((s) => ({
              ...s,
              tools: [...s.tools, { name: event.name, input: event.input, isError: event.isError }],
              status: `Queried ${event.name}`,
            }));
            break;

          case 'result':
            setState((s) => ({
              ...s,
              insights: event.insights,
              partial: event.insights,
              status: '',
            }));
            break;

          case 'trace':
            setState((s) => ({ ...s, trace: event.trace, phase: 'done' }));
            break;

          case 'error':
            setState((s) => ({ ...s, phase: 'error', error: event.message }));
            break;
        }
      }

      // The stream can end without a trace if the connection dropped mid-run.
      setState((s) => (s.phase === 'running' ? { ...s, phase: s.insights ? 'done' : 'error', error: s.insights ? null : 'The connection closed before the run finished.' } : s));
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        phase: 'error',
        error: error instanceof Error ? error.message : 'The request failed.',
      }));
    }
  }, []);

  return { state, run, reset };
}
