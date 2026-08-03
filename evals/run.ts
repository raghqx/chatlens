import Anthropic from '@anthropic-ai/sdk';
import { runInsightsAgent } from '@/lib/ai/agent';
import { ANTHROPIC_PRICING, estimateCostUsd } from '@/lib/ai/model';
import { PROMPT_ID } from '@/lib/ai/prompts/insights.v1';
import { GOLDEN_CASES, runCase } from './cases';
import { runChecks, type Check } from './checks';
import { averageScore, judge, type Verdict } from './judge';

/**
 * Tier 2 of the eval suite: does the AI layer produce output worth showing?
 *
 * Requires ANTHROPIC_API_KEY and costs real money, so it is a separate command
 * from `npm test` rather than part of CI. Run it before changing the prompt,
 * the model, the effort level, or the tool surface — those are the changes that
 * silently degrade quality with no test to catch them.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run eval
 */

/** Below this average the prompt has regressed and should not ship. */
const PASS_THRESHOLD = 3.5;

interface CaseReport {
  name: string;
  checks: Check[];
  verdict: Verdict | null;
  average: number;
  costUsd: number;
  durationMs: number;
  toolCalls: string[];
  error?: string;
}

const bar = (score: number) => '#'.repeat(Math.round(score)) + '.'.repeat(5 - Math.round(score));

async function evaluateCase(client: Anthropic, name: string, fixture: string): Promise<CaseReport> {
  const startedAt = Date.now();
  const { digest } = runCase(fixture);

  const result = await runInsightsAgent(client, digest);
  if (!result.insights) {
    return {
      name,
      checks: [],
      verdict: null,
      average: 0,
      costUsd: estimateCostUsd(result.usage, ANTHROPIC_PRICING),
      durationMs: Date.now() - startedAt,
      toolCalls: result.toolCalls.map((t) => t.name),
      error: result.validationError ?? 'no output',
    };
  }

  const checks = runChecks(digest, result.insights);
  const verdict = await judge(client, digest, result.insights);

  return {
    name,
    checks,
    verdict,
    average: averageScore(verdict),
    costUsd: estimateCostUsd(result.usage, ANTHROPIC_PRICING),
    durationMs: Date.now() - startedAt,
    toolCalls: result.toolCalls.map((t) => t.name),
  };
}

function report(reports: CaseReport[]): boolean {
  let allPassed = true;

  for (const r of reports) {
    console.log(`\n${'='.repeat(72)}\n${r.name}`);

    if (r.error) {
      console.log(`  FAILED: ${r.error}`);
      allPassed = false;
      continue;
    }

    const failedChecks = r.checks.filter((c) => !c.passed);
    for (const check of r.checks) {
      console.log(`  [${check.passed ? 'pass' : 'FAIL'}] ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }

    if (r.verdict) {
      console.log('');
      for (const [dimension, value] of Object.entries(r.verdict)) {
        if (dimension === 'unsupportedClaims') continue;
        const d = value as { score: number; reason: string };
        console.log(`  ${dimension.padEnd(12)} ${bar(d.score)} ${d.score}/5  ${d.reason}`);
      }
      if (r.verdict.unsupportedClaims.length > 0) {
        console.log('\n  Unsupported claims:');
        for (const claim of r.verdict.unsupportedClaims) console.log(`    - ${claim}`);
      }
    }

    console.log(
      `\n  average ${r.average.toFixed(2)}/5 | tools ${r.toolCalls.join(', ') || 'none'} | ${(r.durationMs / 1000).toFixed(1)}s | $${r.costUsd.toFixed(4)}`,
    );

    if (failedChecks.length > 0 || r.average < PASS_THRESHOLD) allPassed = false;
  }

  const totalCost = reports.reduce((sum, r) => sum + r.costUsd, 0);
  const meanScore = reports.reduce((sum, r) => sum + r.average, 0) / (reports.length || 1);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`prompt ${PROMPT_ID} | mean ${meanScore.toFixed(2)}/5 | threshold ${PASS_THRESHOLD} | total $${totalCost.toFixed(4)}`);
  console.log(allPassed ? 'RESULT: pass' : 'RESULT: fail');
  return allPassed;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. This suite calls the real API and costs money.');
    console.error('The deterministic evals need no key: npm test');
    process.exit(1);
  }

  const client = new Anthropic();
  console.log(`Running ${GOLDEN_CASES.length} cases against prompt ${PROMPT_ID}...`);

  // Sequential on purpose: parallel runs make rate-limit errors look like
  // quality regressions, and these are slow enough to want readable output.
  const reports: CaseReport[] = [];
  for (const testCase of GOLDEN_CASES) {
    reports.push(await evaluateCase(client, testCase.name, testCase.fixture));
  }

  process.exit(report(reports) ? 0 : 1);
}

void main();
