import { describe, expect, it } from 'vitest';
import { analyze } from '../analytics';
import type { ChatMessage } from '../parser';
import { buildDigest, digestSchema } from './build';
import { redactText } from './redact';

const msg = (
  iso: string,
  author: string | null,
  text: string,
  kind: ChatMessage['kind'] = author ? 'text' : 'system',
): ChatMessage => ({ at: new Date(iso).getTime(), author, text, kind });

const messages: ChatMessage[] = [
  msg('2024-08-01T09:01:00', 'Alice Sharma', 'call me on +91 98765 43210 or a@b.example'),
  msg('2024-08-01T09:06:00', 'Bob Verma', 'see https://drive.example.com/file/d/SECRET_TOKEN/view'),
  msg('2024-08-01T09:10:00', 'Alice Sharma', 'ship the release 🚀'),
  msg('2024-08-02T18:00:00', 'Bob Verma', 'order 8837261 confirmed'),
];

describe('redactText', () => {
  it('removes phone numbers and email addresses', () => {
    const out = redactText('call +91 98765 43210 or mail a.b@c.example');
    expect(out).not.toMatch(/98765/);
    expect(out).not.toMatch(/@c\.example/);
    expect(out).toContain('[phone]');
    expect(out).toContain('[email]');
  });

  it('reduces a url to its host so tokens cannot leak', () => {
    const out = redactText('https://drive.example.com/file/d/SECRET_TOKEN/view');
    expect(out).toBe('[link:drive.example.com]');
    expect(out).not.toContain('SECRET_TOKEN');
  });

  it('masks long digit runs such as OTPs and order ids', () => {
    expect(redactText('code 483920 expires')).toContain('[number]');
  });

  it('leaves ordinary prose untouched', () => {
    expect(redactText('ship the release on friday')).toBe('ship the release on friday');
  });
});

describe('buildDigest', () => {
  const analysis = analyze(messages);

  it('produces a digest that validates against the shared schema', () => {
    const { digest } = buildDigest(analysis, messages);
    expect(() => digestSchema.parse(digest)).not.toThrow();
  });

  it('pseudonymises participants by default and never emits real names', () => {
    const { digest, aliases } = buildDigest(analysis, messages);
    const wire = JSON.stringify(digest);
    expect(wire).not.toContain('Alice Sharma');
    expect(wire).not.toContain('Bob Verma');
    expect(digest.participants.map((p) => p.alias).sort()).toEqual(['P1', 'P2']);
    expect(aliases.toName.P1).toBeDefined();
  });

  it('omits message bodies unless samples are explicitly requested', () => {
    const { digest } = buildDigest(analysis, messages);
    expect(digest.samples).toBeUndefined();
    expect(JSON.stringify(digest)).not.toContain('ship the release');
  });

  it('redacts sample bodies when they are requested', () => {
    const { digest } = buildDigest(analysis, messages, { includeSamples: true });
    const wire = JSON.stringify(digest);
    expect(digest.samples?.length).toBeGreaterThan(0);
    expect(wire).not.toContain('98765');
    expect(wire).not.toContain('SECRET_TOKEN');
    expect(wire).not.toContain('Alice Sharma');
  });

  it('can opt out of pseudonymisation', () => {
    const { digest } = buildDigest(analysis, messages, { pseudonymize: false });
    expect(digest.participants.map((p) => p.alias)).toContain('Alice Sharma');
  });

  // Regression: term frequencies used to be computed over raw message text, so
  // a phone number's digit runs and a share link's path segments (including the
  // document id) rode into the digest inside `topTerms`.
  it('keeps numbers and url path segments out of the term ranking', () => {
    const { digest } = buildDigest(analysis, messages, { includeSamples: true });
    const terms = digest.vocabulary.topTerms.map((t) => t.value);
    expect(terms).not.toContain('98765');
    expect(terms).not.toContain('8837261');
    expect(terms).not.toContain('secret');
    expect(terms).not.toContain('token');
    expect(terms).not.toContain('https');
    expect(terms.every((t) => !/^\d+$/.test(t))).toBe(true);
  });

  it('carries aggregate structure rather than raw text', () => {
    const { digest } = buildDigest(analysis, messages);
    expect(digest.activity.byHour).toHaveLength(24);
    expect(digest.activity.byWeekday).toHaveLength(7);
    expect(digest.totals.messages).toBe(4);
  });

  it('stays small enough to prompt with', () => {
    const { digest } = buildDigest(analysis, messages, { includeSamples: true });
    expect(JSON.stringify(digest).length).toBeLessThan(64_000);
  });
});
