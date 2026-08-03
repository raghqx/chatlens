/**
 * Redaction primitives for anything that crosses the network boundary.
 *
 * The rule this project holds to: raw message text never leaves the browser
 * unless the user explicitly opts in, and even then it is scrubbed first.
 * These functions are the only place that scrubbing is defined.
 */

/** 7+ consecutive digits, optionally grouped, optionally with a country prefix. */
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

/** Long digit runs: OTPs, account numbers, order ids. */
const LONG_NUMBER = /\b\d{5,}\b/g;

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/**
 * Replace a URL with just its host, so an invite link or a signed document URL
 * cannot be reconstructed from the digest.
 */
function hostOnly(match: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(match) ? match : `https://${match}`;
    return `[link:${new URL(withScheme).hostname.replace(/^www\./i, '')}]`;
  } catch {
    return '[link]';
  }
}

/**
 * Strip direct identifiers from a message body.
 *
 * Deliberately blunt. This runs on text the user has chosen to share as
 * evidence, so it favours over-redaction: a mangled phone number costs an
 * insight, a leaked one costs trust.
 */
export function redactText(text: string): string {
  return text
    .replace(URL_IN_TEXT, hostOnly)
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[phone]')
    .replace(LONG_NUMBER, '[number]');
}

export interface AliasMap {
  /** Real display name -> stable pseudonym (`P1`, `P2`, ...). */
  toAlias: Record<string, string>;
  /** Pseudonym -> real display name. Never serialised into a request. */
  toName: Record<string, string>;
}

/**
 * Build stable pseudonyms for participants.
 *
 * Ordered by the caller (message count, descending) so `P1` is always the most
 * active participant. The map stays in the browser; only the aliases are sent,
 * and the UI maps them back for display.
 */
export function buildAliases(names: string[]): AliasMap {
  const toAlias: Record<string, string> = {};
  const toName: Record<string, string> = {};
  names.forEach((name, i) => {
    const alias = `P${i + 1}`;
    toAlias[name] = alias;
    toName[alias] = name;
  });
  return { toAlias, toName };
}

/** Identity map, for when the user has chosen to share real names. */
export function identityAliases(names: string[]): AliasMap {
  const toAlias: Record<string, string> = {};
  const toName: Record<string, string> = {};
  for (const name of names) {
    toAlias[name] = name;
    toName[name] = name;
  }
  return { toAlias, toName };
}
