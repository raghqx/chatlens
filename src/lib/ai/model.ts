/**
 * Model selection and cost accounting, in one place.
 *
 * Kept as data rather than scattered literals so the trace can report what a
 * run actually cost, and so changing model or effort is a one-line diff.
 */

export const MODEL = 'claude-opus-5' as const;

/**
 * Reasoning depth. `medium` is the deliberate choice here: the task is bounded
 * (read an aggregate, write structured commentary), and on Claude Opus 5 the
 * lower effort levels hold quality well while roughly halving the token spend a
 * visitor pays on their own key. Raise to `high` if findings feel shallow.
 */
export const EFFORT = 'medium' as const;

/**
 * Streamed, so a long turn cannot trip an HTTP timeout. Thinking is on by
 * default on Claude Opus 5 and is billed against this same ceiling, so the
 * budget is well above the size of the JSON we actually want back.
 */
export const MAX_TOKENS = 32_000;

/** Hard stop on the tool loop, so a pathological run cannot bill forever. */
export const MAX_TOOL_TURNS = 6;

/** USD per million tokens, Claude Opus 5 first-party API rates. */
export const PRICING = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  /** Cache reads bill at ~0.1x input; writes at ~1.25x. */
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
} as const;

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function estimateCostUsd(usage: TokenUsage): number {
  const perMillion =
    usage.input * PRICING.inputPerMTok +
    usage.output * PRICING.outputPerMTok +
    usage.cacheRead * PRICING.cacheReadPerMTok +
    usage.cacheWrite * PRICING.cacheWritePerMTok;
  return perMillion / 1_000_000;
}

export const emptyUsage = (): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export function addUsage(total: TokenUsage, delta: Partial<TokenUsage>): TokenUsage {
  return {
    input: total.input + (delta.input ?? 0),
    output: total.output + (delta.output ?? 0),
    cacheRead: total.cacheRead + (delta.cacheRead ?? 0),
    cacheWrite: total.cacheWrite + (delta.cacheWrite ?? 0),
  };
}
