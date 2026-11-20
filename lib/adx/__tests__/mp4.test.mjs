// node lib/adx/__tests__/mp4.test.mjs
// AD STUDIO REBUILD (Jon, 2026-11-20): the studio's own MP4 writer. Samples in, a file whose index points at exactly
// those samples out. (A real export from the browser's encoder is checked with ffprobe when the pieces are rendered.)
import { suite } from './_load.mjs'
const { muxMp4, mp4Boxes } = await import('../mp4.ts')
const { ok, eq, done } = suite('adx mp4')

const avcC = new Uint8Array([1, 0x64, 0, 0x2a, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x2a, 1, 0, 2, 0x68, 0xee])
const frame = (n, key) => ({ data: new Uint8Array(100 + n).fill(n + 1), dur: 3000, key })
const video = { width: 1080, height: 1920, timescale: 90000, avcC, samples: Array.from({ length: 75 }, (_, i) => frame(i, i % 30 === 0)) }
const audio = { sampleRate: 48000, channels: 2, asc: new Uint8Array([0x11, 0x90]), samples: Array.from({ length: 118 }, (_, i) => ({ data: new Uint8Array(40).fill(200 + (i % 50)), dur: 1024, key: true })) }
const find = (file, type) => { const s = String.fromCharCode(...file.subarray(0, Math.min(file.length, 6000))); const i = s.indexOf(type); return i }
const u32 = (f, o) => ((f[o] << 24) | (f[o + 1] << 16) | (f[o + 2] << 8) | f[o + 3]) >>> 0

const f = muxMp4({ video })
eq('boxes in order: the index comes before the data (fast start)', mp4Boxes(f).map(b => b.type), ['ftyp', 'moov', 'mdat'])
ok('box sizes add up to the file', mp4Boxes(f).reduce((n, b) => n + b.size, 0) === f.length)
const stco = find(f, 'stco'), n = u32(f, stco + 8), first = u32(f, stco + 12)
ok('three one-second chunks for 75 frames', n === 3)
ok('the first chunk offset points at the first frame’s bytes', f[first] === 1 && f[first + 99] === 1 && f[first + 100] === 2)
const second = u32(f, stco + 16)
ok('the second chunk starts at frame 30', f[second] === 31)
const stsz = find(f, 'stsz')
ok('every sample size is written', u32(f, stsz + 12) === 75 && u32(f, stsz + 16) === 100 && u32(f, stsz + 16 + 74 * 4) === 174)
const stss = find(f, 'stss')
eq('keyframes listed', [u32(f, stss + 8), u32(f, stss + 12), u32(f, stss + 16), u32(f, stss + 20)], [3, 1, 31, 61])
const stts = find(f, 'stts')
eq('constant frame duration: one run', [u32(f, stts + 8), u32(f, stts + 12), u32(f, stts + 16)], [1, 75, 3000])
const mvhd = find(f, 'mvhd')
eq('2.5 seconds at a 1000 timescale', [u32(f, mvhd + 16), u32(f, mvhd + 20)], [1000, 2500])
ok('the avcC record is embedded as given', (() => { const i = find(f, 'avcC'); return avcC.every((b, k) => f[i + 4 + k] === b) })())
const tkhd = find(f, 'tkhd')
eq('track size 1080 x 1920', [u32(f, tkhd + 80) >>> 16, u32(f, tkhd + 84) >>> 16], [1080, 1920])

const g = muxMp4({ video, audio })
eq('with sound: still three top-level boxes', mp4Boxes(g).map(b => b.type), ['ftyp', 'moov', 'mdat'])
ok('two tracks, a sound handler and an AAC entry', find(g, 'soun') > 0 && find(g, 'mp4a') > 0 && find(g, 'esds') > 0 && find(g, 'smhd') > 0)
ok('all bytes of both tracks are in the file', g.length - f.length > audio.samples.length * 40)
// the tracks interleave: the first audio chunk sits between the first and second video chunks
const text = String.fromCharCode(...g.subarray(0, 8000)); const s1 = text.indexOf('stco'), s2 = text.indexOf('stco', s1 + 4)
const v0 = u32(g, s1 + 12), v1 = u32(g, s1 + 16), a0 = u32(g, s2 + 12)
ok('sound and picture are interleaved by time', v0 < a0 && a0 < v1, { v0, a0, v1 })
ok('first audio chunk offset points at audio bytes', g[a0] === 200)

const throws = fn => { try { fn(); return false } catch { return true } }
ok('no samples → an error, not a broken file', throws(() => muxMp4({ video: { ...video, samples: [] } })))
ok('no encoder description → an error', throws(() => muxMp4({ video: { ...video, avcC: new Uint8Array(0) } })))
ok('first frame not a keyframe → an error', throws(() => muxMp4({ video: { ...video, samples: video.samples.map(s => ({ ...s, key: false })) } })))
done()
