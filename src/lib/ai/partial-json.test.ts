import { describe, expect, it } from 'vitest';
import { parsePartialJson } from './partial-json';

describe('parsePartialJson', () => {
  it('parses a complete document unchanged', () => {
    expect(parsePartialJson('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
  });

  it('closes an open object', () => {
    expect(parsePartialJson('{"a":1')).toEqual({ a: 1 });
  });

  it('closes nested containers in the right order', () => {
    expect(parsePartialJson('{"a":{"b":[1,2')).toEqual({ a: { b: [1, 2] } });
  });

  it('drops a trailing comma', () => {
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
  });

  it('drops a key that has no value yet', () => {
    expect(parsePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
  });

  it('drops a half-written string value rather than inventing one', () => {
    expect(parsePartialJson('{"headline":"the conv')).toEqual({});
  });

  it('keeps completed fields while a later one is mid-write', () => {
    const buffer = '{"headline":"done","summary":"still wri';
    expect(parsePartialJson(buffer)).toEqual({ headline: 'done' });
  });

  it('keeps completed array elements, including complete fields of the open one', () => {
    const buffer = '{"findings":[{"title":"a","detail":"b"},{"title":"c"';
    expect(parsePartialJson(buffer)).toEqual({
      findings: [{ title: 'a', detail: 'b' }, { title: 'c' }],
    });
  });

  it('handles escaped quotes inside strings', () => {
    expect(parsePartialJson('{"a":"say \\"hi\\"","b":2')).toEqual({ a: 'say "hi"', b: 2 });
  });

  it('handles a string containing braces and brackets', () => {
    expect(parsePartialJson('{"a":"{[not structural]}","b":1')).toEqual({
      a: '{[not structural]}',
      b: 1,
    });
  });

  it('drops a half-written number or literal', () => {
    expect(parsePartialJson('{"a":1,"b":tru')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":1,"b":-')).toEqual({ a: 1 });
  });

  it('returns null for an empty buffer', () => {
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('   ')).toBeNull();
  });

  it('returns an empty object once the document has opened but holds nothing complete', () => {
    expect(parsePartialJson('{')).toEqual({});
    expect(parsePartialJson('{"')).toEqual({});
  });

  it('never returns a value that is not valid JSON', () => {
    const full = JSON.stringify({
      headline: 'A headline',
      findings: [
        { title: 'one', detail: 'first', evidence: ['x'], confidence: 'high' },
        { title: 'two', detail: 'second', evidence: ['y', 'z'], confidence: 'low' },
      ],
      caveats: ['short window'],
    });
    // Every prefix of a real document must either parse or return null.
    for (let i = 1; i <= full.length; i++) {
      const result = parsePartialJson(full.slice(0, i));
      if (result !== null) expect(() => JSON.stringify(result)).not.toThrow();
    }
    expect(parsePartialJson(full)).toEqual(JSON.parse(full));
  });

  it('grows monotonically as a document streams in', () => {
    const full = JSON.stringify({
      headline: 'h',
      findings: [
        { title: 'a', detail: 'aa' },
        { title: 'b', detail: 'bb' },
        { title: 'c', detail: 'cc' },
      ],
    });
    let maxFindings = 0;
    for (let i = 1; i <= full.length; i++) {
      const partial = parsePartialJson<{ findings?: unknown[] }>(full.slice(0, i));
      const count = partial?.findings?.length ?? 0;
      expect(count).toBeGreaterThanOrEqual(maxFindings);
      maxFindings = Math.max(maxFindings, count);
    }
    expect(maxFindings).toBe(3);
  });
});
