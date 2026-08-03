import Anthropic from '@anthropic-ai/sdk';
import { preflight, runInsightsAgent } from '@/lib/ai/agent';
import { assertBodySize, BudgetError } from '@/lib/ai/budget';
import { encodeEvent, type InsightsEvent } from '@/lib/ai/events';
import { EFFORT, emptyUsage, MODEL } from '@/lib/ai/model';
import { GROQ_PROVIDER, isGroqConfigured, runGroqInsights } from '@/lib/ai/providers/groq';
import { ProviderError, type ProviderResult } from '@/lib/ai/providers/types';
import { buildTrace, logTrace, newRequestId } from '@/lib/ai/trace';
import { digestSchema, type Digest } from '@/lib/digest';

/**
 * Insight generation, over one of two backends.
 *
 * **With a key** (`Authorization: Bearer sk-ant-...`) the run goes to Claude
 * Opus 5 on the visitor's own key: streaming, tool calling, nothing stored. The
 * key is used to build a client for that request only and is never logged,
 * persisted, or attached to the trace.
 *
 * **Without a key** the run goes to a shared free tier on the project's Groq
 * key. That path is genuinely different — Groq cannot combine structured
 * outputs with tools or streaming — so it inlines the digest into one
 * non-streaming request. It is rate-limited by the provider and shared by every
 * visitor, so it is best-effort by design.
 *
 * Either way the only thing sent is the anonymised digest, and the UI states
 * which provider will receive it before anything leaves the browser.
 */

export const runtime = 'nodejs';
/** Vercel Hobby caps at 60s; Pro allows more. Streaming keeps the socket alive. */
export const maxDuration = 60;

/**
 * Pull the token out of `Authorization: Bearer <key>` without a regex.
 * `/^Bearer\s+(.+)$/` backtracks on a long header, and this value is attacker-
 * controlled.
 */
function readBearer(header: string | null): string | null {
  if (!header) return null;
  const space = header.indexOf(' ');
  if (space < 0) return null;
  if (header.slice(0, space).toLowerCase() !== 'bearer') return null;
  const token = header.slice(space + 1).trim();
  return token.length > 0 ? token : null;
}

function json(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Map an upstream failure onto a response the UI can explain to a person. */
function upstreamError(error: unknown): Response | null {
  if (error instanceof BudgetError) return json(error.status, error.code, error.message);
  if (error instanceof ProviderError) return json(error.status, error.code, error.message);
  if (error instanceof Anthropic.AuthenticationError) {
    return json(401, 'invalid_api_key', 'Anthropic rejected that API key.');
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return json(403, 'key_lacks_access', 'That key does not have access to this model.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return json(429, 'rate_limited', 'Anthropic rate-limited this key. Try again shortly.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return json(502, 'upstream_unreachable', 'Could not reach the Anthropic API.');
  }
  return null;
}

async function readDigest(request: Request): Promise<Digest | Response> {
  let body: string;
  try {
    body = await request.text();
    assertBodySize(new TextEncoder().encode(body).length);
  } catch (error) {
    return upstreamError(error) ?? json(400, 'unreadable_body', 'Could not read the request body.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, 'invalid_json', 'Request body was not valid JSON.');
  }

  const result = digestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return json(
      400,
      'invalid_digest',
      `Digest failed validation at ${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'unknown'}`,
    );
  }
  return result.data;
}

/** Plain-language failure text for an error raised mid-stream. */
function describeRunFailure(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return 'Anthropic rejected that API key.';
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate-limited this key. Try again shortly.';
  }
  if (error instanceof Error) return error.message;
  return 'The run failed.';
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const apiKey = readBearer(request.headers.get('authorization'));
  const useFreeTier = !apiKey;

  if (useFreeTier && !isGroqConfigured()) {
    return json(
      401,
      'missing_api_key',
      'This deployment has no free tier configured. Add your Anthropic API key above; it is sent only with this request and never stored.',
    );
  }

  const digest = await readDigest(request);
  if (digest instanceof Response) return digest;

  // The paid path counts tokens before spending, and surfaces a bad key as a
  // clean JSON error rather than one buried inside the stream. The free path
  // has no per-visitor cost to guard and is bounded by the provider's limits.
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1 }) : null;
  if (client) {
    try {
      await preflight(client, digest);
    } catch (error) {
      return upstreamError(error) ?? json(502, 'preflight_failed', 'Could not start the run.');
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: InsightsEvent) => {
        if (open) controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      const traceFor = (result: ProviderResult, outcome: 'ok' | 'invalid_output') =>
        buildTrace({
          requestId,
          startedAt,
          turns: result.turns,
          toolCalls: result.toolCalls,
          usage: result.usage,
          outcome,
          error: result.validationError,
          now: Date.now(),
          provider: client ? 'anthropic' : 'groq',
          shared: !client,
          model: client ? MODEL : GROQ_PROVIDER.model,
          effort: client ? EFFORT : 'n/a',
        });

      try {
        let result: ProviderResult;

        if (client) {
          send({ type: 'status', message: 'Reading the conversation shape...' });
          result = await runInsightsAgent(client, digest, {
            onDelta: (turn, text) => send({ type: 'delta', turn, text }),
            onTool: (call) =>
              send({ type: 'tool', name: call.name, input: call.input, isError: call.isError }),
            onStatus: (message) => send({ type: 'status', message }),
          });
        } else {
          // No streaming on this path, so the status line is the only progress
          // signal the user gets. Say what is actually happening.
          send({ type: 'status', message: `Reading on the shared free tier (${GROQ_PROVIDER.model})...` });
          result = await runGroqInsights(digest);
        }

        if (result.insights) {
          const trace = traceFor(result, 'ok');
          send({ type: 'result', insights: result.insights });
          send({ type: 'trace', trace });
          logTrace(trace);
        } else {
          const trace = traceFor(result, 'invalid_output');
          send({
            type: 'error',
            code: 'invalid_output',
            message: `Model output failed validation: ${result.validationError ?? 'unknown'}`,
          });
          logTrace(trace);
        }
      } catch (error) {
        const message = describeRunFailure(error);
        send({
          type: 'error',
          code: error instanceof ProviderError ? error.code : 'run_failed',
          message,
        });
        logTrace(
          buildTrace({
            requestId,
            startedAt,
            turns: 0,
            toolCalls: [],
            usage: emptyUsage(),
            outcome: 'error',
            error: message,
            now: Date.now(),
            provider: client ? 'anthropic' : 'groq',
            shared: !client,
          }),
        );
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-request-id': requestId,
    },
  });
}
