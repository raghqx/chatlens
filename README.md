# WhatsApp Chat Analyzer

Upload a WhatsApp chat export and explore conversation insights in your browser — timelines, activity maps, busiest people, word clouds, common words, and emoji breakdowns.

Built for **2026** as a **Next.js** app that deploys cleanly on **Vercel**. Chat files are parsed locally in the browser; nothing is sent to a backend.

## Why this rewrite

The original project was a **Streamlit** app with Heroku/Render-era files (`Procfile`, `setup.sh`, unpinned Python deps). Streamlit needs a long-running server and WebSockets, which **does not fit Vercel’s serverless model**.

This revival:

- Replaces Streamlit with a Vercel-ready Next.js frontend
- Ports the analysis logic to TypeScript (client-side)
- Supports common **iOS** and **Android** WhatsApp `.txt` export formats
- Removes outdated deploy scripts and the large exploratory notebook
- Keeps Hinglish/English stop words for cleaner word stats

## Features

- Total messages, words, media, and links
- Monthly and daily timelines
- Most active days and months
- Most active users (overall view)
- Word cloud + most common words
- Emoji frequency chart
- Sample chat for a quick demo
- Private analysis — file stays in the browser

## Tech stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- Recharts
- date-fns + emoji-regex

## Quick start

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

```bash
npm run build   # production build
npm run start   # serve production build
npm run lint    # eslint
```

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Framework preset: **Next.js** (auto-detected).
4. Build command: `npm run build`
5. Output: Next.js default (no special `vercel.json` required).
6. Deploy.

Or from the CLI:

```bash
npm i -g vercel
vercel
```

## How to export a WhatsApp chat

1. Open the chat in WhatsApp.
2. Tap the chat name / menu → **Export chat**.
3. Choose **Without media**.
4. Upload the resulting `.txt` file in the app.

Supported patterns include:

- iOS-style: `[01/01/25, 9:01:12 AM] Alex: Hello`
- Android-style: `01/01/25, 9:01 AM - Alex: Hello`

## Project structure

```text
src/
  app/                 # Next.js App Router pages + styles
  components/          # UI + charts
  lib/
    parseChat.ts       # WhatsApp export parser
    analyze.ts         # stats, timelines, words, emojis
    types.ts
public/
  stop_hinglish.txt    # stop words for word analysis
  sample-chat.txt      # demo export
```

## Privacy

Analysis runs entirely in the browser. Your chat file is not uploaded to a server by this app.

## License

MIT — use, revive, and remix freely.
