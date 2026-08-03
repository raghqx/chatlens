import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParams, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Digest } from '@/lib/digest';
import { assertTokenBudget } from './budget';
import {
  addUsage,
  emptyUsage,
  EFFORT,
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  MODEL,
  type TokenUsage,
} from './model';
import { buildOverview, SYSTEM } from './prompts/insights.v1';
import { INSIGHTS_JSON_SCHEMA, insightsSchema, type Insights } from './schema';
import { executeTool, TOOLS } from './tools';
import type { ToolInvocation } from './trace';

/**
 * The agent loop, independent of HTTP.
 *
 * Kept out of the route handler so the same code path that serves the browser
 * is what the eval harness measures. An eval that exercises a reimplementation
 * of the real loop grades the wrong thing.
 */

export interface AgentEvents {
  /** Incremental output text, tagged with the turn that produced it. */
  onDelta?: (turn: number, text: string) => void;
  onTool?: (call: ToolInvocation) => void;
  onStatus?: (message: string) => void;
}

export interface AgentResult {
  insights: Insights | null;
  /** Raw text of the final turn, kept for diagnosing a validation failure. */
  raw: string;
  turns: number;
  toolCalls: ToolInvocation[];
  usage: TokenUsage;
  validationError?: string;
}

const usageFrom = (u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): TokenUsage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
});

/**
 * Assemble the request body.
 *
 * `output_config` carries both the reasoning effort and the JSON Schema the
 * response must satisfy. The installed SDK's published types still describe the
 * older `output_format` parameter, so the object is built against the shape the
 * API actually accepts and cast exactly once, here.
 */
function buildRequest(messages: MessageParam[]): MessageCreateParams {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Stable prefix, cached: the system prompt never varies per request.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: INSIGHTS_JSON_SCHEMA },
    },
    messages,
  } as unknown as MessageCreateParams;
}

/** Count the prompt before paying for it, and refuse an oversized run. */
export async function preflight(client: Anthropic, digest: Digest): Promise<number> {
  const counted = await client.messages.countTokens({
    model: MODEL,
    system: SYSTEM,
    tools: TOOLS as never,
    messages: [{ role: 'user', content: buildOverview(digest) }],
  });
  assertTokenBudget(counted.input_tokens);
  return counted.input_tokens;
}

/**
 * Drive the model until it stops calling tools, streaming as it goes.
 *
 * Streaming is not only for the UI: a long turn on a large `max_tokens` can
 * otherwise exceed an HTTP idle timeout and fail with nothing to show for it.
 */
export async function runInsightsAgent(
  client: Anthropic,
  digest: Digest,
  events: AgentEvents = {},
): Promise<AgentResult> {
  const messages: MessageParam[] = [{ role: 'user', content: buildOverview(digest) }];
  const toolCalls: ToolInvocation[] = [];
  let usage = emptyUsage();

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const stream = client.messages.stream(buildRequest(messages));

    let turnText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        turnText += event.delta.text;
        events.onDelta?.(turn, event.delta.text);
      }
    }

    const message = await stream.finalMessage();
    usage = addUsage(usage, usageFrom(message.usage));

    const requests = message.content.filter((block) => block.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || requests.length === 0) {
      const parsed = safeParse(turnText);
      return {
        insights: parsed.insights,
        raw: turnText,
        turns: turn + 1,
        toolCalls,
        usage,
        ...(parsed.error ? { validationError: parsed.error } : {}),
      };
    }

    messages.push({ role: 'assistant', content: message.content });

    // Every tool result for a turn goes back in one user message. Splitting
    // them across messages trains the model to stop issuing parallel calls.
    const results = requests.map((block) => {
      const input = (block.input ?? {}) as Record<string, unknown>;
      const result = executeTool(digest, { name: block.name, input });

      const invocation: ToolInvocation = {
        name: block.name,
        input,
        isError: result.isError,
        resultChars: result.content.length,
      };
      toolCalls.push(invocation);
      events.onTool?.(invocation);

      return {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError,
      };
    });

    messages.push({ role: 'user', content: results });
    events.onStatus?.('Reading the numbers...');
  }

  return {
    insights: null,
    raw: '',
    turns: MAX_TOOL_TURNS,
    toolCalls,
    usage,
    validationError: `Model still calling tools after ${MAX_TOOL_TURNS} turns.`,
  };
}

function safeParse(text: string): { insights: Insights | null; error?: string } {
  try {
    const validated = insightsSchema.safeParse(JSON.parse(text));
    if (validated.success) return { insights: validated.data };
    return { insights: null, error: validated.error.issues[0]?.message ?? 'shape mismatch' };
  } catch {
    return { insights: null, error: 'Response was not valid JSON.' };
  }
}
