import type { Metadata, Viewport } from 'next';
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from '@/lib/theme-mode';
import './globals.css';

/**
 * No web fonts. The palette guidance keeps everything in the system sans, and
 * dropping the font request removes a render-blocking round trip on a page
 * whose whole point is that it does not phone home.
 */
export const metadata: Metadata = {
  title: 'chatlens - private conversation intelligence',
  description:
    'Analyse a WhatsApp chat export entirely in your browser. Nothing is uploaded. Optional AI reading runs on your own Anthropic key over anonymised aggregates.',
  applicationName: 'chatlens',
  authors: [{ name: 'Raghav Singhal' }],
  robots: { index: true, follow: true },
  openGraph: {
    title: 'chatlens',
    description:
      'Private conversation intelligence for WhatsApp exports. Parsing and analytics run in the browser; the AI layer is opt-in and bring-your-own-key.',
    type: 'website',
  },
};

/** Matches the light surface, since light is the default the page renders in. */
export const viewport: Viewport = {
  themeColor: '#f9f9f7',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full" data-theme={DEFAULT_THEME}>
      <head>
        {/*
         * Resolve the stored theme before first paint. Rendered as a raw script
         * rather than next/script so it is inline and blocking: deferring it by
         * even one frame is exactly the white flash it exists to prevent.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
