/// <reference lib="webworker" />

import { analyze, type Analysis } from '@/lib/analytics';
import {
  buildDigest,
  type AliasMap,
  type BuildDigestOptions,
  type Digest,
} from '@/lib/digest';
import { parse, type ChatMessage, type DateOrder, type ParseResult } from '@/lib/parser';

/**
 * Parse, analyse, and build shareable digests off the main thread.
 *
 * Two reasons this is a worker rather than an inline call:
 *
 *  1. Performance. A multi-year group export runs to hundreds of thousands of
 *     messages, and doing this on the main thread freezes the tab for seconds.
 *  2. Containment. Parsed message bodies live *only* here. The main thread
 *     receives aggregates and, when the user asks for it, a redacted digest —
 *     never the transcript. The component tree cannot leak what it never holds.
 */

export interface AnalyzeRequest {
  type: 'analyze';
  text: string;
  /** Set when the user overrides an ambiguous day/month order. */
  dateOrder?: DateOrder;
}

export interface DigestRequest {
  type: 'digest';
  options: BuildDigestOptions;
}

export interface ResetRequest {
  type: 'reset';
}

export type WorkerRequest = AnalyzeRequest | DigestRequest | ResetRequest;

export type WorkerResponse =
  | {
      type: 'analyzed';
      parse: Omit<ParseResult, 'messages'>;
      analysis: Analysis;
      messageCount: number;
    }
  | { type: 'digest'; digest: Digest; aliases: AliasMap }
  | { type: 'error'; message: string };

/** Retained between messages so a digest can be rebuilt without re-parsing. */
let messages: ChatMessage[] = [];
let analysis: Analysis | null = null;

function reply(response: WorkerResponse): void {
  self.postMessage(response);
}

function handle(request: WorkerRequest): void {
  switch (request.type) {
    case 'analyze': {
      const result = parse(request.text, { dateOrder: request.dateOrder });
      const { messages: parsed, ...meta } = result;
      messages = parsed;
      analysis = analyze(parsed);
      reply({ type: 'analyzed', parse: meta, analysis, messageCount: parsed.length });
      return;
    }

    case 'digest': {
      if (!analysis) {
        reply({ type: 'error', message: 'Nothing analysed yet.' });
        return;
      }
      const { digest, aliases } = buildDigest(analysis, messages, request.options);
      reply({ type: 'digest', digest, aliases });
      return;
    }

    case 'reset': {
      messages = [];
      analysis = null;
      return;
    }
  }
}

// No origin check: this is a dedicated worker, so the message port is private
// to the page that constructed it. Origin validation applies to `window`-level
// postMessage, where any frame can be the sender.
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    handle(event.data);
  } catch (error) {
    reply({
      type: 'error',
      message: error instanceof Error ? error.message : 'Could not process this file.',
    });
  }
});
