'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { detectKeyProvider, PROVIDER_SUMMARY } from '@/lib/ai/providers/detect';

const STORAGE_KEY = 'chatlens.apiKey';

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


export function ApiKeyField({
  apiKey,
  onChange,
}: {
  apiKey: string;
  onChange: (next: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const provider = detectKeyProvider(apiKey);
  const unrecognised = provider === 'unknown';

  return (
    <div>
      <label htmlFor="api-key" className="mb-1.5 flex items-baseline gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">API key</span>
        <span className="text-[var(--text-muted)]">optional &middot; Anthropic or Groq</span>
      </label>

      <div className="flex gap-2">
        <input
          id="api-key"
          type={visible ? 'text' : 'password'}
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-... or gsk_... - or leave empty for the free tier"
          aria-invalid={unrecognised}
          aria-describedby="api-key-help"
          onChange={(e) => onChange(e.target.value.trim())}
          className={`min-w-0 flex-1 rounded-lg border bg-[var(--surface-2)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:font-sans placeholder:text-[var(--text-muted)] ${
            unrecognised ? 'border-[var(--warning)]' : 'border-[var(--border)]'
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

      {unrecognised && (
        <p className="mt-1.5 text-[11px] text-[var(--warning)]">
          Not a key we recognise. Anthropic keys start with <code>sk-ant-</code>, Groq keys with{' '}
          <code>gsk_</code>. Clear the field to use the free tier.
        </p>
      )}

      <p id="api-key-help" className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        {!unrecognised && <>Will use: {PROVIDER_SUMMARY[provider]} </>}
        {apiKey.length > 0 ? (
          <>Kept in this tab&rsquo;s session storage, sent only with this request, never stored.</>
        ) : (
          <>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              Free Groq key
            </a>
            {' or an '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              Anthropic key
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}
