/**
 * WhatsApp export normalisation.
 *
 * Real exports are messier than the format docs suggest. The bytes that break
 * naive regexes, in the order they bite:
 *
 *  - A UTF-8 BOM on the first line, so the first message never matches `^`.
 *  - CRLF on Windows-exported files.
 *  - LEFT-TO-RIGHT MARK (U+200E) injected before `[` and around attachment
 *    markers. Invisible, but a `^\[` anchor sees it and fails.
 *  - NARROW NO-BREAK SPACE (U+202F) between the time and `AM`/`PM`. WhatsApp
 *    switched to this in 2023; every parser written before then broke silently.
 *
 * The control characters are declared as numeric code points and compiled into
 * character classes at module load. Pasting the raw characters into a regex
 * literal would work, but leaves invisible bytes in the source that no reviewer
 * can see and that editors love to mangle.
 */

const charClass = (codePoints: readonly number[]): string =>
  `[${codePoints.map((cp) => String.fromCodePoint(cp)).join('')}]`;

/** U+FEFF byte-order mark, only meaningful at position 0. */
const BOM = new RegExp(`^${String.fromCodePoint(0xfeff)}`);

/**
 * Bidi controls WhatsApp injects around timestamps and attachment markers:
 * LRM, RLM, ALM, and the four isolate controls (LRI/RLI/FSI/PDI).
 */
const BIDI_MARKS = new RegExp(
  charClass([0x200e, 0x200f, 0x061c, 0x2066, 0x2067, 0x2068, 0x2069]),
  'g',
);

/**
 * Space variants that show up between the clock time and the AM/PM marker:
 * NARROW NO-BREAK, NO-BREAK, FIGURE and THIN space.
 */
const EXOTIC_SPACES = new RegExp(charClass([0x202f, 0x00a0, 0x2007, 0x2009]), 'g');

/**
 * Make an export byte-predictable before any pattern matching happens.
 * Idempotent: normalising already-normalised text is a no-op.
 */
export function normalize(raw: string): string {
  return raw
    .replace(BOM, '')
    .replace(/\r\n?/g, '\n')
    .replace(BIDI_MARKS, '')
    .replace(EXOTIC_SPACES, ' ');
}
