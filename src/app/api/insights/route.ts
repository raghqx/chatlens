import Anthropic from '@anthropic-ai/sdk';
import { preflight, runInsightsAgent } from '@/lib/ai/agent';
import { assertBodySize, BudgetError } from '@/lib/ai/budget';
import { encodeEvent, type InsightsEvent } from '@/lib/ai/events';
import { emptyUsage } from '@/lib/ai/model';
import { buildTrace, logTrace, newRequestId } from '@/lib/ai/trace';
import { digestSchema, type Digest } from '@/lib/digest';

/**
 * Bring-your-own-key insight generation.
 *
 * The key arrives per request in an `Authorization` header, builds a client for
 * that request only, and is never logged, persisted, or attached to the trace.
 * There is no server-side key and no database.
 *
 * This handler is deliberately thin: validate, budget, adapt the agent's events
 * onto an SSE stream, log a trace. The reasoning lives in `lib/ai/agent`, which
 * is what the eval harness exercises.
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

async function readRequest(
  request: Request,
): Promise<{ apiKey: string; digest: Digest } | Response> {
  const apiKey = readBearer(request.headers.get('authorization'));
  if (!apiKey) {
    return json(
      401,
      'missing_api_key',
      'Add your Anthropic API key. It is sent only with this request and never stored.',
    );
  }

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

  return { apiKey, digest: result.data };
}

/** Plain-language failure text for an error raised mid-stream. */
function describeRunFailure(error: unknown): string {
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

  const input = await readRequest(request);
  if (input instanceof Response) return input;

  const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 1 });

  // Count the prompt before spending on it; a bad key also surfaces here,
  // as a clean JSON error rather than an error buried inside the stream.
  try {
    await preflight(client, input.digest);
  } catch (error) {
    return upstreamError(error) ?? json(502, 'preflight_failed', 'Could not start the run.');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: InsightsEvent) => {
        if (open) controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        send({ type: 'status', message: 'Reading the conversation shape...' });

        const result = await runInsightsAgent(client, input.digest, {
          onDelta: (turn, text) => send({ type: 'delta', turn, text }),
          onTool: (call) =>
            send({ type: 'tool', name: call.name, input: call.input, isError: call.isError }),
          onStatus: (message) => send({ type: 'status', message }),
        });

        const trace = buildTrace({
          requestId,
          startedAt,
          turns: result.turns,
          toolCalls: result.toolCalls,
          usage: result.usage,
          outcome: result.insights ? 'ok' : 'invalid_output',
          error: result.validationError,
          now: Date.now(),
        });

        if (result.insights) {
          send({ type: 'result', insights: result.insights });
          send({ type: 'trace', trace });
        } else {
          send({
            type: 'error',
            code: 'invalid_output',
            message: `Model output failed validation: ${result.validationError ?? 'unknown'}`,
          });
        }
        logTrace(trace);
      } catch (error) {
        const message = describeRunFailure(error);
        send({ type: 'error', code: 'run_failed', message });
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
