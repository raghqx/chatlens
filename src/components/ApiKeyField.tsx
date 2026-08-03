'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'chatlens.apiKey';

/** Anthropic keys start with this. Anything else in the field is a mistake. */
const ANTHROPIC_PREFIX = 'sk-ant-';
/** Groq keys start with this, and belong in the server's env, not this field. */
const GROQ_PREFIX = 'gsk_';

/**
 * The API key lives in `sessionStorage`, not `localStorage`.
 *
 * That is the right lifetime for a credential someone pasted into a site they
 * do not own: it disappears when the tab closes. It is sent as a bearer token
 * on the insights request and is never persisted server-side.
 *
 * `sessionStorage` is an external store, so it is read through
 * `useSyncExternalStore` rather than an effect. That is what keeps server
 * render (no storage, empty string) and client hydration consistent instead of
 * flashing an empty field and then filling it in.
 */
let cached: string | null = null;
const listeners = new Set<() => void>();

function readStorage(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    // Private browsing can deny storage access; an in-memory key still works.
    return '';
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): string {
  cached ??= readStorage();
  return cached;
}

/** Storage does not exist during server render, so the key starts empty. */
const getServerSnapshot = (): string => '';

function writeStorage(next: string): void {
  cached = next;
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, next);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: the in-memory value is still usable for this session.
  }
  for (const listener of listeners) listener();
}

export function useApiKey() {
  const apiKey = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setApiKey = useCallback((next: string) => writeStorage(next), []);
  return { apiKey, setApiKey };
}

/**
 * Catch a key pasted into the wrong field before it becomes a 401.
 *
 * This is a real mistake and not a hypothetical one: the project uses a Groq
 * key for its free tier, so someone who has just set that up has exactly one
 * key in their clipboard and an obvious-looking box to put it in.
 */
function diagnose(apiKey: string): string | null {
  if (apiKey.length === 0) return null;
  if (apiKey.startsWith(GROQ_PREFIX)) {
    return 'That is a Groq key. Groq powers the free tier from the server, so it does not go here — clear this field and press Generate free. This box only takes an Anthropic key.';
  }
  if (!apiKey.startsWith(ANTHROPIC_PREFIX)) {
    return `Anthropic keys start with "${ANTHROPIC_PREFIX}". Clear the field to use the free tier instead.`;
  }
  return null;
}

export function ApiKeyField({
  apiKey,
  onChange,
}: {
  apiKey: string;
  onChange: (next: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const problem = diagnose(apiKey);

  return (
    <div>
      <label htmlFor="api-key" className="mb-1.5 flex items-baseline gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">Anthropic API key</span>
        <span className="text-[var(--text-muted)]">optional</span>
      </label>

      <div className="flex gap-2">
        <input
          id="api-key"
          type={visible ? 'text' : 'password'}
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder="Leave empty to use the free tier"
          aria-invalid={problem !== null}
          aria-describedby="api-key-help"
          onChange={(e) => onChange(e.target.value.trim())}
          className={`min-w-0 flex-1 rounded-lg border bg-[var(--surface-2)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:font-sans placeholder:text-[var(--text-muted)] ${
            problem ? 'border-[var(--warning)]' : 'border-[var(--border)]'
          }`}
        />
        {apiKey.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {problem && <p className="mt-1.5 text-[11px] text-[var(--warning)]">{problem}</p>}

      <p id="api-key-help" className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        {apiKey.length > 0 ? (
          <>
            Kept in this tab&rsquo;s session storage and sent only with the insights request. Never
            written to a server.
          </>
        ) : (
          <>
            Without a key the reading runs on a shared free tier, which is rate-limited and uses a
            smaller model. Add your own key for Claude Opus 5 with streaming and tool use.{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              Get a key
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}
