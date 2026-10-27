// A STREAMING ZIP WRITER (Jon, 2026-10-27: the photo library — "download them if needed, in zip
// files, high quality").
//
// Photos are already compressed, so every entry is STORED (method 0): no CPU spent re-compressing
// JPEGs, and the archive is exactly the sum of its files. Each entry is written as it arrives —
// local header first, then the bytes, then a data descriptor carrying the CRC and sizes we only know
// at the end (general-purpose bit 3) — so a 120 MB unit or a multi-gigabyte building never sits in
// memory. The central directory goes at the end; when the archive passes 4 GB or 65,535 entries the
// ZIP64 records are written as well (every mainstream unarchiver reads them).
//
// Pure: no imports, no I/O. `emit` receives each chunk; the caller pipes them wherever they go.
// lib/__tests__/zip-stream.test.mjs builds an archive and reads it back by the spec.

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
/** CRC-32 (IEEE), continuing from a previous value — pass the last result as `crc` to run it over chunks. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
const LIMIT32 = 0xffffffff
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
class Buf {
  private parts: number[] = []
  u8(v: number) { this.parts.push(v & 0xff) }
  u16(v: number) { this.u8(v); this.u8(v >>> 8) }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff) }
  u64(v: number) { this.u32(v % 0x100000000); this.u32(Math.floor(v / 0x100000000)) }
  bytes(b: Uint8Array) { for (let i = 0; i < b.length; i++) this.parts.push(b[i]) }
  out(): Uint8Array { return Uint8Array.from(this.parts) }
}

type Entry = { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number }

export class ZipWriter {
  private offset = 0
  private entries: Entry[] = []
  private cur: { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number } | null = null
  private finished = false
  private emit: (chunk: Uint8Array) => void
  constructor(emit: (chunk: Uint8Array) => void) { this.emit = emit }

  private push(b: Uint8Array) { this.offset += b.length; this.emit(b) }

  /** How many bytes have been written so far. */
  get written(): number { return this.offset }

  /** Begin an entry. Names use "/" for folders ("17WEST - 511/01 - living.jpg"). */
  startEntry(name: string, mtime: Date = new Date()): void {
    if (this.finished) throw new Error('zip already finished')
    if (this.cur) throw new Error('finish the current entry first')
    const nm = enc.encode(name.replace(/^\/+/, ''))
    const { time, date } = dosTime(mtime)
    const h = new Buf()
    h.u32(0x04034b50)  // local file header
    h.u16(20)          // version needed (2.0: data descriptor + store)
    h.u16(0x0808)      // flags: bit 3 data descriptor · bit 11 UTF-8 names
    h.u16(0)           // method: store
    h.u16(time); h.u16(date)
    h.u32(0); h.u32(0); h.u32(0)   // crc, sizes — in the descriptor
    h.u16(nm.length); h.u16(0)     // name length, extra length
    h.bytes(nm)
    this.cur = { name: nm, crc: 0, size: 0, offset: this.offset, time, date }
    this.push(h.out())
  }

  /** The entry's bytes, in any number of chunks. */
  write(chunk: Uint8Array): void {
    if (!this.cur) throw new Error('no entry open')
    if (!chunk.length) return
    this.cur.crc = crc32(chunk, this.cur.crc)
    this.cur.size += chunk.length
    this.push(chunk)
  }

  /** Close the entry: the data descriptor with the real CRC and size. */
  endEntry(): void {
    const c = this.cur
    if (!c) throw new Error('no entry open')
    if (c.size > LIMIT32) throw new Error('a single entry over 4 GB is not supported')
    const d = new Buf()
    d.u32(0x08074b50)   // data descriptor signature
    d.u32(c.crc); d.u32(c.size); d.u32(c.size)
    this.push(d.out())
    this.entries.push({ name: c.name, crc: c.crc, size: c.size, offset: c.offset, time: c.time, date: c.date })
    this.cur = null
  }

  /** A whole small entry at once (a README, a list of what could not be fetched). */
  addText(name: string, text: string, mtime?: Date): void {
    this.startEntry(name, mtime)
    this.write(enc.encode(text))
    this.endEntry()
  }

  /** The central directory and the end record(s). Nothing may be written after this. */
  finish(): void {
    if (this.cur) throw new Error('an entry is still open')
    if (this.finished) return
    this.finished = true
    const cdStart = this.offset
    const zip64 = this.entries.length >= 0xffff || cdStart > LIMIT32 || this.entries.some(e => e.offset > LIMIT32)
    for (const e of this.entries) {
      const big = e.offset > LIMIT32
      const extra = new Buf()
      if (big) { extra.u16(0x0001); extra.u16(8); extra.u64(e.offset) }   // ZIP64 extra: the local header offset only
      const x = extra.out()
      const h = new Buf()
      h.u32(0x02014b50)  // central directory header
      h.u16(big || zip64 ? 45 : 20)   // version made by (4.5 when ZIP64 is in play)
      h.u16(big || zip64 ? 45 : 20)   // version needed
      h.u16(0x0808)      // flags, as in the local header
      h.u16(0)           // store
      h.u16(e.time); h.u16(e.date)
      h.u32(e.crc); h.u32(e.size); h.u32(e.size)
      h.u16(e.name.length); h.u16(x.length); h.u16(0)   // name, extra, comment lengths
      h.u16(0); h.u16(0)   // disk start, internal attrs
      h.u32(0)             // external attrs
      h.u32(big ? LIMIT32 : e.offset)
      h.bytes(e.name); h.bytes(x)
      this.push(h.out())
    }
    const cdSize = this.offset - cdStart
    if (zip64) {
      const z64Offset = this.offset
      const z = new Buf()
      z.u32(0x06064b50)  // ZIP64 end of central directory record
      z.u64(44)          // size of the remainder of this record
      z.u16(45); z.u16(45)
      z.u32(0); z.u32(0)  // this disk, disk with the CD
      z.u64(this.entries.length); z.u64(this.entries.length)
      z.u64(cdSize); z.u64(cdStart)
      this.push(z.out())
      const l = new Buf()
      l.u32(0x07064b50)  // ZIP64 end of central directory locator
      l.u32(0); l.u64(z64Offset); l.u32(1)
      this.push(l.out())
    }
    const e = new Buf()
    e.u32(0x06054b50)  // end of central directory
    e.u16(0); e.u16(0)
    e.u16(Math.min(this.entries.length, 0xffff)); e.u16(Math.min(this.entries.length, 0xffff))
    e.u32(Math.min(cdSize, LIMIT32)); e.u32(Math.min(cdStart, LIMIT32))
    e.u16(0)   // comment length
    this.push(e.out())
  }
}

/** A file name that is safe inside an archive and on every desktop: no path tricks, no reserved characters, trimmed. */
export function safeName(s: string, fallback = 'photo'): string {
  const t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').trim()
  return (t || fallback).slice(0, 120)
}
