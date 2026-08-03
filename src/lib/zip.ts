/**
 * Minimal ZIP reader for WhatsApp exports.
 *
 * On iOS, "Export chat" hands the share sheet a `.zip` containing `_chat.txt`.
 * Telling the user to go and unzip it themselves is the single most common
 * place this app loses people, so read the archive here instead.
 *
 * Implemented directly against the ZIP layout rather than pulling in a library:
 * the only compression WhatsApp uses is deflate, and `DecompressionStream` has
 * shipped in every current browser and in Node. That keeps a privacy-focused
 * app free of a dependency that would sit in the path of the user's data.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const EOCD_MIN_SIZE = 22;
/** The trailing comment may be up to 64 KB, so the EOCD can sit that far back. */
const MAX_COMMENT_SIZE = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Walk back from the end of the archive to find the end-of-central-directory record. */
function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new ZipError('Not a valid .zip archive.');
}

export function listEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);

  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new ZipError('Corrupt central directory in .zip archive.');
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    entries.push({
      name: new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLength)),
      compressionMethod: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  const header = entry.localHeaderOffset;
  if (view.getUint32(header, true) !== LOCAL_FILE_SIGNATURE) {
    throw new ZipError('Corrupt file header in .zip archive.');
  }

  // The local header repeats the name and extra fields with its own lengths;
  // the central directory's values do not always match, so read them here.
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const dataStart = header + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.compressionMethod === METHOD_STORED) {
    return new TextDecoder().decode(data);
  }
  if (entry.compressionMethod !== METHOD_DEFLATE) {
    throw new ZipError(`Unsupported compression in .zip archive (method ${entry.compressionMethod}).`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('This browser cannot open .zip files. Unzip it and upload the .txt inside.');
  }

  // WhatsApp writes raw deflate streams, without the zlib header a plain
  // 'deflate' stream would expect.
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/**
 * Choose the transcript inside an export archive.
 *
 * iOS names it `_chat.txt`, but an archive can also hold attachments and, in
 * some locales, a differently named transcript. Prefer the canonical name, then
 * fall back to the largest `.txt`, which is the transcript in every archive
 * that has one. Entries under `__MACOSX/` are resource-fork noise added when a
 * Mac re-zips the file.
 */
export function pickTranscript(entries: ZipEntry[]): ZipEntry | null {
  const candidates = entries.filter(
    (e) =>
      e.name.toLowerCase().endsWith('.txt') &&
      !e.name.startsWith('__MACOSX/') &&
      !e.name.split('/').pop()?.startsWith('.'),
  );
  if (candidates.length === 0) return null;

  return (
    candidates.find((e) => e.name.split('/').pop()?.toLowerCase() === '_chat.txt') ??
    candidates.reduce((largest, e) => (e.uncompressedSize > largest.uncompressedSize ? e : largest))
  );
}

/** Extract the chat transcript from a WhatsApp export archive. */
export async function extractTranscript(buffer: ArrayBuffer): Promise<string> {
  const entry = pickTranscript(listEntries(buffer));
  if (!entry) {
    throw new ZipError('That .zip has no chat transcript in it. Export again "Without media".');
  }
  return readEntry(buffer, entry);
}
