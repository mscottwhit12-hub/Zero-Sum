/** Minimal ZIP writer (stored, no compression) and reader (stored + deflate); no dependency. The writer builds the GM's end-of-night package; the reader opens sound packs. */
import { inflateRawSync } from 'node:zlib';
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Buffer | string }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const d = new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipFile {
  name: string;
  /** Uncompressed size as the zip declares it. */
  size: number;
  /** Decompress this one file (nothing else is touched). Throws zip_corrupt / zip_unsupported. */
  read(): Buffer;
}

/**
 * Index a ZIP without decompressing anything (stored + deflate entries; no ZIP64, no encryption). Folders are skipped.
 * Throws an Error whose message is a short code: not_a_zip, zip_unsupported, zip_too_many_files, zip_entry_too_large,
 * zip_corrupt. Names are returned as stored: callers must never use them as filesystem paths. `read()` never inflates
 * more than `maxEntryBytes`, whatever the zip claims, so a crafted zip cannot balloon memory.
 */
export function zipIndex(buf: Buffer, opts: { maxEntries?: number; maxEntryBytes?: number } = {}): ZipFile[] {
  const maxEntries = opts.maxEntries ?? 500;
  const maxEntry = opts.maxEntryBytes ?? 64 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not_a_zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('zip_unsupported');
  if (count > maxEntries) throw new Error('zip_too_many_files');
  const out: ZipFile[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip_corrupt');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1 || csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new Error('zip_unsupported');
    if (usize > maxEntry) throw new Error('zip_entry_too_large');
    out.push({
      name,
      size: usize,
      read() {
        if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('zip_corrupt');
        const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        if (start + csize > buf.length) throw new Error('zip_corrupt');
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method !== 8) throw new Error('zip_unsupported');
        try {
          return inflateRawSync(raw, { maxOutputLength: maxEntry });
        } catch {
          throw new Error('zip_corrupt');
        }
      },
    });
  }
  return out;
}

/** Read every file of a ZIP into memory (small zips only; sound packs use zipIndex and read one file at a time). */
export function unzip(buf: Buffer, opts: { maxEntries?: number; maxEntryBytes?: number } = {}): ZipEntry[] {
  return zipIndex(buf, opts).map((f) => ({ name: f.name, data: f.read() }));
}
