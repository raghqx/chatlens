# Architecture

How chatlens is put together, and why each boundary sits where it does.

## The governing constraint

A WhatsApp export is attributed, timestamped, and complete. Treating it as
ordinary upload data would be the wrong default, so the system is built around
one rule: **the transcript never crosses the network.**

That single constraint produces most of the design:

| Constraint | Consequence |
|---|---|
| Transcript stays local | Parsing and analytics must be client-side |
| Client-side work must not freeze the tab | A Web Worker, not an inline call |
| Message bodies must not leak through the UI | Raw messages live only in the worker |
| The AI still needs something to read | An aggregate digest, pseudonymised |
| The digest claim must be checkable | Assertions in the test suite, not prose |
| No server-side data means no server-side key | Bring-your-own-key, per request |

## Layers

### 1. Ingest (`src/lib/zip.ts`, `src/components/Dropzone.tsx`)

Accepts `.txt` or `.zip`. iOS "Export Chat" produces a zip containing
`_chat.txt`, so the archive is opened in the browser using `DecompressionStream`
and a hand-written central-directory reader — no dependency in the path of the
user's data.

### 2. Parse (`src/lib/parser/`)

Pure functions, no I/O.

**Normalisation** removes the bytes that break naive parsers: a BOM, CRLF, bidi
control characters WhatsApp injects around timestamps, and the `U+202F` narrow
no-break space it started putting before `AM`/`PM` in 2023.

**Format detection** counts matches of both header shapes across the whole file
rather than sniffing line one — exports routinely begin with an unstamped
encryption banner.

**Date-order inference** is the consequential step. A day above 12 can only be a
day, so a single such date proves the order for the file. When no date exceeds 12
in either slot the order is genuinely undecidable; the parser says so and the UI
offers a toggle. Silently assuming here is how six months of drift enters a chart
with no error anywhere.

**Author attribution** runs in two passes. A tentative `name: text` split is made,
then a candidate is accepted if it recurs *or* is name-shaped (short, few words,
no quote marks). Either signal alone is enough: recurrence catches a mangled
system notice, and shape keeps a group member who sent exactly one message.

### 3. Analyse (`src/lib/analytics/`)

One pass over the messages produces every metric. Pure, so the eval suite can
assert exact numbers.

Two decisions worth naming:

- **Conversation segmentation** at a 6-hour gap. Long enough not to split an
  evening thread, short enough to separate "we kept talking" from "we picked it
  up next morning".
- **Reply latency** is only recorded across a change of speaker and under a
  12-hour cutoff. Counting overnight gaps as replies makes every median
  meaningless.

Text handling is Unicode-aware throughout: grapheme segmentation so a ZWJ family
emoji counts once, and URL stripping before tokenising so link path segments do
not become "vocabulary".

### 4. Digest (`src/lib/digest/`)

The network boundary, and the only place redaction is defined.

Aggregates only. Participants become `P1`, `P2`, ordered by message count; the
alias map never leaves the browser and is applied in reverse at render time.
Optional message samples are stride-sampled across the whole window — taking the
first N would describe only how the conversation started — then scrubbed of phone
numbers, emails, long digit runs and URL paths.

The digest has a Zod schema shared by the client that builds it and the route
that receives it, so the contract is enforced on both sides rather than assumed.

### 5. Worker (`src/workers/analyze.worker.ts`)

Holds the parsed messages for the page's lifetime and answers three requests:
`analyze`, `digest`, `reset`. The main thread receives aggregates and, on demand,
a digest — never the transcript. The component tree cannot leak what it never
holds.

### 6. Agent (`src/lib/ai/agent.ts`)

The loop lives here rather than in the route handler, so the code path the eval
harness measures is the one that serves the browser.

```
overview prompt ──▶ stream turn ──▶ stop_reason?
                         ▲              │
                         │              ├─ tool_use ──▶ execute against digest
                         └──────────────┘                (results in ONE message)
                                        └─ end_turn ──▶ validate against Zod
```

- **Tools** (`tools.ts`) query the in-memory digest. Nothing else is reachable —
  no I/O, no persistence. Bad arguments return error results rather than throwing,
  so the model can correct itself instead of the run dying.
- **All tool results for a turn go back in a single user message.** Splitting them
  trains the model to stop issuing parallel calls.
- **`output_config`** carries both effort and the JSON Schema. The installed SDK's
  published types still describe the older `output_format`, so the body is built
  against the shape the API accepts and cast exactly once.
- **The system prompt is cached** with a `cache_control` breakpoint. It is
  byte-stable across requests, which is what makes a cached prefix possible.

### 7. Route (`src/app/api/insights/route.ts`)

Deliberately thin: read the bearer key, size-check the body, validate the digest,
count tokens, adapt agent events onto SSE, log a trace.

Errors are mapped to codes a person can act on (`invalid_api_key`,
`token_budget_exceeded`, `rate_limited`) rather than a generic 500.

### 8. Streaming UI (`src/lib/ai/use-insights.ts`)

Deltas are tagged with a turn index. A turn that ended in a tool call was
preamble, not an answer, so the client drops that buffer when the next turn
starts. The buffer is repaired and parsed on every chunk by `partial-json.ts`,
whose output grows monotonically — a field that appears never disappears, so the
UI can render straight from it without flicker.

## Testing strategy

| Tier | What it proves | Needs a key | Runs in CI |
|---|---|---|---|
| Unit | Parser, analytics, redaction, partial JSON, ZIP | No | Yes |
| Golden evals | Exact counts, date order, participants, no leaks | No | Yes |
| LLM judge | Grounding, specificity, calibration, honesty | Yes | No |

The tiers are separate on purpose. Tier 1 and 2 are the gate that matters: a
fluent AI reading of miscounted data is worse than no reading. Tier 3 is
non-deterministic and bills a real key, so it informs a prompt change rather than
blocking a merge.

## Extending it

- **New metric** — add it to `analytics/metrics.ts`, surface it in the digest
  schema, and expose it through a tool if the model should be able to ask for it.
- **New prompt** — add `prompts/insights.v2.ts`; do not edit v1. Traces reference
  the version, so old runs stay attributable.
- **New output field** — add it to the Zod schema in `ai/schema.ts`. It is
  enforced in both directions automatically.
