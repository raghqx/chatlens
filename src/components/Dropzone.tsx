'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { extractTranscript, ZipError } from '@/lib/zip';

/** Guard against someone dropping a video: the parser only ever wants text. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

type Platform = 'ios' | 'android' | 'desktop';

/**
 * Guess the platform to show the right export steps first.
 *
 * Read through `useSyncExternalStore` rather than during render: the server has
 * no `navigator`, so detecting inline would render "desktop" on the server and
 * "ios" on an iPhone at hydration, which is a mismatch. The server snapshot is
 * the neutral default and the client corrects it after mount.
 *
 * Every instruction set stays reachable by tab, so a wrong guess costs one
 * click rather than blocking anyone.
 */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** The value never changes after load, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};
const serverPlatform = (): Platform => 'desktop';

const STEPS: Record<Platform, { label: string; steps: string[] }> = {
  ios: {
    label: 'iPhone',
    steps: [
      'Open the chat, then tap the contact or group name at the top.',
      'Scroll down and tap Export Chat.',
      'Choose Without Media.',
      'In the share sheet, choose Save to Files.',
      'Upload the .zip you just saved — no need to unzip it.',
    ],
  },
  android: {
    label: 'Android',
    steps: [
      'Open the chat, then tap the three dots at the top right.',
      'Tap More, then Export chat.',
      'Choose Without media.',
      'Save it to Files or Drive, then upload the .txt.',
    ],
  },
  desktop: {
    label: 'Desktop',
    steps: [
      'Chat export is only available in the phone app, not WhatsApp Web.',
      'Export on your phone (Without media), send it to yourself, then upload it here.',
    ],
  },
};

export function Dropzone({
  onFile,
  busy,
}: {
  onFile: (name: string, text: string) => void;
  busy: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [chosen, setChosen] = useState<Platform | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const detected = useSyncExternalStore(noopSubscribe, detectPlatform, serverPlatform);
  const active = chosen ?? detected;
  const guidance = useMemo(() => STEPS[active], [active]);

  const accept = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      if (file.size > MAX_FILE_BYTES) {
        setError('That file is over 200 MB. Export the chat again without media.');
        return;
      }

      setReading(true);
      try {
        const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
        // iOS exports arrive as a .zip holding _chat.txt, so open it here
        // rather than sending the user away to unzip it themselves.
        const text = isZip ? await extractTranscript(await file.arrayBuffer()) : await file.text();
        onFile(file.name, text);
      } catch (cause) {
        setError(
          cause instanceof ZipError
            ? cause.message
            : 'Could not read that file. Make sure it is the .txt or .zip WhatsApp exported.',
        );
      } finally {
        setReading(false);
      }
    },
    [onFile],
  );

  /**
   * Load the bundled sample export.
   *
   * A visitor evaluating this app almost certainly will not export their own
   * chat just to look around, and a dashboard they cannot see is a dashboard
   * that does not exist. The sample is synthetic, generated from a seeded PRNG,
   * and is the same fixture the eval suite runs against.
   */
  const loadSample = useCallback(async () => {
    setError(null);
    setReading(true);
    try {
      const response = await fetch('/sample-chat.txt');
      if (!response.ok) throw new Error('missing');
      onFile('sample-chat.txt', await response.text());
    } catch {
      setError('Could not load the sample chat.');
    } finally {
      setReading(false);
    }
  }, [onFile]);

  const working = busy || reading;

  return (
    <div>
      <button
        type="button"
        disabled={working}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files[0]);
        }}
        className={`w-full rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging
            ? 'border-[var(--series-1)] bg-[var(--surface-1)]'
            : 'border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--axis)]'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="block text-sm font-medium text-[var(--text-primary)]">
          {working ? 'Reading your chat...' : 'Drop your exported chat here'}
        </span>
        <span className="mt-1 block text-xs text-[var(--text-secondary)]">
          .txt or .zip &middot; click to choose a file &middot; nothing is uploaded
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".txt,.zip,text/plain,application/zip"
        className="hidden"
        onChange={(e) => void accept(e.target.files?.[0])}
      />

      <div className="mt-3 flex items-center justify-center">
        <button
          type="button"
          disabled={working}
          onClick={() => void loadSample()}
          className="text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          Or try it with a sample chat
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-[var(--critical)]">{error}</p>}

      <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-[var(--text-primary)]">
            How to export a chat
          </h2>
          <div className="flex gap-1">
            {(Object.keys(STEPS) as Platform[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setChosen(key)}
                aria-pressed={active === key}
                className={`rounded-md px-2 py-1 text-[11px] ${
                  active === key
                    ? 'bg-[var(--surface-2)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {STEPS[key].label}
              </button>
            ))}
          </div>
        </div>

        <ol className="mt-3 list-inside list-decimal space-y-1 text-xs text-[var(--text-secondary)]">
          {guidance.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="mt-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
          WhatsApp caps an export at roughly 40,000 messages without media. Longer chats are
          truncated to the most recent messages, and it does not warn you.
        </p>
      </div>
    </div>
  );
}
