import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { normalize } from './normalize';

/** Read back local wall-clock components, since epochs depend on the test runner's zone. */
const parts = (at: number) => {
  const d = new Date(at);
  return {
    y: d.getFullYear(),
    mo: d.getMonth() + 1,
    d: d.getDate(),
    h: d.getHours(),
    mi: d.getMinutes(),
  };
};

/** Pad a transcript out past the author-frequency threshold. */
const padded = (lines: string[], header: (i: number) => string) => {
  const filler = Array.from({ length: 25 }, (_, i) => header(i));
  return [...lines, ...filler].join('\n');
};

describe('normalize', () => {
  it('strips the BOM, bidi marks and narrow no-break spaces', () => {
    const raw = `﻿‎[03/08/2024, 9:41:03 AM] Alice: hi`;
    const out = normalize(raw);
    expect(out.startsWith('[03/08/2024')).toBe(true);
    expect(out).toContain('9:41:03 AM');
    expect(out).not.toMatch(/[﻿‎ ]/);
  });

  it('is idempotent', () => {
    const raw = `﻿[03/08/2024, 9:41:03 AM] A: x\r\n`;
    expect(normalize(normalize(raw))).toBe(normalize(raw));
  });
});

describe('parse - export formats', () => {
  it('reads the iOS bracketed layout', () => {
    const text = padded(
      ['[13/08/2024, 9:41:03 AM] Alice: good morning'],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: msg ${i}`,
    );
    const r = parse(text);
    expect(r.format).toBe('ios');
    expect(r.messages[0].author).toBe('Alice');
    expect(r.messages[0].text).toBe('good morning');
    expect(parts(r.messages[0].at)).toMatchObject({ y: 2024, mo: 8, d: 13, h: 9, mi: 41 });
  });

  it('reads the Android dashed layout, including 24-hour clocks', () => {
    const text = padded(
      ['13/08/2024, 21:41 - Alice: evening'],
      (i) => `13/08/2024, 22:${String(i).padStart(2, '0')} - Bob: msg ${i}`,
    );
    const r = parse(text);
    expect(r.format).toBe('android');
    expect(parts(r.messages[0].at)).toMatchObject({ h: 21, mi: 41 });
  });

  it('handles the U+202F narrow space before AM/PM that WhatsApp now emits', () => {
    const text = padded(
      [`[13/08/2024, 9:41:03 PM] Alice: late`],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 PM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(parts(r.messages[0].at).h).toBe(21);
  });

  it('converts 12 AM to hour 0 and 12 PM to hour 12', () => {
    const text = padded(
      ['[13/08/2024, 12:05:00 AM] Alice: midnight', '[13/08/2024, 12:05:00 PM] Alice: noon'],
      (i) => `[13/08/2024, 1:${String(i).padStart(2, '0')}:00 PM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(parts(r.messages[0].at).h).toBe(0);
    expect(parts(r.messages[1].at).h).toBe(12);
  });

  it('reads ISO year-first dates', () => {
    const text = padded(
      ['2024-08-13, 09:41 - Alice: iso'],
      (i) => `2024-08-13, 10:${String(i).padStart(2, '0')} - Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.dateOrder).toBe('year-first');
    expect(parts(r.messages[0].at)).toMatchObject({ y: 2024, mo: 8, d: 13 });
  });
});

describe('parse - date order inference', () => {
  // The legacy Python matched \d{1,2}/\d{1,2} but hard-coded "%d/%m/%y",
  // silently swapping day and month on US-format exports.
  it('proves day-first from a day above 12', () => {
    const text = padded(
      ['[25/03/2024, 9:00:00 AM] Alice: a'],
      (i) => `[25/03/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.dateOrder).toBe('day-first');
    expect(r.dateOrderAssumed).toBe(false);
    expect(parts(r.messages[0].at)).toMatchObject({ mo: 3, d: 25 });
  });

  it('proves month-first from a second slot above 12', () => {
    const text = padded(
      ['[03/25/2024, 9:00:00 AM] Alice: a'],
      (i) => `[03/25/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.dateOrder).toBe('month-first');
    expect(parts(r.messages[0].at)).toMatchObject({ mo: 3, d: 25 });
  });

  it('flags an ambiguous file instead of guessing silently', () => {
    const text = padded(
      ['[03/08/2024, 9:00:00 AM] Alice: a'],
      (i) => `[03/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.dateOrderAssumed).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('ambiguous-date-order');
  });

  it('honours an explicit override and clears the assumed flag', () => {
    const text = padded(
      ['[03/08/2024, 9:00:00 AM] Alice: a'],
      (i) => `[03/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text, { dateOrder: 'month-first' });
    expect(r.dateOrderAssumed).toBe(false);
    expect(parts(r.messages[0].at)).toMatchObject({ mo: 3, d: 8 });
  });
});

describe('parse - authors and message kinds', () => {
  it('treats unattributed lines as system notices', () => {
    const text = padded(
      ['[13/08/2024, 9:00:00 AM] Messages are end-to-end encrypted.'],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.messages[0].author).toBeNull();
    expect(r.messages[0].kind).toBe('system');
    expect(r.authors).toEqual(['Bob']);
  });

  it('does not invent an author from a colon inside a system notice', () => {
    const text = padded(
      ['[13/08/2024, 9:00:00 AM] Alice changed the subject to "Q3: launch"'],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.authors).toEqual(['Bob']);
    expect(r.messages[0].author).toBeNull();
  });

  it('keeps multi-line message bodies intact', () => {
    const text = padded(
      ['[13/08/2024, 9:00:00 AM] Alice: line one', 'line two', 'line three'],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.messages[0].text).toBe('line one\nline two\nline three');
  });

  it('classifies media and deleted messages', () => {
    const text = padded(
      [
        '[13/08/2024, 9:00:00 AM] Alice: <Media omitted>',
        '[13/08/2024, 9:01:00 AM] Alice: image omitted',
        '[13/08/2024, 9:02:00 AM] Alice: This message was deleted',
        '[13/08/2024, 9:03:00 AM] Alice: just words',
      ],
      (i) => `[13/08/2024, 10:${String(i).padStart(2, '0')}:00 AM] Bob: m${i}`,
    );
    const r = parse(text);
    expect(r.messages.slice(0, 4).map((m) => m.kind)).toEqual([
      'media',
      'media',
      'deleted',
      'text',
    ]);
  });
});

describe('parse - failure modes', () => {
  it('returns a helpful warning when nothing matches', () => {
    const r = parse('this is not a whatsapp export at all');
    expect(r.messages).toHaveLength(0);
    expect(r.warnings[0].code).toBe('no-messages');
  });

  it('handles an empty file without throwing', () => {
    const r = parse('');
    expect(r.messages).toHaveLength(0);
  });

  it('rejects a mismatched date separator', () => {
    const r = parse('[03/08.2024, 9:00:00 AM] Alice: a');
    expect(r.messages).toHaveLength(0);
  });
});
