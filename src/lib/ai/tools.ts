import type { Digest } from '@/lib/digest';

/**
 * Tools the model uses to query the digest.
 *
 * The point is context economy, not capability. The overview in the prompt is a
 * few hundred tokens; the full digest with hourly grids, ranked vocabulary and
 * samples is several thousand. Pasting all of it in every request would pay for
 * detail most runs never look at. Instead the model pulls what a specific
 * finding needs.
 *
 * Every tool reads from the digest already in memory for this request. There is
 * no I/O, nothing is persisted, and nothing outside the digest is reachable.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_activity_profile',
    description:
      'Hour-of-day, day-of-week and month-by-month message distributions. Use this before making any claim about timing, rhythm, or how activity changed over the window.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        breakdown: {
          type: 'string',
          enum: ['hour', 'weekday', 'month'],
          description: 'Which distribution to return.',
        },
      },
      required: ['breakdown'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_participant_detail',
    description:
      'Every recorded metric for one participant, including media, link and emoji counts and their most-used emoji. Use this before characterising an individual.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        alias: {
          type: 'string',
          description: 'Participant alias exactly as given in the overview, e.g. "P1".',
        },
      },
      required: ['alias'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_vocabulary',
    description:
      'Ranked terms, emoji or link domains. Use this for claims about what the conversation is about or how it sounds.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['terms', 'emoji', 'domains'],
          description: 'Which ranking to return.',
        },
        limit: {
          type: 'integer',
          enum: [5, 10, 15, 20, 25],
          description: 'How many entries to return.',
        },
      },
      required: ['kind', 'limit'],
      additionalProperties: false,
    },
  },
];

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

const ok = (content: string): ToolResult => ({ content, isError: false });
const fail = (content: string): ToolResult => ({ content, isError: true });

/**
 * Render an untrusted tool argument for an error message.
 *
 * Tool inputs are model-generated, so a field declared as a string can arrive
 * as an object. Interpolating that directly yields "[object Object]", which
 * tells the model nothing about what it got wrong.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function activityProfile(digest: Digest, input: Record<string, unknown>): ToolResult {
  switch (input.breakdown) {
    case 'hour':
      return ok(
        'Messages by hour of day (local time):\n' +
          digest.activity.byHour
            .map((count, hour) => `${String(hour).padStart(2, '0')}:00  ${count}`)
            .join('\n'),
      );
    case 'weekday':
      return ok(
        'Messages by day of week:\n' +
          digest.activity.byWeekday.map((count, i) => `${WEEKDAYS[i]}  ${count}`).join('\n'),
      );
    case 'month':
      return ok(
        'Messages by month:\n' +
          digest.activity.byMonth.map((m) => `${m.month}  ${m.count}`).join('\n'),
      );
    default:
      return fail(
        `Unknown breakdown "${asText(input.breakdown)}". Use hour, weekday or month.`,
      );
  }
}

function participantDetail(digest: Digest, input: Record<string, unknown>): ToolResult {
  const alias = asText(input.alias);
  const p = digest.participants.find((x) => x.alias === alias);
  if (!p) {
    return fail(
      `No participant "${alias}". Known aliases: ${digest.participants.map((x) => x.alias).join(', ')}.`,
    );
  }

  const replyTime = p.medianReplyMinutes === null ? 'not enough data' : `${p.medianReplyMinutes} min`;
  const emoji = p.topEmoji.length > 0 ? p.topEmoji.join(' ') : 'none';

  return ok(
    [
      `Participant ${p.alias}`,
      `messages: ${p.messages} (${p.sharePct}% of all messages)`,
      `average words per message: ${p.averageWords}`,
      `median reply time: ${replyTime}`,
      `conversations started: ${p.conversationsStarted}`,
      `media sent: ${p.media}`,
      `links sent: ${p.links}`,
      `emoji used: ${p.emoji}`,
      `most-used emoji: ${emoji}`,
    ].join('\n'),
  );
}

function vocabulary(digest: Digest, input: Record<string, unknown>): ToolResult {
  const kind = asText(input.kind);
  const limit = Number(input.limit);
  if (!Number.isFinite(limit) || limit <= 0) return fail('limit must be a positive integer.');

  const rankings: Record<string, Digest['vocabulary']['topTerms']> = {
    terms: digest.vocabulary.topTerms,
    emoji: digest.vocabulary.topEmoji,
    domains: digest.vocabulary.topDomains,
  };
  const source = rankings[kind];
  if (!source) return fail(`Unknown kind "${kind}". Use terms, emoji or domains.`);
  if (source.length === 0) return ok(`No ${kind} recorded.`);

  return ok(
    `Top ${kind}:\n` +
      source
        .slice(0, limit)
        .map((e, i) => `${i + 1}. ${e.value} (${e.count})`)
        .join('\n'),
  );
}

const HANDLERS: Record<string, (d: Digest, input: Record<string, unknown>) => ToolResult> = {
  get_activity_profile: activityProfile,
  get_participant_detail: participantDetail,
  get_vocabulary: vocabulary,
};

/**
 * Execute a tool against this request's digest.
 *
 * Unknown tools and bad arguments come back as error results rather than thrown
 * exceptions, so the model can correct itself instead of the run dying.
 */
export function executeTool(digest: Digest, call: ToolCall): ToolResult {
  const handler = HANDLERS[call.name];
  if (!handler) return fail(`Unknown tool "${call.name}".`);
  return handler(digest, call.input ?? {});
}
