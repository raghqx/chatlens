/**
 * Request budgeting.
 *
 * Two independent limits, because they fail differently:
 *
 *  - A byte ceiling on the request body, checked before anything is parsed.
 *    Cheap, and the only thing that protects the route from a large upload.
 *  - A token ceiling, measured with the Anthropic count-tokens endpoint before
 *    the expensive call. Bytes are a poor proxy for tokens — emoji and
 *    non-Latin scripts cost several tokens per character — so a body that looks
 *    small can still be an expensive prompt.
 *
 * Counting tokens costs one fast round trip and is worth it: the visitor is
 * paying with their own key, so an accurate pre-flight number belongs in the
 * trace rather than a guess.
 */

/** Roughly 400 KB. A digest for a multi-year group chat lands around 30 KB. */
export const MAX_BODY_BYTES = 400_000;

/** Prompt ceiling for one run. Well inside the model's window; this is a cost guard. */
export const MAX_INPUT_TOKENS = 60_000;

export class BudgetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export function assertBodySize(bytes: number): void {
  if (bytes > MAX_BODY_BYTES) {
    throw new BudgetError(
      `Digest is ${Math.round(bytes / 1000)} KB, over the ${Math.round(MAX_BODY_BYTES / 1000)} KB limit. Narrow the date range or turn off message samples.`,
      413,
      'body_too_large',
    );
  }
}

export function assertTokenBudget(inputTokens: number): void {
  if (inputTokens > MAX_INPUT_TOKENS) {
    throw new BudgetError(
      `This request would use ${inputTokens.toLocaleString()} input tokens, over the ${MAX_INPUT_TOKENS.toLocaleString()} limit. Turn off message samples or analyse a shorter window.`,
      413,
      'token_budget_exceeded',
    );
  }
}
