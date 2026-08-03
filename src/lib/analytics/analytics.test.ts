import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../parser';
import { analyze } from './metrics';
import { isStopword, STOPWORDS } from './stopwords';
import { countWords, extractEmoji, extractUrls, tokenize, urlHost } from './text';

const at = (iso: string) => new Date(iso).getTime();
const msg = (
  when: string,
  author: string | null,
  text: string,
  kind: ChatMessage['kind'] = author ? 'text' : 'system',
): ChatMessage => ({ at: at(when), author, text, kind });

describe('tokenize', () => {
  it('keeps intra-word apostrophes and drops edge quotes', () => {
    expect(tokenize(`don't "stop" now`)).toEqual(["don't", 'stop', 'now']);
  });

  it('is Unicode-aware', () => {
    expect(tokenize('café niño 東京')).toEqual(['café', 'niño', '東京']);
  });

  it('drops punctuation-only fragments', () => {
    expect(tokenize('... !!! ???')).toEqual([]);
  });
});

describe('countWords', () => {
  it('counts words across punctuation', () => {
    expect(countWords('hello, world! how are you?')).toBe(5);
  });

  it('returns zero for an empty or punctuation-only string', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('!!!')).toBe(0);
  });
});

describe('extractEmoji', () => {
  it('counts a ZWJ family sequence as one emoji', () => {
    expect(extractEmoji('👨‍👩‍👧‍👦')).toEqual(['👨‍👩‍👧‍👦']);
  });

  it('counts a skin-tone modified emoji as one', () => {
    expect(extractEmoji('👍🏽')).toEqual(['👍🏽']);
  });

  it('finds several emoji in a sentence', () => {
    expect(extractEmoji('nice 😂 work 🎉')).toEqual(['😂', '🎉']);
  });

  it('returns nothing for plain text', () => {
    expect(extractEmoji('plain text')).toEqual([]);
  });
});

describe('links', () => {
  it('extracts http and bare-www urls', () => {
    expect(extractUrls('see https://a.example/x and www.b.example')).toEqual([
      'https://a.example/x',
      'www.b.example',
    ]);
  });

  it('reduces a url to a bare host', () => {
    expect(urlHost('https://www.Example.com/a/b?token=secret')).toBe('example.com');
    expect(urlHost('not a url')).toBeNull();
  });
});

describe('stopwords', () => {
  // The legacy Python held these in one string and used substring matching, so
  // any short word occurring inside a longer stopword was silently dropped.
  it('matches whole words only', () => {
    expect(isStopword('the')).toBe(true);
    expect(isStopword('hai')).toBe(true);
    expect(isStopword('deadline')).toBe(false);
    expect(isStopword('bank')).toBe(false);
  });

  it('does not treat a substring of a stopword as a stopword', () => {
    expect(STOPWORDS.has('aap')).toBe(true);
    expect(isStopword('ap')).toBe(true);
    expect(isStopword('deploy')).toBe(false);
  });
});

describe('analyze', () => {
  const messages: ChatMessage[] = [
    msg('2024-08-01T09:00:00', null, 'Messages are end-to-end encrypted.'),
    msg('2024-08-01T09:01:00', 'Alice', 'deadline is friday, ship the release'),
    msg('2024-08-01T09:06:00', 'Bob', 'on it 👍'),
    msg('2024-08-01T09:10:00', 'Alice', 'see https://docs.example.com/spec'),
    msg('2024-08-01T09:12:00', 'Bob', '<Media omitted>', 'media'),
    // 20-hour silence: starts a second conversation on the next day.
    msg('2024-08-02T05:30:00', 'Bob', 'morning, deadline moved 😂'),
    msg('2024-08-02T06:00:00', 'Alice', 'good'),
    msg('2024-08-02T06:01:00', 'Alice', 'This message was deleted', 'deleted'),
  ];
  const a = analyze(messages);

  it('separates system notices from spoken messages', () => {
    expect(a.totals.messages).toBe(7);
    expect(a.totals.system).toBe(1);
    expect(a.totals.deleted).toBe(1);
    expect(a.totals.media).toBe(1);
  });

  it('computes per-participant shares that sum to one', () => {
    const sum = a.participants.reduce((acc, p) => acc + p.share, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(a.participants.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('excludes media and deleted bodies from word counts', () => {
    const bob = a.participants.find((p) => p.name === 'Bob')!;
    // "on it" (2) + "morning, deadline moved" (3); "<Media omitted>" excluded.
    expect(bob.words).toBe(5);
  });

  it('measures reply latency only across a change of speaker', () => {
    const bob = a.participants.find((p) => p.name === 'Bob')!;
    // Bob answered Alice after 5 min (09:01 -> 09:06). The 20h gap exceeds the
    // reply cutoff, and 09:10 -> 09:12 is Alice -> Bob at 2 min.
    expect(bob.medianReplyMinutes).toBe(3.5);
  });

  it('segments conversations on a long silence', () => {
    expect(a.conversations.count).toBe(2);
    const bob = a.participants.find((p) => p.name === 'Bob')!;
    expect(bob.conversationsStarted).toBe(1);
  });

  it('aggregates links by host, never by full url', () => {
    expect(a.vocabulary.topDomains).toEqual([{ value: 'docs.example.com', count: 1 }]);
  });

  it('ranks content terms above stopwords', () => {
    const terms = a.vocabulary.topTerms.map((t) => t.value);
    expect(terms[0]).toBe('deadline');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('the');
  });

  it('builds an hour-by-weekday grid consistent with the marginals', () => {
    const gridTotal = a.activity.byHourWeekday.flat().reduce((x, y) => x + y, 0);
    expect(gridTotal).toBe(a.totals.messages);
    expect(a.activity.byHour.reduce((x, y) => x + y, 0)).toBe(a.totals.messages);
    expect(a.activity.byWeekday.reduce((x, y) => x + y, 0)).toBe(a.totals.messages);
  });

  it('reports the active window and streaks', () => {
    expect(a.window.activeDays).toBe(2);
    expect(a.window.spanDays).toBe(2);
    expect(a.streaks.longestActiveDays).toBe(2);
    expect(a.streaks.busiestDate?.date).toBe('2024-08-01');
  });

  it('handles an empty chat without throwing', () => {
    const empty = analyze([]);
    expect(empty.totals.messages).toBe(0);
    expect(empty.participants).toEqual([]);
    expect(empty.streaks.busiestDate).toBeNull();
    expect(empty.window.activeDays).toBe(0);
  });
});
