import { describe, expect, it } from 'vitest';
import { extractTranscript, listEntries, pickTranscript, ZipError, type ZipEntry } from './zip';

/**
 * Build a real ZIP archive in memory so the reader is tested against actual
 * bytes rather than a mock. Uses stored (uncompressed) entries plus a deflated
 * one, which is what WhatsApp actually writes.
 */
async function buildZip(
  files: Array<{ name: string; content: string; deflate?: boolean }>,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = encoder.encode(file.content);

    let data = raw;
    let method = 0;
    if (file.deflate) {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
      method = 8;
    }

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

const TRANSCRIPT = '[13/08/2024, 9:41:03 AM] Alice: hello from inside a zip\n';

describe('listEntries', () => {
  it('reads every entry in an archive', async () => {
    const zip = await buildZip([
      { name: '_chat.txt', content: TRANSCRIPT },
      { name: 'IMG-001.jpg', content: 'not really a jpeg' },
    ]);
    expect(listEntries(zip).map((e) => e.name)).toEqual(['_chat.txt', 'IMG-001.jpg']);
  });

  it('rejects something that is not a zip', () => {
    const notZip = new TextEncoder().encode('just some text, definitely not a zip').buffer;
    expect(() => listEntries(notZip as ArrayBuffer)).toThrow(ZipError);
  });
});

describe('pickTranscript', () => {
  const entry = (name: string, uncompressedSize: number): ZipEntry => ({
    name,
    compressionMethod: 8,
    compressedSize: uncompressedSize,
    uncompressedSize,
    localHeaderOffset: 0,
  });

  it('prefers the canonical iOS name', () => {
    const picked = pickTranscript([entry('notes.txt', 9999), entry('_chat.txt', 10)]);
    expect(picked?.name).toBe('_chat.txt');
  });

  it('finds _chat.txt inside a folder', () => {
    const picked = pickTranscript([entry('WhatsApp Chat - Team/_chat.txt', 50)]);
    expect(picked?.name).toBe('WhatsApp Chat - Team/_chat.txt');
  });

  it('falls back to the largest .txt', () => {
    const picked = pickTranscript([entry('a.txt', 10), entry('b.txt', 900), entry('c.txt', 30)]);
    expect(picked?.name).toBe('b.txt');
  });

  it('ignores macOS resource forks and dotfiles', () => {
    const picked = pickTranscript([
      entry('__MACOSX/._chat.txt', 8000),
      entry('.hidden.txt', 8000),
      entry('_chat.txt', 20),
    ]);
    expect(picked?.name).toBe('_chat.txt');
  });

  it('returns null when there is no transcript', () => {
    expect(pickTranscript([entry('IMG-001.jpg', 100)])).toBeNull();
  });
});

describe('extractTranscript', () => {
  it('reads a stored entry', async () => {
    const zip = await buildZip([{ name: '_chat.txt', content: TRANSCRIPT }]);
    expect(await extractTranscript(zip)).toBe(TRANSCRIPT);
  });

  it('reads a deflated entry, which is what WhatsApp writes', async () => {
    const zip = await buildZip([{ name: '_chat.txt', content: TRANSCRIPT, deflate: true }]);
    expect(await extractTranscript(zip)).toBe(TRANSCRIPT);
  });

  it('picks the transcript out of an archive that also holds media', async () => {
    const zip = await buildZip([
      { name: 'IMG-0001.jpg', content: 'x'.repeat(5000) },
      { name: '_chat.txt', content: TRANSCRIPT, deflate: true },
      { name: 'AUD-0002.opus', content: 'y'.repeat(3000) },
    ]);
    expect(await extractTranscript(zip)).toBe(TRANSCRIPT);
  });

  it('round-trips a large transcript', async () => {
    const big = Array.from(
      { length: 5000 },
      (_, i) => `[13/08/2024, 9:41:03 AM] Alice: message number ${i}`,
    ).join('\n');
    const zip = await buildZip([{ name: '_chat.txt', content: big, deflate: true }]);
    expect(await extractTranscript(zip)).toBe(big);
  });

  it('explains itself when the archive has no transcript', async () => {
    const zip = await buildZip([{ name: 'IMG-001.jpg', content: 'nope' }]);
    await expect(extractTranscript(zip)).rejects.toThrow(/no chat transcript/i);
  });
});
