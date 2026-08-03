import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import { toStrictJsonSchema } from '@/lib/ai/json-schema';
import type { Insights } from '@/lib/ai/schema';
import type { Digest } from '@/lib/digest';

/**
 * LLM-as-judge scoring for insight quality.
 *
 * Everything mechanical about the output is already checked deterministically
 * in `checks.ts` — shape, aliases, counts. The judge exists only for what code
 * cannot decide: is this claim actually supported by the numbers, is it worth
 * saying, is the stated confidence honest.
 *
 * The judge is given the digest and told to be adversarial. Grading "does this
 * read well" would reward fluent nonsense, which is the exact failure mode that
 * matters for a tool that describes someone's relationships back to them.
 */

const JUDGE_MODEL = 'claude-opus-5';

const dimensionSchema = z.object({
  score: z.number().describe('1 to 5, where 3 is acceptable and 5 is excellent.'),
  reason: z.string().describe('One sentence. Cite the specific claim you are scoring.'),
});

export const verdictSchema = z.object({
  grounding: dimensionSchema.describe(
    'Is every numeric claim actually present in the digest? Score 1 if any figure was invented.',
  ),
  specificity: dimensionSchema.describe(
    'Are the findings non-obvious? "One person sent more messages" restated as a finding scores low.',
  ),
  calibration: dimensionSchema.describe(
    'Do the confidence labels match the strength of the evidence? Overconfidence on a thin sample scores low.',
  ),
  honesty: dimensionSchema.describe(
    'Do the caveats name real limitations rather than boilerplate? Are alternative explanations acknowledged?',
  ),
  unsupportedClaims: z
    .array(z.string())
    .describe('Verbatim claims that the digest does not support. Empty if none.'),
});

export type Verdict = z.infer<typeof verdictSchema>;

const VERDICT_JSON_SCHEMA = toStrictJsonSchema(verdictSchema);

const JUDGE_SYSTEM = `You grade analyses of messaging-conversation statistics. You are adversarial: your job is to find claims the data does not support, not to be encouraging.

You receive the exact aggregate digest an analyst was given, and the analysis they produced. Everything they were allowed to know is in that digest.

Score each dimension 1-5. Reserve 5 for genuinely excellent work. An analysis that reads fluently but asserts a figure absent from the digest scores 1 on grounding regardless of how well written it is.

Quote claims verbatim when you flag them.`;

export function averageScore(verdict: Verdict): number {
  const scores = [
    verdict.grounding.score,
    verdict.specificity.score,
    verdict.calibration.score,
    verdict.honesty.score,
  ];
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export async function judge(
  client: Anthropic,
  digest: Digest,
  insights: Insights,
): Promise<Verdict> {
  const request = {
    model: JUDGE_MODEL,
    max_tokens: 8_000,
    system: JUDGE_SYSTEM,
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: VERDICT_JSON_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `DIGEST THE ANALYST WAS GIVEN:\n${JSON.stringify(digest, null, 1)}\n\nANALYSIS THEY PRODUCED:\n${JSON.stringify(insights, null, 1)}\n\nGrade it.`,
      },
    ],
  } as unknown as MessageCreateParams;

  // Streamed so a high-effort judge turn cannot hit an idle timeout.
  const stream = client.messages.stream(request);
  const message = await stream.finalMessage();
  const text = message.content.find((block) => block.type === 'text')?.text ?? '';
  return verdictSchema.parse(JSON.parse(text));
}
