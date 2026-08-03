import { DIGEST_VERSION } from '@/lib/digest';
import { EFFORT, estimateCostUsd, MODEL, type TokenUsage } from './model';
import { PROMPT_ID } from './prompts/insights.v1';

/**
 * One structured record per run.
 *
 * An LLM call has no stack trace. When a run comes back shallow, slow, or
 * expensive, the questions are always the same: which prompt version, which
 * model, how many tool calls, how many tokens, how long, what did it cost. This
 * captures all of it as a single JSON line, and the same object is streamed to
 * the browser so the user can see exactly what their key was spent on.
 */

export interface ToolInvocation {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  /** Characters returned to the model, a cheap proxy for context consumed. */
  resultChars: number;
}

export interface RunTrace {
  requestId: string;
  promptId: string;
  digestVersion: string;
  model: string;
  effort: string;
  /** Model turns taken, including the final one that produced the JSON. */
  turns: number;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  estimatedCostUsd: number;
  durationMs: number;
  outcome: 'ok' | 'invalid_output' | 'error';
  /** Present when `outcome` is not `ok`. */
  error?: string;
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`;
}

export function buildTrace(input: {
  requestId: string;
  startedAt: number;
  turns: number;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  outcome: RunTrace['outcome'];
  error?: string;
  now: number;
}): RunTrace {
  return {
    requestId: input.requestId,
    promptId: PROMPT_ID,
    digestVersion: DIGEST_VERSION,
    model: MODEL,
    effort: EFFORT,
    turns: input.turns,
    toolCalls: input.toolCalls,
    usage: input.usage,
    estimatedCostUsd: Number(estimateCostUsd(input.usage).toFixed(6)),
    durationMs: input.now - input.startedAt,
    outcome: input.outcome,
    ...(input.error ? { error: input.error } : {}),
  };
}

/**
 * Emit the trace as one JSON line.
 *
 * Structured rather than prose so it is greppable in Vercel's log drain and can
 * be shipped to any log store without a parser. It deliberately contains no
 * digest content — only shape and cost.
 */
export function logTrace(trace: RunTrace): void {
  console.log(JSON.stringify({ event: 'insights.run', ...trace }));
}
