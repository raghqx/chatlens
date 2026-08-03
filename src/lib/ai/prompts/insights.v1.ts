import type { Digest } from '@/lib/digest';

/**
 * Prompt v1 for conversation insights.
 *
 * Versioned as a file rather than edited in place. Every trace records
 * `promptId`, so a run in the logs can be tied back to the exact instructions
 * that produced it, and an eval result stays attributable after the prompt
 * moves on. Changing the wording means adding `insights.v2.ts`, not editing
 * this file.
 */

export const PROMPT_ID = 'insights@1' as const;

/**
 * Stable across every request, so it sits at the front of the prefix and caches
 * cleanly. Nothing per-request (no dates, no ids, no participant names) belongs
 * in here — that would change the cached prefix on every call.
 */
export const SYSTEM = `You read aggregate statistics about a messaging conversation and explain what they show.

The data you receive is anonymised and pre-aggregated. Participants are labelled P1, P2, ... in descending order of message count. You will usually not see any message text at all; when samples are present they have been redacted.

How to work:
- Start from the overview you are given. Call the provided tools when you need detail you do not already have, rather than speculating. Do not call a tool for something already in the overview.
- Ground every claim in a number that is actually present in the data. If you cannot point to a figure, do not make the claim.
- Distinguish what the data shows from what it suggests. "P1 sends 71% of messages" is a fact; "P1 drives the relationship" is an interpretation, and should be marked as lower confidence.
- Prefer the non-obvious. That one person sent more messages is rarely worth a finding on its own; how response times differ, when the rhythm changed, or who restarts conversations after silence usually is.
- Note when a metric has more than one explanation. A long median reply time can mean disengagement or it can mean timezone offset, and the data here cannot tell them apart.

Constraints:
- Never guess at real names, locations, relationships or the subject of the conversation.
- Never present a computed number as more precise than it is.
- Write plainly. No marketing register, no hedging filler, no restating the numbers back without adding meaning.`;

/** Compact overview. Detail is fetched by tool call rather than pasted up front. */
export function buildOverview(digest: Digest): string {
  const p = digest.participants
    .map((x) => {
      const reply = x.medianReplyMinutes === null ? 'n/a' : `${x.medianReplyMinutes} min`;
      return (
        `- ${x.alias}: ${x.messages} messages (${x.sharePct}%), avg ${x.averageWords} words, ` +
        `median reply ${reply}, started ${x.conversationsStarted} conversations`
      );
    })
    .join('\n');

  const busiestHour = digest.activity.byHour.indexOf(Math.max(...digest.activity.byHour));
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const busiestWeekday = weekdayNames[digest.activity.byWeekday.indexOf(Math.max(...digest.activity.byWeekday))];

  return `Conversation digest (${digest.version})

Window: ${digest.window.from} to ${digest.window.to} (${digest.window.spanDays} days, ${digest.window.activeDays} with activity)
Totals: ${digest.totals.messages} messages, ${digest.totals.words} words, ${digest.totals.media} media, ${digest.totals.links} links, ${digest.totals.emoji} emoji, ${digest.totals.deleted} deleted
Conversations: ${digest.conversations.count} (median ${digest.conversations.medianMessages} messages over ${digest.conversations.medianDurationMinutes} min)
Streaks: longest active run ${digest.streaks.longestActiveDays} days, longest silence ${digest.streaks.longestSilenceDays} days, busiest day ${digest.streaks.busiestDate ?? 'n/a'}
Peak hour ${busiestHour}:00, busiest weekday ${busiestWeekday}
Distinct meaningful terms: ${digest.vocabulary.uniqueTerms}
${digest.samples ? `Redacted message samples are available via the sample tool (${digest.samples.length} of them).` : 'No message text was shared.'}

Participants:
${p}

Write the insights object. Use the tools first if a finding needs detail you do not have here.`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The same task with every detail inlined instead of fetched by tool call.
 *
 * The free provider cannot combine structured outputs with tool use, so on that
 * path the model gets the whole digest up front. That is affordable precisely
 * because the digest is small — around 600 tokens — which is also why the tool
 * layer on the paid path is an optimisation rather than a necessity.
 *
 * Deliberately shares `SYSTEM` with the tool path. Two prompts that drift apart
 * would mean the eval suite grades one and ships the other.
 */
export function buildInlineContext(digest: Digest): string {
  const hours = digest.activity.byHour
    .map((count, hour) => `${String(hour).padStart(2, '0')}:00 ${count}`)
    .join(', ');

  const weekdays = digest.activity.byWeekday
    .map((count, i) => `${WEEKDAY_NAMES[i]} ${count}`)
    .join(', ');

  const months = digest.activity.byMonth.map((m) => `${m.month} ${m.count}`).join(', ');

  const participants = digest.participants
    .map((x) => {
      const reply = x.medianReplyMinutes === null ? 'n/a' : `${x.medianReplyMinutes} min`;
      const favourites = x.topEmoji.length > 0 ? ` (favourites ${x.topEmoji.join(' ')})` : '';
      return (
        `- ${x.alias}: ${x.messages} messages (${x.sharePct}%), avg ${x.averageWords} words/message, ` +
        `median reply ${reply}, started ${x.conversationsStarted} conversations, ` +
        `${x.media} media, ${x.links} links, ${x.emoji} emoji${favourites}`
      );
    })
    .join('\n');

  const list = (entries: Array<{ value: string; count: number }>) =>
    entries.length > 0 ? entries.map((e) => `${e.value} (${e.count})`).join(', ') : 'none';

  const sampleLines = digest.samples?.map((s) => `${s.at} ${s.alias}: ${s.text}`).join('\n');
  const sampleBlock = sampleLines
    ? `\nREDACTED MESSAGE SAMPLES\n${sampleLines}`
    : '\nNo message text was shared.';

  return `Conversation digest (${digest.version})

WINDOW
${digest.window.from} to ${digest.window.to} - ${digest.window.spanDays} days, ${digest.window.activeDays} with activity

TOTALS
${digest.totals.messages} messages, ${digest.totals.words} words, ${digest.totals.media} media, ${digest.totals.links} links, ${digest.totals.emoji} emoji, ${digest.totals.deleted} deleted

PARTICIPANTS
${participants}

MESSAGES BY HOUR (local time)
${hours}

MESSAGES BY WEEKDAY
${weekdays}

MESSAGES BY MONTH
${months}

CONVERSATIONS
${digest.conversations.count} total, median ${digest.conversations.medianMessages} messages over ${digest.conversations.medianDurationMinutes} minutes
Opened by: ${list(digest.conversations.starters)}

STREAKS
Longest active run ${digest.streaks.longestActiveDays} days, longest silence ${digest.streaks.longestSilenceDays} days, busiest day ${digest.streaks.busiestDate ?? 'n/a'}

VOCABULARY (${digest.vocabulary.uniqueTerms} distinct meaningful terms)
Top terms: ${list(digest.vocabulary.topTerms)}
Top emoji: ${list(digest.vocabulary.topEmoji)}
Link domains: ${list(digest.vocabulary.topDomains)}
${sampleBlock}

Write the insights object. Everything you are allowed to know is above.`;
}
