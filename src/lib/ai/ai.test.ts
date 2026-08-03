import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analyze } from '@/lib/analytics';
import { buildDigest } from '@/lib/digest';
import type { ChatMessage } from '@/lib/parser';
import { toStrictJsonSchema } from './json-schema';
import { INSIGHTS_JSON_SCHEMA, insightsSchema } from './schema';
import { executeTool, TOOLS } from './tools';
import { addUsage, ANTHROPIC_PRICING, emptyUsage, estimateCostUsd } from './model';
import { buildOverview } from './prompts/insights.v1';
import { GROQ_PRICING } from './providers/groq';
import { buildTrace } from './trace';

const messages: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
  at: new Date(2024, 7, 1 + (i % 5), 9 + (i % 8), i % 60).getTime(),
  author: i % 3 === 0 ? 'Alice' : 'Bob',
  text: i % 7 === 0 ? 'deadline moved again 😅 https://wiki.example.com/plan' : 'shipping the release now',
  kind: 'text',
}));
const { digest } = buildDigest(analyze(messages), messages);

/** Walk every object node in a JSON Schema document. */
function objectNodes(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(objectNodes);
  if (node === null || typeof node !== 'object') return [];
  const self = node as Record<string, unknown>;
  const children = Object.values(self).flatMap(objectNodes);
  return self.type === 'object' && self.properties ? [self, ...children] : children;
}

function allKeys(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(allKeys);
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => [k, ...allKeys(v)]);
}

describe('toStrictJsonSchema', () => {
  it('removes the $schema declaration', () => {
    const out = toStrictJsonSchema(z.object({ a: z.string() }));
    expect(out.$schema).toBeUndefined();
  });

  it('strips validation keywords the structured-outputs API rejects', () => {
    const schema = z.object({
      name: z.string().min(3).max(10),
      tags: z.array(z.string()).min(1).max(5),
      score: z.number().min(0).max(100),
    });
    const keys = allKeys(toStrictJsonSchema(schema));
    for (const banned of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('closes every object and marks every property required', () => {
    const schema = z.object({
      a: z.string(),
      nested: z.object({ b: z.number(), c: z.array(z.object({ d: z.string() })) }),
    });
    for (const node of objectNodes(toStrictJsonSchema(schema))) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
  });

  it('preserves enums, which the API does support', () => {
    const out = toStrictJsonSchema(z.object({ level: z.enum(['low', 'high']) }));
    const level = (out.properties as Record<string, { enum?: string[] }>).level;
    expect(level.enum).toEqual(['low', 'high']);
  });
});

describe('INSIGHTS_JSON_SCHEMA', () => {
  it('is a closed object schema with every field required', () => {
    expect(INSIGHTS_JSON_SCHEMA.type).toBe('object');
    expect(INSIGHTS_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(INSIGHTS_JSON_SCHEMA.required).toEqual([
      'headline',
      'summary',
      'findings',
      'participants',
      'caveats',
    ]);
  });

  it('round-trips a well-formed response through the Zod validator', () => {
    const response = {
      headline: 'Evening-heavy, one-sided',
      summary: 'Two people, mostly at night.',
      findings: [
        {
          title: 'Nights dominate',
          detail: 'Most traffic lands after 21:00.',
          evidence: ['peak hour 22:00'],
          confidence: 'high',
        },
      ],
      participants: [{ alias: 'P1', role: 'conversation starter', note: 'Opens most threads.' }],
      caveats: ['Short window.'],
    };
    expect(() => insightsSchema.parse(response)).not.toThrow();
  });

  it('rejects an unknown confidence level', () => {
    const bad = {
      headline: 'h',
      summary: 's',
      findings: [{ title: 't', detail: 'd', evidence: [], confidence: 'certain' }],
      participants: [],
      caveats: [],
    };
    expect(insightsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('tools', () => {
  it('declares strict, closed input schemas', () => {
    for (const tool of TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.input_schema.required).toEqual(Object.keys(tool.input_schema.properties));
    }
  });

  it('returns each activity breakdown', () => {
    for (const breakdown of ['hour', 'weekday', 'month']) {
      const r = executeTool(digest, { name: 'get_activity_profile', input: { breakdown } });
      expect(r.isError).toBe(false);
      expect(r.content.length).toBeGreaterThan(0);
    }
  });

  it('returns detail for a known participant', () => {
    const r = executeTool(digest, { name: 'get_participant_detail', input: { alias: 'P1' } });
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Participant P1');
  });

  it('reports an unknown alias as a recoverable error listing valid ones', () => {
    const r = executeTool(digest, { name: 'get_participant_detail', input: { alias: 'P99' } });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('P1');
  });

  it('respects the vocabulary limit', () => {
    const r = executeTool(digest, { name: 'get_vocabulary', input: { kind: 'terms', limit: 5 } });
    expect(r.isError).toBe(false);
    expect(r.content.split('\n').length - 1).toBeLessThanOrEqual(5);
  });

  it('does not throw on an unknown tool or malformed input', () => {
    expect(executeTool(digest, { name: 'nope', input: {} }).isError).toBe(true);
    expect(executeTool(digest, { name: 'get_vocabulary', input: {} }).isError).toBe(true);
    const objectArg = executeTool(digest, {
      name: 'get_participant_detail',
      input: { alias: { nested: true } },
    });
    expect(objectArg.isError).toBe(true);
    // The model must be told what it actually sent, not "[object Object]".
    expect(objectArg.content).not.toContain('[object Object]');
  });
});

describe('prompt overview', () => {
  it('stays compact so detail is fetched by tool call, not pasted', () => {
    expect(buildOverview(digest).length).toBeLessThan(4_000);
  });

  it('never contains a real participant name', () => {
    const overview = buildOverview(digest);
    expect(overview).not.toContain('Alice');
    expect(overview).not.toContain('Bob');
    expect(overview).toContain('P1');
  });
});

describe('cost accounting', () => {
  it('prices a run from accumulated usage', () => {
    const usage = addUsage(emptyUsage(), { input: 1_000_000, output: 100_000 });
    // 1M input at $5 + 100k output at $25/M = $5.00 + $2.50
    expect(estimateCostUsd(usage, ANTHROPIC_PRICING)).toBeCloseTo(7.5, 6);
  });

  it('starts at zero', () => {
    expect(estimateCostUsd(emptyUsage(), ANTHROPIC_PRICING)).toBe(0);
  });

  // Regression: every run was priced with Anthropic rates regardless of who
  // served it, so a free Groq reading reported $0.0656 instead of $0.0016.
  it('prices a Groq run with Groq rates, not Anthropic ones', () => {
    const usage = addUsage(emptyUsage(), { input: 1_670, output: 2_291 });
    const groq = estimateCostUsd(usage, GROQ_PRICING);
    const anthropic = estimateCostUsd(usage, ANTHROPIC_PRICING);

    expect(groq).toBeCloseTo(1_670 * 0.15e-6 + 2_291 * 0.6e-6, 8);
    expect(groq).toBeLessThan(anthropic / 10);
  });

  it('reports a shared free-tier run as costing nothing', () => {
    const trace = buildTrace({
      requestId: 'r',
      startedAt: 0,
      turns: 1,
      toolCalls: [],
      usage: addUsage(emptyUsage(), { input: 1_670, output: 2_291 }),
      outcome: 'ok',
      now: 5_000,
      provider: 'groq',
      shared: true,
    });
    expect(trace.estimatedCostUsd).toBe(0);
    expect(trace.provider).toBe('groq');
  });
});
