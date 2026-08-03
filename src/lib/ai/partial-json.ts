/**
 * Repair a truncated JSON document so a stream can be rendered as it arrives.
 *
 * Structured output arrives as a single JSON text streamed token by token. The
 * naive options are both bad: wait for the whole document and the UI sits blank
 * for the length of the run, or render raw JSON at the user. Instead, close the
 * open containers on every chunk, parse the result, and render whatever fields
 * are complete so far.
 *
 * The repair is deliberately conservative — it only ever *removes* an
 * incomplete trailing value and *closes* what is open. It never guesses at
 * content, so a field that appears is a field the model actually emitted.
 */

/** Give up rather than loop: each attempt drops one more trailing token. */
const MAX_TRIM_ATTEMPTS = 12;

interface ScanState {
  /** Open containers, innermost last. */
  stack: Array<'{' | '['>;
  /** Index where the currently open string began, or -1. */
  openStringStart: number;
}

function scan(text: string): ScanState {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escaped = false;
  let openStringStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        openStringStart = -1;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      openStringStart = i;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    }
  }

  return { stack, openStringStart: inString ? openStringStart : -1 };
}

/** Close whatever is open, in reverse order. */
function closeContainers(text: string, stack: Array<'{' | '['>): string {
  let out = text;
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/**
 * Drop the trailing fragment: an unterminated string, a half-written number or
 * literal, a dangling `key:` or a trailing comma.
 */
function trimTail(text: string): string {
  let out = text.trimEnd();
  if (out.length === 0) return out;

  const last = out.at(-1);
  if (last === ',' || last === ':') return out.slice(0, -1).trimEnd();

  // Walk back to the nearest structural boundary and drop what follows.
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i];
    if (ch === ',' || ch === '{' || ch === '[' || ch === ':') {
      out = out.slice(0, i);
      return ch === ',' || ch === ':' ? out.trimEnd() : out.trimEnd() + ch;
    }
  }
  return '';
}

/**
 * Parse as much of a partial JSON document as is currently valid.
 *
 * Yields `{}` once the document has opened but holds no complete field yet, and
 * `null` only for an empty or wholly unsalvageable buffer. Output grows
 * monotonically as the buffer grows — a field that appears never disappears —
 * which is what lets the UI render straight from it without flickering.
 */
export function parsePartialJson<T = unknown>(buffer: string): T | null {
  const trimmed = buffer.trim();
  if (trimmed.length === 0) return null;

  let candidate = trimmed;

  for (let attempt = 0; attempt < MAX_TRIM_ATTEMPTS; attempt++) {
    const { stack, openStringStart } = scan(candidate);

    // An unterminated string cannot be closed safely when it is an object key
    // awaiting a value, so cut it out entirely and let the trim loop settle.
    let repaired = openStringStart >= 0 ? candidate.slice(0, openStringStart) : candidate;
    repaired = repaired.trimEnd();
    if (repaired.endsWith(',') || repaired.endsWith(':')) repaired = repaired.slice(0, -1).trimEnd();

    const closed = closeContainers(repaired, openStringStart >= 0 ? scan(repaired).stack : stack);

    try {
      return JSON.parse(closed) as T;
    } catch {
      const shorter = trimTail(candidate);
      if (shorter === candidate || shorter.length === 0) return null;
      candidate = shorter;
    }
  }

  return null;
}
