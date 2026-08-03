import { z } from 'zod';
import { toStrictJsonSchema } from './json-schema';

/**
 * The contract for model output.
 *
 * This schema is the single source of truth in both directions: it is compiled
 * to JSON Schema and sent as `output_config.format` so the model is constrained
 * on the way out, and it validates the response on the way back in. A field
 * added here is enforced at both ends with no second definition to drift.
 */

export const confidenceSchema = z.enum(['low', 'medium', 'high']);

export const findingSchema = z.object({
  title: z.string().describe('Six words or fewer. No trailing punctuation.'),
  detail: z
    .string()
    .describe('Two or three sentences explaining the pattern and why it matters.'),
  evidence: z
    .array(z.string())
    .describe(
      'The specific numbers from the digest that support this, each as a short phrase such as "P2 median reply 14.5 min" or "63% of messages between 21:00 and 00:00". Never invent a figure that is not in the data.',
    ),
  confidence: confidenceSchema.describe(
    'How strongly the data supports this. Use "low" when the sample is thin or the pattern could be coincidence.',
  ),
});

export const participantReadSchema = z.object({
  alias: z.string().describe('The participant alias exactly as it appears in the digest.'),
  role: z
    .string()
    .describe('A two- or three-word label for how this person shows up, e.g. "conversation starter".'),
  note: z.string().describe('One sentence, grounded in this participant’s numbers.'),
});

export const insightsSchema = z.object({
  headline: z.string().describe('One sentence capturing the single most striking thing.'),
  summary: z.string().describe('Two to four sentences describing the conversation overall.'),
  findings: z
    .array(findingSchema)
    .describe('Three to five distinct, non-overlapping observations, most interesting first.'),
  participants: z
    .array(participantReadSchema)
    .describe('One entry per participant in the digest, in the order given.'),
  caveats: z
    .array(z.string())
    .describe(
      'One to three honest limitations of this reading, such as an ambiguous date order, a short window, or metrics that cannot distinguish two explanations.',
    ),
});

export type Insights = z.infer<typeof insightsSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ParticipantRead = z.infer<typeof participantReadSchema>;

/** Compiled once at module load; sent as `output_config.format`. */
export const INSIGHTS_JSON_SCHEMA = toStrictJsonSchema(insightsSchema);
