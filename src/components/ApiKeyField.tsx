'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

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

  return (
    <div>
      <label htmlFor="api-key" className="mb-1.5 block text-xs text-[var(--text-secondary)]">
        Anthropic API key
      </label>
      <div className="flex gap-2">
        <input
          id="api-key"
          type={visible ? 'text' : 'password'}
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-..."
          onChange={(e) => onChange(e.target.value.trim())}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        Kept in this tab&rsquo;s session storage and sent only with the insights request. Never
        written to a server.{' '}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          Get a key
        </a>
        .
      </p>
    </div>
  );
}
