// node lib/__tests__/zip-stream.test.mjs
// The streaming ZIP writer behind the photo library's downloads (Jon, 2026-10-27): the archive it
// writes is read back by the spec — local headers, data descriptors, central directory, end record.
const { ZipWriter, crc32, safeName } = await import('../zip-stream.ts')
let pass = 0, fail = 0
const eq = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) } }
const enc = new TextEncoder(), dec = new TextDecoder()

// ── crc32 ──
eq('crc32 of "hello"', crc32(enc.encode('hello')).toString(16), '3610a686')
eq('crc32 continues across chunks', crc32(enc.encode('llo'), crc32(enc.encode('he'))).toString(16), '3610a686')
eq('crc32 of empty', crc32(new Uint8Array(0)), 0)

// ── build an archive of two files, one in a folder, one written in chunks ──
const chunks = []
const z = new ZipWriter(c => chunks.push(c))
z.startEntry('17WEST - 511/01 - living room.jpg', new Date(2026, 9, 27, 14, 30, 10))
z.write(enc.encode('hel')); z.write(enc.encode('lo'))
z.endEntry()
z.addText('README.txt', 'Stay Hospitality photo library')
z.finish()
const total = chunks.reduce((n, c) => n + c.length, 0)
const buf = new Uint8Array(total); { let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length } }
const dv = new DataView(buf.buffer)
eq('written counter matches bytes', z.written, total)

// end of central directory
const eocd = buf.length - 22
eq('EOCD signature', dv.getUint32(eocd, true).toString(16), '6054b50')
eq('two entries', dv.getUint16(eocd + 10, true), 2)
const cdSize = dv.getUint32(eocd + 12, true), cdStart = dv.getUint32(eocd + 16, true)
eq('central directory ends at EOCD', cdStart + cdSize, eocd)

// central directory entries
let p = cdStart
const entries = []
while (p < eocd) {
  eq('CD signature', dv.getUint32(p, true).toString(16), '2014b50')
  const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true)
  const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true)
  const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
  const off = dv.getUint32(p + 42, true)
  const name = dec.decode(buf.slice(p + 46, p + 46 + nlen))
  entries.push({ name, flags, method, crc, csize, usize, off })
  p += 46 + nlen + xlen + clen
}
eq('names, in order', entries.map(e => e.name), ['17WEST - 511/01 - living room.jpg', 'README.txt'])
eq('stored, data descriptor + utf-8 flags', entries.map(e => [e.method, e.flags.toString(16)]), [[0, '808'], [0, '808']])
eq('sizes', entries.map(e => [e.csize, e.usize]), [[5, 5], [30, 30]])
eq('crc of first entry', entries[0].crc.toString(16), '3610a686')

// local headers + data + descriptors, by offset
for (const e of entries) {
  eq('local header signature ' + e.name, dv.getUint32(e.off, true).toString(16), '4034b50')
  const nlen = dv.getUint16(e.off + 26, true), xlen = dv.getUint16(e.off + 28, true)
  const dataStart = e.off + 30 + nlen + xlen
  const data = buf.slice(dataStart, dataStart + e.usize)
  if (e.name.endsWith('.jpg')) eq('data of first entry', dec.decode(data), 'hello')
  const dd = dataStart + e.usize
  eq('data descriptor signature ' + e.name, dv.getUint32(dd, true).toString(16), '8074b50')
  eq('descriptor crc matches CD ' + e.name, dv.getUint32(dd + 4, true), e.crc)
  eq('descriptor size matches CD ' + e.name, dv.getUint32(dd + 8, true), e.usize)
}
eq('first entry starts at 0', entries[0].off, 0)
eq('second entry starts after first header+data+descriptor', entries[1].off, 30 + enc.encode('17WEST - 511/01 - living room.jpg').length + 5 + 16)

// dos time of the first entry (14:30:10 → seconds halved)
const t = dv.getUint16(entries[0].off + 10, true), d = dv.getUint16(entries[0].off + 12, true)
eq('dos time', [(t >> 11) & 31, (t >> 5) & 63, (t & 31) * 2], [14, 30, 10])
eq('dos date', [((d >> 9) & 127) + 1980, (d >> 5) & 15, d & 31], [2026, 10, 27])

// misuse
let threw = false; try { z.startEntry('x') } catch { threw = true }
eq('cannot write after finish', threw, true)
const z2 = new ZipWriter(() => {}); z2.startEntry('a'); threw = false; try { z2.startEntry('b') } catch { threw = true }
eq('cannot open two entries', threw, true)

// ── safe names ──
eq('safe name strips path and reserved characters', safeName('../../Living: room? <wide>/"best"'), 'Living room wide best')
eq('safe name fallback', safeName('   '), 'photo')
eq('safe name trims dots', safeName('...photo...'), 'photo')

console.log(`zip-stream: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
