/**
 * Text extraction primitives: words, emoji, links.
 *
 * All Unicode-aware. A chat analyser that splits on `/\s+/` and counts emoji
 * per UTF-16 code unit will report a family emoji as seven separate "emoji" and
 * drop every non-Latin word.
 */

/** Anything that is not a letter, number or intra-word apostrophe is a boundary. */
const WORD_BOUNDARY = /[^\p{L}\p{N}'’]+/u;

/** Matches bare pictographic code points; combined with grapheme segmentation below. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Named `_PATTERN` deliberately: a bare `URL` would shadow the global constructor. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/**
 * Split a message into lowercased word tokens.
 *
 * Keeps apostrophes so "don't" stays one token, and strips them at the edges so
 * a quoted 'word' does not become a distinct term.
 */
const APOSTROPHES = new Set(["'", '’']);

/** Linear edge trim; the regex form `/^'+|'+$/` backtracks on long runs. */
function trimApostrophes(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && APOSTROPHES.has(token[start])) start++;
  while (end > start && APOSTROPHES.has(token[end - 1])) end--;
  return token.slice(start, end);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_BOUNDARY)
    .map(trimApostrophes)
    .filter((t) => t.length > 0);
}

/** Cheap word count that does not allocate a token array per message. */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (const ch of text) {
    const isBoundary = WORD_BOUNDARY.test(ch);
    if (isBoundary) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

/**
 * Grapheme segmenter, reused across calls because construction is expensive.
 * Node 20+ and every current browser have `Intl.Segmenter`.
 */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Extract emoji as user-perceived characters.
 *
 * Segmenting by grapheme is what makes a skin-toned, gendered, ZWJ-joined emoji
 * count as one thing. Falling back to `Array.from` (code points) would split
 * those into their components and inflate every count.
 */
export function extractEmoji(text: string): string[] {
  if (!PICTOGRAPHIC.test(text)) return [];
  const units = segmenter
    ? [...segmenter.segment(text)].map((s) => s.segment)
    : Array.from(text);
  return units.filter((u) => PICTOGRAPHIC.test(u));
}

export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((m) => m[0]);
}

/**
 * Remove URLs from a message before word analysis.
 *
 * Without this, a link's path segments become "words": a Drive share URL
 * contributes `https`, `drive`, `file` and its document id to the term
 * frequencies, which is both meaningless as vocabulary and a privacy leak once
 * those terms ship in the digest. Links are already counted separately, by host.
 */
export function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, ' ');
}

/**
 * Reduce a URL to a registrable-ish host for aggregation.
 *
 * Domains are safe to aggregate and share; full URLs are not — a link often
 * carries an invite token, a document id, or a tracking parameter that
 * identifies the sender.
 */
export function urlHost(url: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}
