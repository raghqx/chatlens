import { z } from 'zod';
import type { Analysis } from '../analytics';
import type { ChatMessage } from '../parser';
import { buildAliases, identityAliases, redactText, type AliasMap } from './redact';

/**
 * The digest is the *only* thing that ever leaves the browser.
 *
 * It is an aggregate: counts, distributions, medians. No message bodies unless
 * the user opts into samples, and even then they are redacted and pseudonymised.
 * The schema is shared by the client (which builds it) and the API route (which
 * validates it), so the privacy contract is enforced on both sides rather than
 * assumed.
 */

export const DIGEST_VERSION = 'digest@1' as const;

const countedSchema = z.object({ value: z.string(), count: z.number().int().nonnegative() });

export const digestSchema = z.object({
  version: z.literal(DIGEST_VERSION),
  window: z.object({
    from: z.string(),
    to: z.string(),
    spanDays: z.number().int().nonnegative(),
    activeDays: z.number().int().nonnegative(),
  }),
  totals: z.object({
    messages: z.number().int().nonnegative(),
    words: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    emoji: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
  }),
  participants: z.array(
    z.object({
      alias: z.string(),
      messages: z.number().int().nonnegative(),
      sharePct: z.number(),
      averageWords: z.number(),
      medianReplyMinutes: z.number().nullable(),
      conversationsStarted: z.number().int().nonnegative(),
      emoji: z.number().int().nonnegative(),
      media: z.number().int().nonnegative(),
      links: z.number().int().nonnegative(),
      topEmoji: z.array(z.string()),
    }),
  ),
  activity: z.object({
    byHour: z.array(z.number().int().nonnegative()).length(24),
    byWeekday: z.array(z.number().int().nonnegative()).length(7),
    byMonth: z.array(z.object({ month: z.string(), count: z.number().int().nonnegative() })),
  }),
  streaks: z.object({
    longestActiveDays: z.number().int().nonnegative(),
    longestSilenceDays: z.number().int().nonnegative(),
    busiestDate: z.string().nullable(),
  }),
  conversations: z.object({
    count: z.number().int().nonnegative(),
    medianMessages: z.number(),
    medianDurationMinutes: z.number(),
    starters: z.array(countedSchema),
  }),
  vocabulary: z.object({
    topTerms: z.array(countedSchema),
    topEmoji: z.array(countedSchema),
    topDomains: z.array(countedSchema),
    uniqueTerms: z.number().int().nonnegative(),
  }),
  /** Present only when the user explicitly opted into sharing sample messages. */
  samples: z
    .array(z.object({ alias: z.string(), at: z.string(), text: z.string() }))
    .optional(),
});

export type Digest = z.infer<typeof digestSchema>;

export interface BuildDigestOptions {
  /** Replace display names with `P1`, `P2`, ... Defaults to true. */
  pseudonymize?: boolean;
  /** Include a small sample of redacted message bodies. Defaults to false. */
  includeSamples?: boolean;
  /** How many sample messages to include when enabled. */
  sampleSize?: number;
}

const DEFAULT_SAMPLE_SIZE = 40;
const MAX_SAMPLE_CHARS = 240;

const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Evenly spaced sample across the whole chat.
 *
 * Taking the first N would describe only how the conversation started; a stride
 * sample gives the model coverage of the entire window at a fixed token cost.
 */
function strideSample(messages: ChatMessage[], size: number): ChatMessage[] {
  const eligible = messages.filter((m) => m.kind === 'text' && m.author && m.text.trim().length > 0);
  if (eligible.length <= size) return eligible;
  const stride = eligible.length / size;
  return Array.from({ length: size }, (_, i) => eligible[Math.floor(i * stride)]);
}

/**
 * Turn a local `Analysis` into the wire-format digest.
 *
 * Returns the alias map alongside it so the UI can render real names against
 * model output that only ever saw pseudonyms.
 */
export function buildDigest(
  analysis: Analysis,
  messages: ChatMessage[],
  options: BuildDigestOptions = {},
): { digest: Digest; aliases: AliasMap } {
  const { pseudonymize = true, includeSamples = false, sampleSize = DEFAULT_SAMPLE_SIZE } = options;

  const names = analysis.participants.map((p) => p.name);
  const aliases = pseudonymize ? buildAliases(names) : identityAliases(names);
  const alias = (name: string) => aliases.toAlias[name] ?? name;

  const digest: Digest = {
    version: DIGEST_VERSION,
    window: {
      from: analysis.window.from ? isoDay(analysis.window.from) : '',
      to: analysis.window.to ? isoDay(analysis.window.to) : '',
      spanDays: analysis.window.spanDays,
      activeDays: analysis.window.activeDays,
    },
    totals: {
      messages: analysis.totals.messages,
      words: analysis.totals.words,
      media: analysis.totals.media,
      links: analysis.totals.links,
      emoji: analysis.totals.emoji,
      deleted: analysis.totals.deleted,
    },
    participants: analysis.participants.map((p) => ({
      alias: alias(p.name),
      messages: p.messages,
      sharePct: Number((p.share * 100).toFixed(1)),
      averageWords: Number(p.averageWords.toFixed(1)),
      medianReplyMinutes:
        p.medianReplyMinutes === null ? null : Number(p.medianReplyMinutes.toFixed(1)),
      conversationsStarted: p.conversationsStarted,
      emoji: p.emoji,
      media: p.media,
      links: p.links,
      topEmoji: p.topEmoji.map((e) => e.value),
    })),
    activity: {
      byHour: analysis.activity.byHour,
      byWeekday: analysis.activity.byWeekday,
      byMonth: analysis.activity.byMonth,
    },
    streaks: {
      longestActiveDays: analysis.streaks.longestActiveDays,
      longestSilenceDays: analysis.streaks.longestSilenceDays,
      busiestDate: analysis.streaks.busiestDate?.date ?? null,
    },
    conversations: {
      count: analysis.conversations.count,
      medianMessages: Number(analysis.conversations.medianMessages.toFixed(1)),
      medianDurationMinutes: Number(analysis.conversations.medianDurationMinutes.toFixed(1)),
      starters: analysis.conversations.starters.map((s) => ({
        value: alias(s.value),
        count: s.count,
      })),
    },
    vocabulary: {
      topTerms: analysis.vocabulary.topTerms,
      topEmoji: analysis.vocabulary.topEmoji,
      topDomains: analysis.vocabulary.topDomains,
      uniqueTerms: analysis.vocabulary.uniqueTerms,
    },
  };

  if (includeSamples) {
    digest.samples = strideSample(messages, sampleSize).map((m) => ({
      alias: alias(m.author as string),
      at: new Date(m.at).toISOString(),
      text: redactText(m.text).slice(0, MAX_SAMPLE_CHARS),
    }));
  }

  return { digest, aliases };
}
