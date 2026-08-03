import { normalize } from './normalize';
import { AUTHOR_SPLIT, DELETED, HEADERS, MEDIA, type HeaderGroups } from './patterns';
import type {
  ChatMessage,
  DateOrder,
  ExportFormat,
  MessageKind,
  ParseResult,
  ParseWarning,
} from './types';

export interface ParseOptions {
  /**
   * Force a day/month interpretation instead of inferring one. The UI passes
   * this when the user overrides an assumed order.
   */
  dateOrder?: DateOrder;
}

/** A raw timestamp header match plus where in the source it started. */
interface Header {
  groups: HeaderGroups;
  start: number;
  end: number;
}

/**
 * Pick the export layout by seeing which header pattern matches more often.
 *
 * Sniffing the first line is not enough: exports routinely begin with an
 * unstamped encryption banner, and a group subject containing `-` can make a
 * single iOS line look Android-shaped.
 */
function detectFormat(text: string): { format: ExportFormat; headers: Header[] } {
  const collect = (re: RegExp): Header[] =>
    [...text.matchAll(re)].map((m) => ({
      groups: m.groups as unknown as HeaderGroups,
      start: m.index,
      end: m.index + m[0].length,
    }));

  const ios = collect(HEADERS.ios);
  const android = collect(HEADERS.android);
  return ios.length >= android.length
    ? { format: 'ios', headers: ios }
    : { format: 'android', headers: android };
}

/**
 * Work out which slot of `a/b/c` holds the day.
 *
 * A day above 12 can only be a day, and a month above 12 cannot be a month, so
 * a single such date proves the order for the whole file. When no date in the
 * export exceeds 12 in either slot (a chat that only ran in the first twelve
 * days of some months), the order is genuinely undecidable from the data; we
 * fall back to day-first — WhatsApp's default everywhere except the US — and
 * flag it so the UI can offer a toggle.
 */
export function inferDateOrder(headers: Header[]): {
  order: DateOrder;
  assumed: boolean;
  warning?: ParseWarning;
} {
  if (headers.length > 0 && headers.every((h) => h.groups.d1.length === 4)) {
    return { order: 'year-first', assumed: false };
  }

  let dayFirstProven = false;
  let monthFirstProven = false;
  for (const { groups } of headers) {
    if (Number(groups.d1) > 12) dayFirstProven = true;
    if (Number(groups.d2) > 12) monthFirstProven = true;
  }

  if (dayFirstProven && monthFirstProven) {
    return {
      order: 'day-first',
      assumed: false,
      warning: {
        code: 'conflicting-date-order',
        message:
          'Dates in this export are internally inconsistent (values above 12 in both the day and month slots). Assuming day-first; some timestamps may be wrong.',
      },
    };
  }
  if (dayFirstProven) return { order: 'day-first', assumed: false };
  if (monthFirstProven) return { order: 'month-first', assumed: false };

  return {
    order: 'day-first',
    assumed: true,
    warning: {
      code: 'ambiguous-date-order',
      message:
        'No date in this export has a day above 12, so day-first vs month-first cannot be proven. Assuming day-first.',
    },
  };
}

/** Expand a 2-digit year the way WhatsApp does: 70-99 is last century. */
function expandYear(raw: string): number {
  const y = Number(raw);
  if (raw.length === 4) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Build epoch milliseconds from a header, in the *local* zone.
 *
 * Exports carry no zone offset — the times are whatever the exporting phone's
 * clock read. Interpreting them locally is the only self-consistent choice, and
 * it keeps "messages after midnight" meaning what the reader expects.
 */
/** Map the three numeric date slots onto [year, month, day] for a given order. */
function orderDateParts(groups: HeaderGroups, order: DateOrder): [number, number, number] {
  const { d1, d2, d3 } = groups;
  switch (order) {
    case 'year-first':
      return [expandYear(d1), Number(d2), Number(d3)];
    case 'month-first':
      return [expandYear(d3), Number(d1), Number(d2)];
    default:
      return [expandYear(d3), Number(d2), Number(d1)];
  }
}

function toEpoch(groups: HeaderGroups, order: DateOrder): number {
  const [year, month, day] = orderDateParts(groups, order);

  let hour = Number(groups.h);
  const meridiem = groups.ap?.toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;

  return new Date(year, month - 1, day, hour, Number(groups.mi), Number(groups.s ?? 0)).getTime();
}

/**
 * Drop trailing newlines without a regex.
 *
 * `/\n+$/` backtracks from every position in a long run of newlines; message
 * bodies come straight from an uploaded file, so scan linearly instead.
 */
function stripTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '\n') end--;
  return end === value.length ? value : value.slice(0, end);
}

function classify(text: string, hasAuthor: boolean): MessageKind {
  if (!hasAuthor) return 'system';
  if (DELETED.test(text)) return 'deleted';
  if (MEDIA.test(text)) return 'media';
  return 'text';
}

/**
 * Deciding whether an `x: y` split really found a speaker.
 *
 * System notices occasionally contain a colon (`Alice changed the subject to
 * "Q3: launch"`), which the split happily reads as a speaker named
 * `Alice changed the subject to "Q3`. Two independent signals rule those out:
 *
 *  1. Recurrence. Real participants speak more than once; a mangled notice
 *     produces a unique pseudo-author every time.
 *  2. Shape. A display name is short, few words, and never contains a quote
 *     mark — that is exactly what a truncated notice does contain.
 *
 * Either signal is enough. Requiring both would drop a genuine participant who
 * only ever sent one message, which is common in large groups.
 */
const MIN_AUTHOR_APPEARANCES = 2;
const MAX_NAME_CHARS = 30;
const MAX_NAME_WORDS = 5;
const QUOTE_CHARS = /["'“”‘’]/;

function isNameShaped(candidate: string): boolean {
  const name = candidate.trim();
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_CHARS &&
    name.split(/\s+/).length <= MAX_NAME_WORDS &&
    !QUOTE_CHARS.test(name)
  );
}

/**
 * Parse a WhatsApp export into structured messages.
 *
 * Pure and synchronous — no I/O, no globals. The browser runs it inside a Web
 * Worker; tests and the eval harness call it directly.
 */
export function parse(raw: string, options: ParseOptions = {}): ParseResult {
  const text = normalize(raw);
  const warnings: ParseWarning[] = [];
  const { format, headers } = detectFormat(text);

  if (headers.length === 0) {
    return {
      messages: [],
      format,
      dateOrder: options.dateOrder ?? 'day-first',
      dateOrderAssumed: options.dateOrder === undefined,
      authors: [],
      unparsedChars: text.length,
      warnings: [
        {
          code: 'no-messages',
          message:
            'No WhatsApp timestamps found. Export the chat as a .txt file ("Export chat" > "Without media") and upload that.',
        },
      ],
    };
  }

  const inferred = inferDateOrder(headers);
  const dateOrder = options.dateOrder ?? inferred.order;
  const dateOrderAssumed = options.dateOrder === undefined && inferred.assumed;
  if (options.dateOrder === undefined && inferred.warning) warnings.push(inferred.warning);

  // Pass 1: slice bodies and tentatively split author from text.
  const draft = headers.map((header, i) => {
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].start : text.length;
    const body = stripTrailingNewlines(text.slice(header.end, bodyEnd));
    const split = AUTHOR_SPLIT.exec(body);
    return {
      at: toEpoch(header.groups, dateOrder),
      candidate: split?.[1] ?? null,
      text: split ? split[2] : body,
      fullBody: body,
    };
  });

  // Pass 2: accept a candidate that either recurs or is name-shaped.
  const appearances = new Map<string, number>();
  for (const d of draft) {
    if (d.candidate) appearances.set(d.candidate, (appearances.get(d.candidate) ?? 0) + 1);
  }
  const isAuthor = (name: string) =>
    (appearances.get(name) ?? 0) >= MIN_AUTHOR_APPEARANCES || isNameShaped(name);

  const authors: string[] = [];
  const seen = new Set<string>();
  const messages: ChatMessage[] = draft.map((d) => {
    const author = d.candidate && isAuthor(d.candidate) ? d.candidate : null;
    const body = author ? d.text : d.fullBody;
    if (author && !seen.has(author)) {
      seen.add(author);
      authors.push(author);
    }
    return { at: d.at, author, text: body, kind: classify(body, author !== null) };
  });

  const unparsedChars = headers[0].start;
  if (unparsedChars > 200) {
    warnings.push({
      code: 'unparsed-lines',
      message: `${unparsedChars} characters before the first timestamp were ignored.`,
    });
  }

  const droppedAuthors = [...appearances.keys()].filter((n) => !isAuthor(n)).length;
  if (droppedAuthors > 0) {
    warnings.push({
      code: 'single-message-authors',
      message: `${droppedAuthors} line(s) looked like a speaker but appeared only once; treated as system notices.`,
    });
  }

  return {
    messages,
    format,
    dateOrder,
    dateOrderAssumed,
    authors,
    unparsedChars,
    warnings,
  };
}
