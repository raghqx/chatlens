import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, type Analysis } from '@/lib/analytics';
import { buildDigest, type Digest } from '@/lib/digest';
import { parse, type ParseResult } from '@/lib/parser';

/**
 * Golden cases for the deterministic pipeline.
 *
 * These are the assertions that must hold before an AI reading is worth
 * anything: if the parser miscounts or the date order flips, the model is
 * describing the wrong conversation, fluently. They run in CI on every commit
 * and need no API key.
 *
 * Fixtures are generated from a seeded PRNG and committed, so a run is
 * reproducible and a diff in the numbers means a real behaviour change.
 */

const FIXTURE_DIR = join(process.cwd(), 'evals', 'fixtures');

export interface GoldenCase {
  name: string;
  fixture: string;
  expect: {
    format: 'ios' | 'android';
    dateOrder: 'day-first' | 'month-first' | 'year-first';
    dateOrderAssumed: boolean;
    participants: string[];
    /** Spoken (non-system) message count. */
    messages: number;
    /** Every participant share must sum to 1. */
    sharesSumToOne: true;
  };
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'iOS export, two people, day-first dates',
    fixture: 'ios-two-person.txt',
    expect: {
      format: 'ios',
      dateOrder: 'day-first',
      dateOrderAssumed: false,
      participants: ['Aarav', 'Meera'],
      messages: 900,
      sharesSumToOne: true,
    },
  },
  {
    name: 'Android export, four-person group, 24-hour clock',
    fixture: 'android-group.txt',
    expect: {
      format: 'android',
      dateOrder: 'day-first',
      dateOrderAssumed: false,
      participants: ['Rohit', 'Priya', 'Dev', 'Sana'],
      messages: 700,
      sharesSumToOne: true,
    },
  },
  {
    name: 'US-format export, month-first dates inferred correctly',
    fixture: 'us-format.txt',
    expect: {
      format: 'ios',
      dateOrder: 'month-first',
      dateOrderAssumed: false,
      participants: ['Alex', 'Sam'],
      messages: 400,
      sharesSumToOne: true,
    },
  },
];

export interface RunResult {
  parsed: ParseResult;
  analysis: Analysis;
  digest: Digest;
}

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

/** Run one fixture through the full deterministic pipeline. */
export function runCase(fixture: string): RunResult {
  const parsed = parse(loadFixture(fixture));
  const analysis = analyze(parsed.messages);
  const { digest } = buildDigest(analysis, parsed.messages);
  return { parsed, analysis, digest };
}
