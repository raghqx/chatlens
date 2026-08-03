/**
 * Work out which backend a key belongs to, from the key itself.
 *
 * Shared by the browser and the route so the label a user reads and the
 * decision the server makes can never disagree. Both vendors use a stable,
 * documented prefix, so this needs no network call and no configuration.
 *
 * The alternative — a provider dropdown next to the key field — asks the user
 * to tell us something the key already says.
 */

export type KeyProvider = 'anthropic' | 'groq' | 'none' | 'unknown';

const PREFIXES: Array<{ prefix: string; provider: 'anthropic' | 'groq' }> = [
  { prefix: 'sk-ant-', provider: 'anthropic' },
  { prefix: 'gsk_', provider: 'groq' },
];

export function detectKeyProvider(key: string | null | undefined): KeyProvider {
  const trimmed = key?.trim() ?? '';
  if (trimmed.length === 0) return 'none';
  return PREFIXES.find((p) => trimmed.startsWith(p.prefix))?.provider ?? 'unknown';
}

/** What the user gets for a given key, in one line. Used for UI copy. */
export const PROVIDER_SUMMARY: Record<KeyProvider, string> = {
  anthropic: 'Claude Opus 5 on your key, with streaming and tool use.',
  groq: 'Groq on your key, so you are not sharing the free tier limits.',
  none: 'The shared free tier, which is rate-limited across all visitors.',
  unknown: '',
};
