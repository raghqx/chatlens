'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Light/dark mode.
 *
 * Light is the default for everyone, including visitors whose OS is set to
 * dark. That is a deliberate product choice rather than an oversight: this app
 * is a document you read, and the charts were stepped against the light surface
 * first. The dark palette is a selected second set, not an inversion.
 *
 * The choice persists in `localStorage` (unlike the API key, which is
 * deliberately session-scoped — a theme preference is not a credential).
 *
 * Read through `useSyncExternalStore` so the server render and the first client
 * render agree; a value read from storage during render would hydrate as a
 * mismatch.
 */

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'chatlens.theme';
export const DEFAULT_THEME: ThemeMode = 'light';

/**
 * Runs before first paint, inlined into the document head.
 *
 * Without this the page paints light, then swaps to dark once React hydrates —
 * a white flash on every load for anyone who chose dark. Kept as a single
 * string so it stays small and has no dependencies.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){}`;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): ThemeMode {
  // The pre-paint script already resolved this onto the document, so read it
  // back rather than touching storage again.
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : DEFAULT_THEME;
}

const getServerSnapshot = (): ThemeMode => DEFAULT_THEME;

function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be denied; the theme still applies for this page view.
  }
  for (const listener of listeners) listener();
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((next: ThemeMode) => applyTheme(next), []);
  const toggle = useCallback(() => applyTheme(getSnapshot() === 'dark' ? 'light' : 'dark'), []);
  return { mode, setMode, toggle };
}
