import type { ChatMessage } from '../parser';
import { isMeaningfulTerm } from './stopwords';
import { countWords, extractEmoji, extractUrls, stripUrls, tokenize, urlHost } from './text';

/**
 * Silence longer than this ends a conversation. Six hours separates "we kept
 * talking" from "we picked it up the next morning" without splitting a normal
 * evening thread in two.
 */
export const CONVERSATION_GAP_MINUTES = 360;

/**
 * A reply gap longer than this is not a reply — it is a new conversation that
 * happens to follow someone else's message. Including overnight gaps would make
 * every median response time meaningless.
 */
export const MAX_REPLY_GAP_MINUTES = 720;

const TOP_N = 25;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface Counted<T = string> {
  value: T;
  count: number;
}

export interface ParticipantStats {
  name: string;
  messages: number;
  words: number;
  characters: number;
  media: number;
  links: number;
  emoji: number;
  /** Fraction of all non-system messages, 0..1. */
  share: number;
  averageWords: number;
  firstAt: number;
  lastAt: number;
  /** Median minutes to answer someone else, or null with too few samples. */
  medianReplyMinutes: number | null;
  /** Times this participant opened a conversation after a long silence. */
  conversationsStarted: number;
  topEmoji: Counted[];
}

export interface Analysis {
  window: { from: number; to: number; spanDays: number; activeDays: number };
  totals: {
    messages: number;
    words: number;
    characters: number;
    media: number;
    links: number;
    emoji: number;
    system: number;
    deleted: number;
  };
  participants: ParticipantStats[];
  activity: {
    byHour: number[];
    byWeekday: number[];
    /** `[weekday][hour]`, weekday 0 = Sunday. The heatmap reads straight off this. */
    byHourWeekday: number[][];
    byMonth: Array<{ month: string; count: number }>;
    byDate: Array<{ date: string; count: number }>;
  };
  streaks: {
    longestActiveDays: number;
    longestSilenceDays: number;
    busiestDate: { date: string; count: number } | null;
  };
  conversations: {
    count: number;
    medianMessages: number;
    medianDurationMinutes: number;
    starters: Counted[];
  };
  vocabulary: {
    topTerms: Counted[];
    topEmoji: Counted[];
    topDomains: Counted[];
    uniqueTerms: number;
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function topN<T>(counts: Map<T, number>, n = TOP_N): Counted<T>[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function bump<T>(map: Map<T, number>, key: T, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Local-time `YYYY-MM-DD`. Local, because "which day was this" is a local question. */
function dateKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnight-to-midnight distance in whole days, immune to DST shifts. */
function daysBetween(aKey: string, bKey: string): number {
  const [ay, am, ad] = aKey.split('-').map(Number);
  const [by, bm, bd] = bKey.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

interface Accumulator {
  messages: number;
  words: number;
  characters: number;
  media: number;
  links: number;
  emoji: number;
  firstAt: number;
  lastAt: number;
  replyGaps: number[];
  conversationsStarted: number;
  emojiCounts: Map<string, number>;
}

const newAccumulator = (): Accumulator => ({
  messages: 0,
  words: 0,
  characters: 0,
  media: 0,
  links: 0,
  emoji: 0,
  firstAt: Number.POSITIVE_INFINITY,
  lastAt: Number.NEGATIVE_INFINITY,
  replyGaps: [],
  conversationsStarted: 0,
  emojiCounts: new Map(),
});

/**
 * Compute every deterministic metric in a single pass over the messages.
 *
 * Pure: same input, same output, no clock and no network. That is what makes
 * the eval suite able to assert exact numbers, and what lets this run inside a
 * Web Worker with the chat never leaving the device.
 */
export function analyze(messages: ChatMessage[]): Analysis {
  const spoken = messages.filter((m) => m.author !== null);

  const perAuthor = new Map<string, Accumulator>();
  const termCounts = new Map<string, number>();
  const emojiCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const dateCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const starterCounts = new Map<string, number>();

  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const byHourWeekday = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  const totals = {
    messages: spoken.length,
    words: 0,
    characters: 0,
    media: 0,
    links: 0,
    emoji: 0,
    system: messages.length - spoken.length,
    deleted: 0,
  };

  const conversationLengths: number[] = [];
  const conversationDurations: number[] = [];
  let currentLength = 0;
  let currentStart = 0;
  let previous: ChatMessage | null = null;

  for (const message of spoken) {
    const author = message.author as string;
    const stats = perAuthor.get(author) ?? newAccumulator();
    perAuthor.set(author, stats);

    const gapMinutes = previous ? (message.at - previous.at) / MS_PER_MINUTE : Number.POSITIVE_INFINITY;

    // Conversation segmentation.
    if (gapMinutes > CONVERSATION_GAP_MINUTES) {
      if (previous) {
        conversationLengths.push(currentLength);
        conversationDurations.push((previous.at - currentStart) / MS_PER_MINUTE);
      }
      currentLength = 0;
      currentStart = message.at;
      stats.conversationsStarted++;
      bump(starterCounts, author);
    }
    currentLength++;

    // Reply latency: only when answering a different person, within the cutoff.
    if (previous && previous.author !== author && gapMinutes <= MAX_REPLY_GAP_MINUTES) {
      stats.replyGaps.push(gapMinutes);
    }

    stats.messages++;
    stats.firstAt = Math.min(stats.firstAt, message.at);
    stats.lastAt = Math.max(stats.lastAt, message.at);

    if (message.kind === 'media') {
      stats.media++;
      totals.media++;
    } else if (message.kind === 'deleted') {
      totals.deleted++;
    } else {
      const words = countWords(message.text);
      stats.words += words;
      stats.characters += message.text.length;
      totals.words += words;
      totals.characters += message.text.length;

      // Strip links first: their path segments are not vocabulary, and they
      // can carry secrets that would then ship inside `topTerms`.
      for (const term of tokenize(stripUrls(message.text))) {
        if (isMeaningfulTerm(term)) bump(termCounts, term);
      }
      for (const emoji of extractEmoji(message.text)) {
        stats.emoji++;
        totals.emoji++;
        bump(emojiCounts, emoji);
        bump(stats.emojiCounts, emoji);
      }
      for (const url of extractUrls(message.text)) {
        stats.links++;
        totals.links++;
        const host = urlHost(url);
        if (host) bump(domainCounts, host);
      }
    }

    const when = new Date(message.at);
    byHour[when.getHours()]++;
    byWeekday[when.getDay()]++;
    byHourWeekday[when.getDay()][when.getHours()]++;
    const key = dateKey(message.at);
    bump(dateCounts, key);
    bump(monthCounts, key.slice(0, 7));

    previous = message;
  }

  if (previous) {
    conversationLengths.push(currentLength);
    conversationDurations.push((previous.at - currentStart) / MS_PER_MINUTE);
  }

  const participants: ParticipantStats[] = [...perAuthor.entries()]
    .map(([name, a]) => ({
      name,
      messages: a.messages,
      words: a.words,
      characters: a.characters,
      media: a.media,
      links: a.links,
      emoji: a.emoji,
      share: totals.messages === 0 ? 0 : a.messages / totals.messages,
      averageWords: a.messages === 0 ? 0 : a.words / a.messages,
      firstAt: a.firstAt,
      lastAt: a.lastAt,
      medianReplyMinutes: median(a.replyGaps),
      conversationsStarted: a.conversationsStarted,
      topEmoji: topN(a.emojiCounts, 5),
    }))
    .sort((x, y) => y.messages - x.messages);

  const byDate = [...dateCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const from = spoken.length > 0 ? spoken[0].at : 0;
  const to = spoken.length > 0 ? (previous as ChatMessage).at : 0;

  return {
    window: {
      from,
      to,
      spanDays: byDate.length > 0 ? daysBetween(byDate[0].date, byDate[byDate.length - 1].date) + 1 : 0,
      activeDays: byDate.length,
    },
    totals,
    participants,
    activity: {
      byHour,
      byWeekday,
      byHourWeekday,
      byMonth: [...monthCounts.entries()]
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byDate,
    },
    streaks: computeStreaks(byDate),
    conversations: {
      count: conversationLengths.length,
      medianMessages: median(conversationLengths) ?? 0,
      medianDurationMinutes: median(conversationDurations) ?? 0,
      starters: topN(starterCounts, 10),
    },
    vocabulary: {
      topTerms: topN(termCounts),
      topEmoji: topN(emojiCounts, 15),
      topDomains: topN(domainCounts, 10),
      uniqueTerms: termCounts.size,
    },
  };
}

function computeStreaks(byDate: Array<{ date: string; count: number }>): Analysis['streaks'] {
  if (byDate.length === 0) {
    return { longestActiveDays: 0, longestSilenceDays: 0, busiestDate: null };
  }

  let longestActive = 1;
  let run = 1;
  let longestSilence = 0;
  let busiest = byDate[0];

  for (let i = 1; i < byDate.length; i++) {
    const gap = daysBetween(byDate[i - 1].date, byDate[i].date);
    if (gap === 1) {
      run++;
      longestActive = Math.max(longestActive, run);
    } else {
      run = 1;
      longestSilence = Math.max(longestSilence, gap - 1);
    }
    if (byDate[i].count > busiest.count) busiest = byDate[i];
  }

  return {
    longestActiveDays: longestActive,
    longestSilenceDays: longestSilence,
    busiestDate: { date: busiest.date, count: busiest.count },
  };
}
