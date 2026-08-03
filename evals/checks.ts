import type { Insights } from '@/lib/ai/schema';
import type { Digest } from '@/lib/digest';

/**
 * Deterministic checks on model output.
 *
 * Everything decidable by code is decided by code, so the judge is only asked
 * about things that genuinely need judgement. These are cheap, run without an
 * API call once output exists, and never disagree with themselves.
 */

export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const MIN_FINDINGS = 3;
const MAX_FINDINGS = 6;
const MAX_HEADLINE_CHARS = 160;

export function runChecks(digest: Digest, insights: Insights): Check[] {
  const knownAliases = new Set(digest.participants.map((p) => p.alias));

  const unknownInParticipants = insights.participants
    .map((p) => p.alias)
    .filter((alias) => !knownAliases.has(alias));

  const missingParticipants = [...knownAliases].filter(
    (alias) => !insights.participants.some((p) => p.alias === alias),
  );

  const emptyEvidence = insights.findings.filter((f) => f.evidence.length === 0);

  return [
    {
      name: 'headline is present and tight',
      passed: insights.headline.trim().length > 0 && insights.headline.length <= MAX_HEADLINE_CHARS,
      detail: `${insights.headline.length} chars`,
    },
    {
      name: 'summary is present',
      passed: insights.summary.trim().length > 0,
    },
    {
      name: `findings count within ${MIN_FINDINGS}-${MAX_FINDINGS}`,
      passed: insights.findings.length >= MIN_FINDINGS && insights.findings.length <= MAX_FINDINGS,
      detail: `${insights.findings.length} findings`,
    },
    {
      name: 'every finding cites evidence',
      passed: emptyEvidence.length === 0,
      detail: emptyEvidence.map((f) => f.title).join(', '),
    },
    {
      name: 'findings have distinct titles',
      passed: new Set(insights.findings.map((f) => f.title.toLowerCase())).size ===
        insights.findings.length,
    },
    {
      name: 'no invented participant aliases',
      passed: unknownInParticipants.length === 0,
      detail: unknownInParticipants.join(', '),
    },
    {
      name: 'every participant is covered',
      passed: missingParticipants.length === 0,
      detail: missingParticipants.join(', '),
    },
    {
      name: 'at least one caveat',
      passed: insights.caveats.length > 0,
    },
    {
      name: 'confidence is not uniformly high',
      // A model that labels everything "high" is not calibrating, it is padding.
      passed:
        insights.findings.length < MIN_FINDINGS ||
        new Set(insights.findings.map((f) => f.confidence)).size > 1 ||
        insights.findings[0].confidence !== 'high',
      detail: insights.findings.map((f) => f.confidence).join('/'),
    },
  ];
}
