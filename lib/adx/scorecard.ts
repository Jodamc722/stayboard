// AD STUDIO — THE CRAFT SCORE AND WHERE A PIECE CAN GO (Jon, 2026-11-21: "We need the best direction for ad
// generation with real audits and real top line designs. From posts, to videos to shorts").
//
// The measured check (lib/adx/audit) says whether a piece is CORRECT: it fits, it can be read, nothing is stretched.
// This file says how GOOD it is, and where it is ready to be posted, from things that can be measured on the piece
// itself. No model is asked, so it costs nothing and gives the same answer every time.
//
// THE CRAFT SCORE: six things a creative director looks for, each marked out of ten with the reason for every mark
// taken off, in words a person can act on:
//   first frame   is there a picture at once, how much of the frame it fills, when the headline lands, how long it is
//   hierarchy     is the headline clearly the largest thing in each scene, and large enough for a phone
//   composition   empty bands, timid photograph windows, words that do not line up
//   brand         the mark at the start and the end, one type pairing, a controlled palette, the right closing line
//   rhythm        scenes that turn (not the same slide twice), transitions kept to two kinds, readable pace
//   finish        things arriving late, what the measured check found, the song, the caption
// The same notes are handed to the creative director's review, so a redo aims at what was actually weak.
//
// WHERE IT CAN GO: for Reels, TikTok, Shorts, Stories, a feed post and a square, whether this piece is the right
// shape, clear of that platform's own buttons, and a length that works there. The figures are the ones social
// publishers work to (lengths: Hootsuite; button areas: published safe-zone guides); the platforms do not publish
// exact numbers, so the studio's own safe areas are deliberately wider than any of them.
// Pure and isomorphic.
import { CHANNELS, type ChannelKey, type Composition, type Scene, type Layer, type TextLayer, type Box } from './composition'
import { layoutText, logoHeight, type Measure } from './player'
import { auditComposition, deadBand, type AuditResult } from './audit'

export type ScorePart = { key: 'first' | 'hierarchy' | 'composition' | 'brand' | 'rhythm' | 'finish'; label: string; score: number; notes: string[] }
export type Scorecard = { total: number; parts: ScorePart[]; /** what to fix first, at most three */ top: string[] }

const wordsOf = (l: TextLayer) => l.runs.map(r => ('br' in r ? ' ' : r.t)).join('').replace(/\s+/g, ' ').trim()
const isVideo = (doc: Composition, l: Layer) => l.type === 'photo' && doc.assets.photos[l.photo]?.kind === 'video'
const isPicture = (doc: Composition, l: Layer) => l.type === 'photo' && (doc.assets.photos[l.photo]?.source !== 'upload' || isVideo(doc, l))
const shareOf = (doc: Composition, b: Box) => { const W = doc.canvas.w, H = doc.canvas.h; return (Math.max(0, Math.min(W, b.x + b.w) - Math.max(0, b.x)) * Math.max(0, Math.min(H, b.y + b.h) - Math.max(0, b.y))) / (W * H) }
const pct = (v: number) => Math.round(v * 100) + '%'
const name = (s: Scene) => '“' + s.name + '”'

export function scorePiece(doc: Composition, measure: Measure, audit?: AuditResult): Scorecard {
  const S = doc.scenes, W = doc.canvas.w, H = doc.canvas.h, u = W / 1080
  const A = audit || auditComposition(doc, measure)
  const part = (key: ScorePart['key'], label: string): ScorePart & { off: (n: number, why: string) => void } => {
    const p = { key, label, score: 10, notes: [] as string[], off: (n: number, why: string) => { p.score = Math.max(0, Math.round((p.score - n) * 10) / 10); p.notes.push(why) } }
    return p
  }
  const first = part('first', 'First frame'), hier = part('hierarchy', 'Hierarchy'), comp = part('composition', 'Composition'), brand = part('brand', 'Brand'), rhythm = part('rhythm', 'Rhythm'), finish = part('finish', 'Finish')
  if (!S.length) return { total: 0, parts: [first, hier, comp, brand, rhythm, finish].map(({ off: _o, ...p }) => ({ ...p, score: 0 })), top: ['There is nothing to show yet.'] }
  const heads = (s: Scene) => s.layers.filter((l): l is TextLayer => l.type === 'text' && !!l.fit)
  const labels = (s: Scene) => s.layers.filter((l): l is TextLayer => l.type === 'text' && !l.fit)
  const sizeOf = (l: TextLayer) => layoutText(doc, l, measure).size
  const still = S.length === 1

  // ── 1. the first frame ──
  const s1 = S[0]
  const there = (l: Layer) => !l.in || (l.in.at <= 0.01 && l.in.preset === 'fade')
  const pic1 = s1.layers.filter(l => isPicture(doc, l))
  if (!s1.layers.some(l => (l.type === 'photo' || l.type === 'shape' || l.type === 'vector') && there(l))) first.off(4, 'The first frame is a plain ground. Open on the picture, already on screen.')
  else if (pic1.length && !pic1.some(there)) first.off(2, 'The opening photograph is still arriving in the first frame. Let it be there from the start.')
  if (pic1.length) { const sh = Math.max(...pic1.map(l => shareOf(doc, (l as { box: Box }).box))); if (sh < 0.25) first.off(2, `The opening picture fills only ${pct(sh)} of the frame. Let it carry more of it.`) }
  const hook = heads(s1)[0]
  if (!hook) first.off(3, 'The first scene has no headline: nothing says what this is.')
  else {
    const lands = hook.in ? hook.in.at + hook.in.dur : 0
    if (!still && lands > 1.5) first.off(lands > 2 ? 3 : 2, `The opening headline has not landed until ${lands.toFixed(1)} s. People decide in about a second and a half.`)
    const n = heads(s1).map(wordsOf).join(' ').split(/\s+/).filter(Boolean).length
    if (n > 7) first.off(3, `The opening headline is ${n} words. Aim for two to five.`); else if (n > 5) first.off(1, `The opening headline is ${n} words. Two to five lands faster.`)
  }

  // ── 2. hierarchy ──
  let weak = 0, small = 0, none = 0
  for (const s of S) {
    const hs = heads(s), ls = labels(s)
    if (!hs.length) { if (!s.layers.some(l => isVideo(doc, l))) none++; continue }
    const big = Math.max(...hs.map(sizeOf)), lab = ls.length ? Math.max(...ls.map(sizeOf)) : 0
    if (lab && big / lab < 2.2 && weak < 3) { weak++; hier.off(1, `In ${name(s)} the headline is only ${(big / lab).toFixed(1)}× the size of its label. Make it at least 2.5×.`) }
    if (big < 72 * u && small < 3) { small++; hier.off(1, `In ${name(s)} the headline is ${Math.round(big)} px: small on a phone.`) }
  }
  if (none > 1) hier.off(Math.min(3, none - 1), `${none} scenes have no headline.`)

  // ── 3. composition ──
  let band = 0, bandIn: Scene | null = null
  for (const s of S) { const [a, b] = deadBand(doc, s, measure); if ((b - a) / H > band) { band = (b - a) / H; bandIn = s } }
  if (band > 0.2) comp.off(4, `${name(bandIn!)} leaves ${pct(band)} of the frame empty in one band.`)
  else if (band > 0.16) comp.off(1, `${name(bandIn!)} has an empty band ${pct(band)} of the frame tall. Carry colour or the photograph into it.`)
  const shares = S.map(s => { const p = s.layers.filter(l => isPicture(doc, l)); return p.length ? Math.max(...p.map(l => shareOf(doc, (l as { box: Box }).box))) : -1 }).filter(v => v >= 0)
  if (shares.length) { const avg = shares.reduce((a, b) => a + b, 0) / shares.length; if (avg < 0.2) comp.off(2, `Photographs sit in small windows (${pct(avg)} of the frame on average). Give the strongest ones more room.`) }
  let ragged = 0
  for (const s of S) {
    const xs: number[] = []
    for (const l of s.layers) if ((l.type === 'text' && (l.align || 'left') === 'left') || (l.type === 'logo' && l.box.w <= 220 * u)) { const x = l.box.x; if (!xs.some(v => Math.abs(v - x) <= 8 * u)) xs.push(x) }
    if (xs.length > 3 && ragged < 2) { ragged++; comp.off(1, `In ${name(s)} the words start at ${xs.length} different left edges. Line them up on one or two.`) }
  }

  // ── 4. brand ──
  const hasLogo = (s: Scene) => s.layers.some(l => l.type === 'logo')
  if (!S.some(hasLogo)) brand.off(4, 'The Stay logo is not in the piece.')
  else { if (!hasLogo(S[S.length - 1])) brand.off(2, 'The last scene has no logo.'); if (!still && !hasLogo(S[0])) brand.off(1, 'The first scene has no logo.') }
  const fams = new Set<string>()
  for (const s of S) for (const l of s.layers) if (l.type === 'text') { const t = (doc.tokens.type as Record<string, { family?: string }>)[l.style]; if (t?.family) fams.add(t.family); for (const r of l.runs) if (!('br' in r) && r.style) { const t2 = (doc.tokens.type as Record<string, { family?: string }>)[r.style]; if (t2?.family) fams.add(t2.family) } }
  if (fams.size > 3) brand.off(2, `${fams.size} typefaces in one piece. Two, and a label face, is the house way.`)
  let busy = 0
  for (const s of S) { const cs = new Set<string>(); for (const l of s.layers) if (l.type === 'text') { cs.add(l.color); for (const r of l.runs) if (!('br' in r) && r.color) cs.add(r.color) } if (cs.size > 3 && busy < 2) { busy++; brand.off(1, `${name(s)} sets its words in ${cs.size} colours. One colour and one accent.`) } }
  for (const c of ['end-cta', 'banned-word', 'banned-spoken', 'price', 'phone', 'channels-unnamed', 'photo-area', 'photo-source']) { const hit = A.issues.find(x => x.code === c); if (hit) brand.off(3, hit.msg) }

  // ── 5. rhythm ──
  const sig = (s: Scene) => { const p = s.layers.find(l => isPicture(doc, l)) as { box: Box } | undefined, h = heads(s)[0], g = s.layers.find(l => l.type === 'fill'); return [g && g.type === 'fill' ? g.color : '', p ? Math.round(p.box.y / (H / 6)) + ':' + Math.round(p.box.h / (H / 6)) + ':' + Math.round(p.box.w / (W / 4)) : 'none', h ? Math.round(h.box.y / (H / 6)) + ':' + (h.align || 'left') : 'none'].join('|') }
  let same = 0
  for (let i = 1; i < S.length; i++) if (sig(S[i]) === sig(S[i - 1]) && same < 2) { same++; rhythm.off(2, `${name(S[i - 1])} and ${name(S[i])} are laid out the same way on the same ground. Turn the layout or change the ground.`) }
  const kinds = new Set(S.map(s => s.transitionIn.type).filter(t => t !== 'none' && t !== 'cut'))
  if (kinds.size > 2) rhythm.off(3, `${kinds.size} kinds of transition. Keep to two.`)
  const end = S[S.length - 1]
  if (!still) {
    if (end.dur < 3.2) rhythm.off(2, `The last scene holds ${end.dur.toFixed(1)} s. Give it at least 3.2 s to be read and acted on.`)
    let fast = 0
    for (const s of S) {
      const n = s.layers.filter((l): l is TextLayer => l.type === 'text').map(wordsOf).join(' ').split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length
      if (n / s.dur > 4 && fast < 2) { fast++; rhythm.off(1, `${name(s)} asks people to read ${n} words in ${s.dur.toFixed(1)} s.`) }
    }
    if (S.slice(0, -1).some(s => s.dur > 6 && !s.layers.some(l => isVideo(doc, l)))) rhythm.off(1, 'A scene with a still picture holds for more than six seconds. Cut it or split it.')
    for (const x of A.issues.filter(i => i.code === 'vo-fast').slice(0, 2)) rhythm.off(1, x.msg)
  }

  // ── 6. finish ──
  let late = 0
  for (const s of S) {
    const n = s.layers.filter(l => l.in && s.dur - l.in.at - l.in.dur < 1).length
    if (n && late < 3) { const take = Math.min(n, 3 - late); late += take; finish.off(take, `${n === 1 ? 'Something' : n + ' things'} in ${name(s)} ${n === 1 ? 'is' : 'are'} still arriving in its last second. Bring ${n === 1 ? 'it' : 'them'} in sooner or hold the scene longer.`) }
  }
  const fails = A.issues.filter(x => x.sev === 'fail'), warns = A.issues.filter(x => x.sev === 'warn' && x.code !== 'late-entrance' && x.code !== 'vo-fast')
  if (fails.length) finish.off(Math.min(6, fails.length * 2), `The measured check has ${fails.length} thing${fails.length === 1 ? '' : 's'} to fix.`)
  if (warns.length) finish.off(Math.min(2, warns.length * 0.5), `The measured check left ${warns.length} note${warns.length === 1 ? '' : 's'}.`)
  if (!still && !doc.assets.audio.music.track && !hasSound(doc)) finish.off(1, 'There is no song.')
  if (!doc.social.caption.trim()) finish.off(1, 'There is no caption.')
  else if (doc.social.hashtags.length > 6) finish.off(0.5, `${doc.social.hashtags.length} hashtags. Three to five is plenty.`)

  const parts = [first, hier, comp, brand, rhythm, finish].map(({ off: _o, ...p }) => p)
  const total = Math.round((parts.reduce((a, p) => a + p.score, 0) / 60) * 100)
  // what to fix first: one thing from each of the weakest marks (what the measured check found is listed beside
  // the picture already, so its count is not repeated here)
  const top = parts.filter(p => p.score < 10).sort((a, b) => a.score - b.score).map(p => p.notes.find(n => !/^The measured check /.test(n)) || '').filter(Boolean).slice(0, 3)
  return { total, parts, top }
}
const hasSound = (doc: Composition) => doc.scenes.some(s => s.layers.some(l => l.type === 'photo' && !!l.clip && Number(l.clip.sound) > 0))

/** The craft notes as lines for the creative director's review (what was weak, measured). */
export const craftLines = (c: Scorecard) => c.parts.flatMap(p => p.notes.map(n => `- [craft: ${p.label.toLowerCase()}] ${n}`)).join('\n')

// ── where it can go ─────────────────────────────────────────────────────────────────────────────────────────────
export type PlatformKey = 'reels' | 'tiktok' | 'shorts' | 'story' | 'feed' | 'square'
type Inset = { top: number; bottom: number; left: number; right: number }
export type Platform = { key: PlatformKey; label: string; /** the studio shape it takes */ channel: ChannelKey; /** seconds that work best there */ best: [number, number]; /** the longest it takes */ max: number; /** its own buttons, on a 1080-wide frame */ chrome: Inset; soundOn: boolean }
export const PLATFORMS: Platform[] = [
  { key: 'reels', label: 'Instagram Reels', channel: 'vertical', best: [15, 45], max: 1200, chrome: { top: 210, bottom: 310, left: 0, right: 84 }, soundOn: true },
  { key: 'tiktok', label: 'TikTok', channel: 'vertical', best: [20, 35], max: 600, chrome: { top: 108, bottom: 320, left: 60, right: 120 }, soundOn: true },
  { key: 'shorts', label: 'YouTube Shorts', channel: 'vertical', best: [15, 45], max: 180, chrome: { top: 120, bottom: 300, left: 0, right: 96 }, soundOn: true },
  { key: 'story', label: 'Stories', channel: 'story', best: [5, 15], max: 60, chrome: { top: 100, bottom: 200, left: 0, right: 0 }, soundOn: false },
  { key: 'feed', label: 'Feed post 4:5', channel: 'feed', best: [6, 60], max: 3600, chrome: { top: 0, bottom: 0, left: 0, right: 0 }, soundOn: false },
  { key: 'square', label: 'Square 1:1', channel: 'square', best: [6, 60], max: 3600, chrome: { top: 0, bottom: 0, left: 0, right: 0 }, soundOn: false },
]
export type Fit = { key: PlatformKey; label: string; channel: ChannelKey; state: 'ready' | 'notes' | 'shape'; notes: string[] }

/** For each place a piece can be posted: ready, ready with notes, or needs another shape (which reflow makes). */
export function platformFit(doc: Composition): Fit[] {
  const W = doc.canvas.w, H = doc.canvas.h, u = W / 1080, dur = doc.canvas.duration, still = doc.scenes.length === 1
  const tall = Math.abs(W / H - 9 / 16) < 0.01
  return PLATFORMS.map(p => {
    const c = CHANNELS[p.channel], notes: string[] = []
    const shape = Math.abs(W / H - c.w / c.h) < 0.01
    if (!shape) return { key: p.key, label: p.label, channel: p.channel, state: 'shape' as const, notes: [`Needs the ${p.channel === 'vertical' || p.channel === 'story' ? '9:16' : p.channel === 'feed' ? '4:5' : '1:1'} shape.`] }
    // under the platform's own buttons?
    if (tall) {
      const x0 = p.chrome.left * u, x1 = W - p.chrome.right * u, y0 = p.chrome.top * u, y1 = H - p.chrome.bottom * u
      const under = new Set<string>()
      for (const s of doc.scenes) for (const l of s.layers) {
        if (l.type !== 'text' && l.type !== 'logo' && l.type !== 'button') continue
        const h = l.type === 'logo' ? logoHeight(l) : l.box.h
        if (l.box.x < x0 - 1 || l.box.x + l.box.w > x1 + 1 || l.box.y < y0 - 1 || l.box.y + h > y1 + 1) under.add(s.name)
      }
      if (under.size) notes.push(`Words in ${Array.from(under).slice(0, 2).map(n => '“' + n + '”').join(' and ')} sit under ${p.label}’ own buttons. Make the ${p.channel === 'story' ? 'Story' : 'Vertical'} shape for it.`)
    }
    if (!still) {
      if (dur > p.max) notes.push(`Runs ${dur.toFixed(0)} s; ${p.label} takes up to ${p.max} s.`)
      else if (dur < p.best[0] - 0.5) notes.push(`Runs ${dur.toFixed(0)} s. ${p.label} does best at ${p.best[0]} to ${p.best[1]} s.`)
      else if (dur > p.best[1] + 0.5) notes.push(`Runs ${dur.toFixed(0)} s. ${p.label} does best at ${p.best[0]} to ${p.best[1]} s.`)
      if (p.soundOn && !doc.assets.audio.music.track && !hasSound(doc)) notes.push('No sound: this feed plays with sound on.')
    }
    return { key: p.key, label: p.label, channel: p.channel, state: notes.length ? 'notes' as const : 'ready' as const, notes }
  })
}
