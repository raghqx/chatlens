/**
 * Timestamp header patterns for the two WhatsApp export layouts.
 *
 * iOS wraps the stamp in brackets:      [03/08/2024, 9:41:03 AM] Alice: hi
 * Android uses a trailing dash:          03/08/2024, 9:41 am - Alice: hi
 *
 * Both accept `/`, `.` or `-` as the date separator, 2- or 4-digit years,
 * optional seconds, and 12- or 24-hour clocks. The separator is back-referenced
 * so `03/08.2024` cannot match.
 */

/** `03/08/2024`, `3.8.24`, `2024-08-03`. Separator must be consistent. */
const DATE = String.raw`(?<d1>\d{1,4})(?<sep>[/.\-])(?<d2>\d{1,2})\k<sep>(?<d3>\d{2,4})`;

/** `9:41`, `09:41:03`, `9:41 AM`, `9:41:03 p.m.` */
const TIME = String.raw`(?<h>\d{1,2}):(?<mi>\d{2})(?::(?<s>\d{2}))?(?:\s*(?<ap>[ap])\.?m\.?)?`;

export const HEADERS = {
  ios: new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s?`, 'gim'),
  android: new RegExp(String.raw`^${DATE},?\s+${TIME}\s+-\s`, 'gim'),
} as const;

export interface HeaderGroups {
  d1: string;
  sep: string;
  d2: string;
  d3: string;
  h: string;
  mi: string;
  s?: string;
  ap?: string;
}

/**
 * A message body split into `author: text`.
 *
 * The author is capped at 100 characters and may not contain a colon or a
 * newline, which keeps most system notices (`Alice created group "x"`) from
 * being mistaken for a speaker. Notices that *do* contain a colon are filtered
 * out downstream by frequency — see `parse`.
 */
export const AUTHOR_SPLIT = /^([^:\n]{1,100}): ([\s\S]*)$/;

/** `<Media omitted>`, `image omitted`, `sticker omitted`, `IMG-0001.jpg (file attached)`. */
export const MEDIA = /(?:^|\s)(?:<?[\w ]*media omitted>?|\w+ omitted)|\(file attached\)$|^<attached:/i;

/** Both the "deleted by sender" and "deleted by you" variants. */
export const DELETED = /this message was deleted|you deleted this message/i;
