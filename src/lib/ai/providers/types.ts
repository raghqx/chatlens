import type { Insights } from '../schema';
import type { TokenUsage } from '../model';
import type { ToolInvocation } from '../trace';

/**
 * The contract every inference backend satisfies.
 *
 * There are two, and they are genuinely different systems rather than one
 * system with a swapped base URL:
 *
 *  - **anthropic** — the visitor's own key. Claude Opus 5, streaming, and tool
 *    calling over the digest.
 *  - **groq** — a shared free tier on the project's key. Groq cannot combine
 *    structured outputs with either tool use or streaming, so that path inlines
 *    the whole digest into one non-streaming request instead.
 *
 * Both return the same validated `Insights`, so everything downstream — the SSE
 * contract, the UI, the trace — is provider-agnostic.
 */

export type ProviderId = 'anthropic' | 'groq';

export interface ProviderResult {
  insights: Insights | null;
  raw: string;
  turns: number;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  validationError?: string;
}

/** Raised when a provider fails in a way the user can act on. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
