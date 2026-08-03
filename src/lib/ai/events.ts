import type { Insights } from './schema';
import type { RunTrace } from './trace';

/**
 * The SSE protocol between the insights route and the browser.
 *
 * Typed in one place and imported by both ends, so a change to the wire format
 * is a compile error rather than a runtime surprise.
 */
export type InsightsEvent =
  /** Human-readable progress, shown while the model works. */
  | { type: 'status'; message: string }
  /**
   * Incremental JSON text for the current turn. `turn` lets the client discard
   * a buffer that belonged to a turn the model ended with a tool call rather
   * than an answer.
   */
  | { type: 'delta'; turn: number; text: string }
  /** A tool the model chose to call, surfaced so the run is legible. */
  | { type: 'tool'; name: string; input: Record<string, unknown>; isError: boolean }
  /** Schema-validated final output. */
  | { type: 'result'; insights: Insights }
  /** Always last on a successful run: what the run cost and how it got there. */
  | { type: 'trace'; trace: RunTrace }
  | { type: 'error'; code: string; message: string };

export function encodeEvent(event: InsightsEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Decode a raw SSE stream into typed events.
 *
 * Handles the part that is easy to get wrong: a chunk boundary can fall in the
 * middle of an event, so anything after the last `\n\n` is carried forward
 * rather than parsed.
 */
export async function* decodeEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<InsightsEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const line = chunk.trim();
        if (!line.startsWith('data:')) continue;
        try {
          yield JSON.parse(line.slice(5).trim()) as InsightsEvent;
        } catch {
          // A malformed frame is not worth killing the stream over.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
