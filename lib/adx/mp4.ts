// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// A minimal MP4 writer, written for this studio so no muxing library is added to the app. It takes the H.264 samples
// the browser's own encoder produced (WebCodecs, AVCC framing) and, optionally, AAC samples, and writes a plain
// (non-fragmented) MP4 with the index first ("fast start"), which is what Instagram, TikTok and YouTube expect.
// One video track, one optional audio track, constant frame rate, no B-frames. Pure; no imports.

export type Mp4Sample = { data: Uint8Array; /** in the track's timescale */ dur: number; key?: boolean }
export type Mp4Video = { width: number; height: number; timescale: number; /** the avcC record from the encoder's decoderConfig.description */ avcC: Uint8Array; samples: Mp4Sample[] }
export type Mp4Audio = { sampleRate: number; channels: number; /** AudioSpecificConfig from the encoder's decoderConfig.description */ asc: Uint8Array; samples: Mp4Sample[] }

const u16 = (n: number) => [(n >>> 8) & 255, n & 255]
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const str = (s: string) => Array.from(s).map(c => c.charCodeAt(0) & 255)
const zeros = (n: number) => new Array(n).fill(0)
type Part = number[] | Uint8Array
function cat(parts: Part[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length
  const out = new Uint8Array(n); let o = 0
  for (const p of parts) { out.set(p as ArrayLike<number>, o); o += p.length }
  return out
}
function box(type: string, ...parts: Part[]): Uint8Array { const body = cat(parts); return cat([u32(body.length + 8), str(type), body]) }
const full = (type: string, version: number, flags: number, ...parts: Part[]) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts)
const MATRIX = [...u32(0x00010000), ...zeros(12), ...u32(0x00010000), ...zeros(12), ...u32(0x40000000)]

/** Run-length table of sample durations. */
function stts(samples: Mp4Sample[]): Uint8Array {
  const runs: [number, number][] = []
  for (const s of samples) { const last = runs[runs.length - 1]; if (last && last[1] === s.dur) last[0]++; else runs.push([1, s.dur]) }
  return full('stts', 0, 0, u32(runs.length), ...runs.map(r => [...u32(r[0]), ...u32(r[1])]))
}
function stsc(chunkSizes: number[]): Uint8Array {
  const rows: [number, number][] = []
  chunkSizes.forEach((n, i) => { if (!rows.length || rows[rows.length - 1][1] !== n) rows.push([i + 1, n]) })
  return full('stsc', 0, 0, u32(rows.length), ...rows.map(r => [...u32(r[0]), ...u32(r[1]), ...u32(1)]))
}
/** An MPEG-4 descriptor: tag, a four-byte length, the payload. */
const desc = (tag: number, ...parts: Part[]) => { const body = cat(parts); return cat([[tag, 0x80, 0x80, 0x80, body.length & 0x7f], body]) }

type Track = { id: number; kind: 'v' | 'a'; timescale: number; samples: Mp4Sample[]; chunks: number[][]; stsd: Uint8Array; width: number; height: number }

function trak(t: Track, movieScale: number, offsets: number[]): Uint8Array {
  const dur = t.samples.reduce((a, s) => a + s.dur, 0)
  const movieDur = Math.round((dur / t.timescale) * movieScale)
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(t.kind === 'a' ? 0x0100 : 0), u16(0), MATRIX, u32(t.width << 16), u32(t.height << 16))
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(dur), u16(0x55c4), u16(0))
  const hdlr = full('hdlr', 0, 0, u32(0), str(t.kind === 'v' ? 'vide' : 'soun'), zeros(12), str(t.kind === 'v' ? 'VideoHandler' : 'SoundHandler'), [0])
  const mhd = t.kind === 'v' ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4))
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)))
  const keys = t.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean)
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), t.stsd),
    stts(t.samples),
    ...(t.kind === 'v' && keys.length && keys.length < t.samples.length ? [full('stss', 0, 0, u32(keys.length), ...keys.map(k => u32(k)))] : []),
    stsc(t.chunks.map(c => c.length)),
    full('stsz', 0, 0, u32(0), u32(t.samples.length), ...t.samples.map(s => u32(s.data.length))),
    full('stco', 0, 0, u32(offsets.length), ...offsets.map(o => u32(o))),
  )
  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', mhd, dinf, stbl)))
}

/** Samples in, a finished .mp4 out. Throws on input it cannot write correctly (so the caller can fall back). */
export function muxMp4(input: { video: Mp4Video; audio?: Mp4Audio | null }): Uint8Array {
  const v = input.video, a = input.audio && input.audio.samples.length ? input.audio : null
  if (!v.samples.length) throw new Error('mp4: no video samples')
  if (!v.avcC || v.avcC.length < 7 || v.avcC[0] !== 1) throw new Error('mp4: the encoder gave no H.264 configuration')
  if (!v.samples[0].key) throw new Error('mp4: the first frame is not a keyframe')
  const MOVIE = 1000

  const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(v.width), u16(v.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
    box('avcC', v.avcC))          // colour primaries and range are carried in the H.264 stream itself; nothing is restated here
  const tracks: Track[] = [{ id: 1, kind: 'v', timescale: v.timescale, samples: v.samples, chunks: [], stsd: avc1, width: v.width, height: v.height }]
  if (a) {
    const esds = full('esds', 0, 0, desc(0x03, u16(2), [0], desc(0x04, [0x40, 0x15], zeros(3), u32(192000), u32(192000), desc(0x05, a.asc)), desc(0x06, [0x02])))
    const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(a.channels), u16(16), u16(0), u16(0), u32(a.sampleRate << 16 >>> 0), esds)
    tracks.push({ id: 2, kind: 'a', timescale: a.sampleRate, samples: a.samples, chunks: [], stsd: mp4a, width: 0, height: 0 })
  }
  // chunks of about a second each, so the two tracks interleave in the file
  for (const t of tracks) {
    let cur: number[] = [], acc = 0
    t.samples.forEach((s, i) => { cur.push(i); acc += s.dur; if (acc >= t.timescale) { t.chunks.push(cur); cur = []; acc = 0 } })
    if (cur.length) t.chunks.push(cur)
  }
  // the order the chunks are written in: by the time they start
  const order: { t: Track; ci: number; at: number }[] = []
  for (const t of tracks) { let at = 0; t.chunks.forEach((c, ci) => { order.push({ t, ci, at: at / t.timescale }); for (const i of c) at += t.samples[i].dur }) }
  order.sort((x, y) => x.at - y.at || x.t.id - y.t.id)

  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'))
  const movieDur = Math.max(...tracks.map(t => Math.round((t.samples.reduce((n, s) => n + s.dur, 0) / t.timescale) * MOVIE)))
  const moovWith = (offs: Map<Track, number[]>) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1)),
    ...tracks.map(t => trak(t, MOVIE, offs.get(t) || t.chunks.map(() => 0))))
  // the index comes first, so its size has to be known before the offsets it holds: build it twice
  const size = moovWith(new Map()).length
  let at = ftyp.length + size + 8
  const offs = new Map<Track, number[]>(tracks.map(t => [t, new Array(t.chunks.length).fill(0)]))
  const payload: Uint8Array[] = []
  for (const o of order) {
    offs.get(o.t)![o.ci] = at
    for (const i of o.t.chunks[o.ci]) { const d = o.t.samples[i].data; payload.push(d); at += d.length }
  }
  const dataLen = at - (ftyp.length + size + 8)
  if (at > 0xffffffff) throw new Error('mp4: file too large for this writer')
  const moov = moovWith(offs)
  if (moov.length !== size) throw new Error('mp4: index size changed')
  return cat([ftyp, moov, u32(dataLen + 8), str('mdat'), ...payload])
}

/** The top-level boxes of a file (for tests and for checking a finished export). */
export function mp4Boxes(file: Uint8Array): { type: string; at: number; size: number }[] {
  const out: { type: string; at: number; size: number }[] = []
  let o = 0
  while (o + 8 <= file.length) {
    const size = ((file[o] << 24) | (file[o + 1] << 16) | (file[o + 2] << 8) | file[o + 3]) >>> 0
    if (size < 8) break
    out.push({ type: String.fromCharCode(file[o + 4], file[o + 5], file[o + 6], file[o + 7]), at: o, size }); o += size
  }
  return out
}
