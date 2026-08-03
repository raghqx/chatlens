import type { Digest } from '@/lib/digest';
import { emptyUsage } from '../model';
import { buildInlineContext, SYSTEM } from '../prompts/insights.v1';
import { INSIGHTS_JSON_SCHEMA, insightsSchema } from '../schema';
import { ProviderError, type ProviderInfo, type ProviderResult } from './types';

/**
 * Shared free tier, backed by Groq.
 *
 * Deliberately not the Anthropic SDK — this is a different provider speaking
 * the OpenAI-compatible chat-completions protocol, reached with plain `fetch`
 * so no second SDK enters the dependency tree.
 *
 * Three constraints shape this path, all from Groq's structured-output support:
 *
 *  1. Structured outputs cannot be combined with tool use. So the whole digest
 *     is inlined rather than fetched by tool call. That is affordable only
 *     because the digest is ~600 tokens; it is why the tool layer on the
 *     Anthropic path is an optimisation rather than a requirement.
 *  2. Structured outputs cannot be combined with streaming. This path returns
 *     one response, so the UI shows progress rather than incremental text.
 *  3. `strict: true` requires every property required and every object closed —
 *     which the schema compiler already guarantees for the Anthropic path, so
 *     the same compiled schema is reused unchanged.
 *
 * Free-tier limits at time of writing: 30 requests/min, 1,000/day, 8,000
 * tokens/min, 200,000 tokens/day, shared across every visitor. A run costs
 * roughly 4,000 tokens, so the ceiling is about 50 readings a day before the
 * app falls back to asking for a key.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** One of only two Groq models supporting `strict` constrained decoding. */
const MODEL = 'openai/gpt-oss-120b';

const MAX_COMPLETION_TOKENS = 6_000;

/** Groq's free tier caps a single request well below the Anthropic path's ceiling. */
const REQUEST_TIMEOUT_MS = 60_000;

export const GROQ_PROVIDER: ProviderInfo = {
  id: 'groq',
  label: 'Groq free tier',
  model: MODEL,
  streams: false,
  usesTools: false,
  shared: true,
};

/** Whether this deployment can serve a keyless visitor from the shared tier. */
export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

/** Turn a non-2xx response into something the UI can explain to a person. */
function describeFailure(status: number, body: ChatCompletion, ownKey: boolean): ProviderError {
  const detail = body.error?.message ?? `Groq returned ${status}.`;

  if (status === 429) {
    return new ProviderError(
      ownKey
        ? 'Groq rate-limited your key. Wait a minute and try again.'
        : 'The shared free tier has hit its rate limit. Paste your own Groq or Anthropic key above to skip the queue, or try again in a minute.',
      429,
      'free_tier_exhausted',
    );
  }
  if (status === 401 || status === 403) {
    return ownKey
      ? new ProviderError('Groq rejected that API key.', 401, 'invalid_api_key')
      : // The visitor cannot fix the project's key. Say so plainly.
        new ProviderError(
          'The shared free tier is misconfigured. Paste your own Groq or Anthropic key above to run a reading.',
          503,
          'free_tier_unavailable',
        );
  }
  if (status >= 500) {
    return new ProviderError('The free tier provider is having problems. Try again shortly.', 502, 'free_tier_upstream');
  }
  return new ProviderError(detail, 502, 'free_tier_failed');
}

/**
 * Run one non-streaming, tool-free completion against the shared free tier.
 *
 * Returns the same shape as the Anthropic path so the route, the SSE contract
 * and the UI stay provider-agnostic.
 */
export async function runGroqInsights(
  digest: Digest,
  /** The visitor's own Groq key. Falls back to the project's shared free tier. */
  visitorKey?: string,
): Promise<ProviderResult> {
  const apiKey = visitorKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new ProviderError(
      'This deployment has no free tier configured. Paste an Anthropic or Groq API key above to run a reading.',
      503,
      'free_tier_unavailable',
    );
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildInlineContext(digest) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'conversation_insights',
          strict: true,
          schema: INSIGHTS_JSON_SCHEMA,
        },
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as ChatCompletion;
  if (!response.ok) throw describeFailure(response.status, body, Boolean(visitorKey));

  const usage = {
    ...emptyUsage(),
    input: body.usage?.prompt_tokens ?? 0,
    output: body.usage?.completion_tokens ?? 0,
  };

  const text = body.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    return {
      insights: null,
      raw: '',
      turns: 1,
      toolCalls: [],
      usage,
      validationError: 'The free tier returned an empty response.',
    };
  }

  try {
    const validated = insightsSchema.safeParse(JSON.parse(text));
    if (validated.success) {
      return { insights: validated.data, raw: text, turns: 1, toolCalls: [], usage };
    }
    return {
      insights: null,
      raw: text,
      turns: 1,
      toolCalls: [],
      usage,
      validationError: validated.error.issues[0]?.message ?? 'shape mismatch',
    };
  } catch {
    return {
      insights: null,
      raw: text,
      turns: 1,
      toolCalls: [],
      usage,
      validationError: 'The free tier returned output that was not valid JSON.',
    };
  }
}
