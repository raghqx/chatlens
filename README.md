# chatlens

**Conversation intelligence for WhatsApp exports — that never sees your conversation.**

Drop in an exported chat and get the shape of it back: when you actually talk, who
starts things, how long replies really take, where the silences fell. Parsing and
every statistic run inside your browser. An optional AI layer reads only anonymised
aggregates, on your own API key.

[![CI](https://github.com/raghqx/chatlens/actions/workflows/ci.yml/badge.svg)](https://github.com/raghqx/chatlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.json)

---

## Why it works this way

A WhatsApp export is one of the most sensitive files a person owns. It contains
every argument, every medical detail, every half-thought sent at 2am, attributed and
timestamped.

So the architecture starts from a constraint rather than a feature list: **the
transcript must never reach a server.** Everything else follows from that.

- Parsing and analytics are pure TypeScript running in a **Web Worker**. The chat is
  never uploaded, and message bodies never even reach the React tree.
- The AI layer is **opt-in**, and receives a **digest** — counts, distributions,
  medians — with participants replaced by `P1`, `P2`. Real names stay in the browser
  and are mapped back only at render time.
- There is **no database, no server-side key, and no account**. You bring your own
  Anthropic key; it lives in `sessionStorage` for that tab and is forwarded per
  request.

The privacy claim is enforced by tests, not by a paragraph in a footer. The suite
asserts that no real name, phone number, link path, or raw message body can appear
in the digest — see [`src/lib/digest/digest.test.ts`](src/lib/digest/digest.test.ts).

---

## What it tells you

| | |
|---|---|
| **Rhythm** | Hour-by-weekday heatmap, monthly volume, longest streak, longest silence |
| **Reciprocity** | Message share, median reply latency per person, who restarts conversations after a gap |
| **Substance** | Term frequency with English + Hinglish stopwords removed, emoji ranking, link domains |
| **Structure** | Conversations segmented by a 6-hour gap; median length and duration |
| **AI reading** | Grounded findings with cited figures, explicit confidence, and stated limitations |

---

## Architecture

```
  Browser                                        │  Server
                                                 │
  ┌─────────────┐                                │
  │  .txt/.zip  │                                │
  └──────┬──────┘                                │
         │ never leaves the device               │
  ┌──────▼──────────────────────────┐            │
  │  Web Worker                     │            │
  │  ├─ parse    format + date order│            │
  │  ├─ analyze  single-pass metrics│            │
  │  └─ digest   redact + alias     │            │
  └──────┬──────────────────┬───────┘            │
         │ aggregates       │ digest (opt-in)    │
  ┌──────▼──────┐    ┌──────▼───────┐   POST     │   ┌──────────────────┐
  │  Dashboard  │    │  Insights UI │────────────┼──▶│ /api/insights    │
  │  SVG charts │    │  streaming   │◀───SSE─────┼───│  thin adapter    │
  └─────────────┘    └──────────────┘            │   └────────┬─────────┘
                                                 │            │
                                                 │   ┌────────▼─────────┐
                                                 │   │  agent loop      │
                                                 │   │  ├─ budget       │
                                                 │   │  ├─ tools        │
                                                 │   │  ├─ schema       │
                                                 │   │  └─ trace        │
                                                 │   └────────┬─────────┘
                                                 │            ▼
                                                 │     Claude Opus 5
```

Full write-up: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The AI layer

Anyone can post a blob of JSON at a model and print the reply. The parts that make
this a system rather than a call:

**Tool-calling over the analytics engine.** The prompt carries a compact overview
(~600 tokens). Hourly grids, per-participant detail and ranked vocabulary are
exposed as three `strict` tools the model calls when a specific finding needs them.
Detail is pulled, not pasted, so a run pays only for what it actually reads.
→ [`src/lib/ai/tools.ts`](src/lib/ai/tools.ts)

**One schema, enforced in both directions.** A Zod schema is compiled to JSON Schema
and sent as `output_config.format`, so the model is constrained on the way out; the
same schema validates the response on the way back in. The compiler strips the
validation keywords structured outputs reject and re-asserts them in Zod — the
constraint moves from "the model may not emit this" to "we refuse to accept it",
rather than being lost.
→ [`src/lib/ai/json-schema.ts`](src/lib/ai/json-schema.ts)

**Streaming with progressive rendering.** Output streams as one JSON document. A
tolerant parser closes the open containers on every chunk so complete fields render
as they arrive. It only ever *removes* an incomplete trailing value and *closes*
what is open — so output grows monotonically and a field that appears was really
emitted. Property-tested against every prefix of a real document.
→ [`src/lib/ai/partial-json.ts`](src/lib/ai/partial-json.ts)

**Budgeting before spending.** A byte ceiling rejects an oversized body before
parsing; a `count_tokens` pre-flight rejects an oversized prompt before the
expensive call. Bytes are a poor proxy for tokens once emoji and non-Latin scripts
are involved.
→ [`src/lib/ai/budget.ts`](src/lib/ai/budget.ts)

**Observability.** Every run emits one structured trace — prompt version, model,
effort, turns, tool calls, token usage by class, latency, estimated cost. It goes to
the log as a single JSON line *and* to the browser, where it renders as a run
receipt. You can see exactly what your key was spent on.
→ [`src/lib/ai/trace.ts`](src/lib/ai/trace.ts)

**Versioned prompts.** Prompts are files (`insights.v1.ts`), not strings edited in
place. Every trace records `promptId`, so a logged run stays attributable after the
prompt moves on. Changing wording means adding `v2`.

**Two-tier evals.** Tier 1 is deterministic and runs in CI with no key: golden
fixtures assert exact message counts, inferred date order, participant sets, and
that no identifier leaks into the digest. Tier 2 is an adversarial LLM judge scoring
grounding, specificity, calibration and honesty, run manually before changing the
prompt or model. The split matters — a fluent reading of miscounted data is worse
than no reading at all.
→ [`evals/`](evals/)

---

## What actually leaves your device

Only when you click **Generate**, and only this:

| Sent | Never sent |
|---|---|
| Message/word/media/link/emoji counts | Message text (unless you opt in, then redacted) |
| Hour, weekday and month distributions | Real display names (unless you opt in) |
| Per-participant medians, aliased `P1`…`Pn` | Phone numbers, emails, OTPs, long digit runs |
| Ranked terms, emoji, link **hosts** | Full URLs, invite links, document IDs |
| Streaks, conversation counts | The file itself, at any point |

For a 900-message chat the digest is **~2.2 KB**. Optional message samples are
stride-sampled across the whole window and scrubbed of phone numbers, emails, long
numbers and URL paths first.

---

## Run it locally

```bash
git clone https://github.com/raghqx/chatlens.git
cd chatlens
npm install
npm run dev
```

Open <http://localhost:3000>. No environment variables, no services, no key needed —
the entire dashboard works offline. A key is required only for the AI reading, and
you paste that into the app itself.

### Getting a chat out of WhatsApp

There is no API for this, by design — Meta does not expose personal or group chat
history to third parties, and the linked-device libraries that appear to offer it
violate WhatsApp's terms and risk a ban. Manual export is the only sanctioned path.

- **iPhone** — chat name → *Export Chat* → *Without Media* → *Save to Files*. Upload
  the `.zip` directly; chatlens opens it for you.
- **Android** — ⋮ → *More* → *Export chat* → *Without media*. Upload the `.txt`.

WhatsApp caps exports at roughly 40,000 messages without media and silently
truncates to the most recent ones.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

That is the whole deployment. Next.js is auto-detected, there are no environment
variables to set, and the only server-side surface is one route.

The insights route runs on the Node runtime with `maxDuration = 60`, which fits
Vercel's Hobby tier; raise it on Pro if you increase the effort level. Because the
response is streamed, a long model turn keeps the connection alive rather than
hitting an idle timeout.

---

## Verify

```bash
npm run verify   # typecheck + lint + tests (132 tests, no API key, no network)
npm test         # tests only
npm run eval     # tier 2: real model + LLM judge. Needs ANTHROPIC_API_KEY. Costs money.
```

The test suite is where the interesting engineering is documented. A sample:

- **Parser** — bracketed iOS vs dashed Android, 12- and 24-hour clocks, the `U+202F`
  narrow space modern WhatsApp puts before `AM`/`PM`, multi-line bodies, and system
  notices containing a colon that must not become a speaker.
- **Date order** — proves day-first vs month-first from the data, flags a file where
  it genuinely cannot be proven, and asserts that the same literal date lands in a
  different month under each interpretation.
- **Privacy** — no real name, phone number, OTP, or URL path can reach the digest.
- **Partial JSON** — every prefix of a real document either parses or returns null,
  and parsed output never shrinks.
- **ZIP reader** — real archives built byte-by-byte in the test, including a deflate
  round-trip.

---

## Layout

```
src/
  lib/
    parser/      format detection, date-order inference, tokenising    (pure)
    analytics/   single-pass metrics, stopwords, Unicode-aware text    (pure)
    digest/      redaction, pseudonymisation, the wire schema          (pure)
    ai/          agent loop, tools, schema, budget, trace, streaming
    zip.ts       dependency-free ZIP reader for iOS exports
  workers/       parse + analyse + digest, off the main thread
  components/    charts (hand-rolled SVG), dashboard, insights panel
  app/
    api/insights/route.ts    thin SSE adapter over the agent
evals/           fixtures, golden cases, deterministic checks, LLM judge
```

Everything under `lib/parser`, `lib/analytics` and `lib/digest` is pure: same input,
same output, no clock and no network. That is what makes the evals able to assert
exact numbers, and what lets the whole pipeline run in a worker.

---

## Design decisions

**Why not Streamlit / Python?** The previous version of this repo was a Streamlit
app. Streamlit is a long-lived stateful WebSocket server; Vercel runs stateless
functions. It could not be deployed here at any amount of config. More importantly,
it uploaded the entire chat to a server in order to draw a bar chart.

**Why the browser and not a backend?** Because the correct amount of a stranger's
private conversation to hold on your server is zero. It also makes the app free to
run at any traffic level.

**Why bring-your-own-key?** A public demo on my key is a bill waiting to happen, and
rate-limiting it into uselessness is a worse demo. BYOK also puts the cost model in
front of the user, which is why the run receipt exists.

**Why no chart library?** Six chart types, hand-rolled in SVG, is less code than the
config to make a library behave — and it keeps a privacy-first app free of
dependencies in the render path. The palette is checked with a colour-vision-
deficiency validator: worst adjacent separation 9.1 (light) / 8.4 (dark) on the
OKLab×100 scale, against a target of 8. Identity is never carried by colour alone;
the participant table doubles as the legend.

**Why `claude-opus-5` at `medium` effort?** The task is bounded — read an aggregate,
write structured commentary — and lower effort holds quality well while roughly
halving what a visitor pays on their own key. Both are single constants in
[`src/lib/ai/model.ts`](src/lib/ai/model.ts).

---

## Limitations

- **Timezones.** Exports carry no UTC offset; times are whatever the exporting
  phone's clock read. They are interpreted locally, which is the only
  self-consistent choice, but a chat across timezones reads as the exporter saw it.
- **Ambiguous dates.** If no date in a file has a day above 12, day-first vs
  month-first cannot be proven. The app says so and offers a toggle rather than
  guessing silently.
- **Export caps.** WhatsApp truncates long exports without warning. Totals are the
  totals of the file, not of the chat.
- **Reply latency is a proxy.** A long median can mean disengagement or a timezone
  offset. The AI layer is instructed to say so rather than pick one.
- **Single-message participants.** In a large group, someone who sent exactly one
  message is identified by name shape rather than recurrence, which is a heuristic.

---

## Licence

MIT © 2026 Raghav Singhal. See [LICENSE](LICENSE).

Not affiliated with, endorsed by, or connected to WhatsApp or Meta Platforms, Inc.
WhatsApp is a trademark of Meta Platforms, Inc.
