import { z } from 'zod';

/**
 * Convert a Zod schema into the JSON Schema dialect Anthropic structured
 * outputs accept.
 *
 * Two adjustments are required, and both fail loudly at request time if you
 * skip them:
 *
 *  - `$schema` is not part of the accepted document.
 *  - Validation keywords beyond structure are rejected. `minItems`, `maxItems`,
 *    `minLength`, `pattern` and the numeric bounds all have to go; they are
 *    still enforced on the way back in, by parsing the response with the same
 *    Zod schema. So the constraint is not lost, it just moves from "the model
 *    is forbidden to emit this" to "we refuse to accept it".
 *
 * `type`, `properties`, `required`, `additionalProperties`, `enum`, `items`,
 * `anyOf`, `$ref` and `$defs` are all supported and pass through untouched.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'minProperties',
  'maxProperties',
  'uniqueItems',
  'default',
]);

type JsonValue = unknown;

function strip(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(node as Record<string, JsonValue>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = strip(value);
  }
  return out;
}

/**
 * Belt-and-braces: structured outputs require every object to be closed and to
 * list its properties as required. Zod 4 already emits both, but a hand-edited
 * or `.partial()` schema would not, and the resulting 400 is opaque.
 */
function harden(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(harden);
  if (node === null || typeof node !== 'object') return node;

  const obj = node as Record<string, JsonValue>;
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(obj)) out[key] = harden(value);

  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return harden(strip(z.toJSONSchema(schema))) as Record<string, unknown>;
}
