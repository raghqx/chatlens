import { describe, expect, it } from 'vitest';
import { parse } from '@/lib/parser';
import { GOLDEN_CASES, loadFixture, runCase } from './cases';

/**
 * Tier 1 of the eval suite: the deterministic pipeline.
 *
 * No API key, no network, no model. These run on every commit and are the gate
 * that matters most — a fluent AI reading of miscounted data is worse than no
 * reading at all.
 */
describe.each(GOLDEN_CASES)('$name', (testCase) => {
  const { parsed, analysis, digest } = runCase(testCase.fixture);
  const want = testCase.expect;

  it('detects the export format', () => {
    expect(parsed.format).toBe(want.format);
  });

  it('resolves the date order from the data rather than assuming', () => {
    expect(parsed.dateOrder).toBe(want.dateOrder);
    expect(parsed.dateOrderAssumed).toBe(want.dateOrderAssumed);
  });

  it('finds every participant and no phantom ones', () => {
    expect([...parsed.authors].sort()).toEqual([...want.participants].sort());
  });

  it('counts spoken messages exactly', () => {
    expect(analysis.totals.messages).toBe(want.messages);
  });

  it('excludes the encryption notice from spoken messages', () => {
    expect(analysis.totals.system).toBeGreaterThan(0);
    expect(parsed.messages).toHaveLength(analysis.totals.messages + analysis.totals.system);
  });

  it('produces participant shares that sum to one', () => {
    const sum = analysis.participants.reduce((acc, p) => acc + p.share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('keeps activity marginals consistent with the grid', () => {
    const grid = analysis.activity.byHourWeekday.flat().reduce((a, b) => a + b, 0);
    expect(grid).toBe(analysis.totals.messages);
    expect(analysis.activity.byHour.reduce((a, b) => a + b, 0)).toBe(analysis.totals.messages);
    expect(analysis.activity.byMonth.reduce((a, m) => a + m.count, 0)).toBe(
      analysis.totals.messages,
    );
  });

  it('orders timestamps monotonically', () => {
    const spoken = parsed.messages.filter((m) => m.author !== null);
    for (let i = 1; i < spoken.length; i++) {
      expect(spoken[i].at).toBeGreaterThanOrEqual(spoken[i - 1].at);
    }
  });

  it('never leaks a real name into the digest', () => {
    const wire = JSON.stringify(digest);
    for (const name of want.participants) expect(wire).not.toContain(name);
  });

  it('never leaks a link path into the digest', () => {
    const wire = JSON.stringify(digest);
    expect(wire).not.toContain('/spec/v2');
    expect(wire).toContain('docs.example.com');
  });

  it('keeps the digest small enough to prompt with', () => {
    expect(JSON.stringify(digest).length).toBeLessThan(30_000);
  });
});

describe('date-order regression', () => {
  /**
   * The bug this project was rebuilt to fix: a US-format export matched the
   * old regex but was parsed with a hard-coded day-first format string, so
   * every date silently landed in the wrong month.
   */
  it('infers the order per file instead of assuming one', () => {
    expect(runCase('ios-two-person.txt').parsed.dateOrder).toBe('day-first');
    expect(runCase('us-format.txt').parsed.dateOrder).toBe('month-first');
  });

  it('lands the same literal date in a different month under each order', () => {
    // The US fixture's first spoken message is stamped 01/07/2025: 7 January
    // under month-first, 1 July under day-first. The old parser matched this
    // line and then applied a hard-coded day-first format string, which is
    // exactly how six months of drift entered the charts without an error.
    const first = (order: 'day-first' | 'month-first') => {
      const parsed = parse(loadFixture('us-format.txt'), { dateOrder: order });
      return new Date(parsed.messages.find((m) => m.author !== null)!.at);
    };

    const asUs = first('month-first');
    expect([asUs.getMonth(), asUs.getDate()]).toEqual([0, 7]);

    const asRest = first('day-first');
    expect([asRest.getMonth(), asRest.getDate()]).toEqual([6, 1]);
  });
});
