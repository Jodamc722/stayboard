// AD STUDIO — THE ENGINE (Jon, 2026-11-02: "build a video editor for ads … prompt, have you write
// scripts, get previews … think Final Cut Pro but AI, built for custom ads").
//
// One pure drawing function, drawFrame(ctx, project, timeline, t, assets), is the whole renderer. The
// live preview calls it on every animation frame; the export calls the very same function while a
// MediaRecorder captures the canvas. So what you preview is, frame for frame, what you download —
// there is no second "render" path that can drift from the editor.
//
// Client-safe: no server imports. The API routes import the types and the timing maths from here too,
// so the AI writer, the voice route and the editor all agree on what a scene is.
//
// THE RULES THAT CAME OUT OF THE OCTOBER SALES VIDEOS, built in rather than remembered:
//  - One continuous voice take; scenes are cut to the words (scene starts 0.35 s before its line).
//  - The music ducks under the voice and fades out over the end card — never stops dead.
//  - The STAY mark is gold in video, transparent, no chip. The end card is Nick's card.
//  - Words the voice says wrong are respelled for the voice only (SPOKEN below), never on screen.

export type AdKind = 'title' | 'photo' | 'stats' | 'wall' | 'cards' | 'feed' | 'checks' | 'rise' | 'contact' | 'cta'
export type AdAudience = 'owners' | 'partners' | 'guests'
export type AdFormat = '16:9' | '9:16' | '1:1' | '4:5'
export type AdScene = {
  id: string
  kind: AdKind
  /** What the voice says over this scene. Empty = a music-only beat. */
  vo: string
  /** On-screen headline. Wrap a word in **double stars** to make it gold. A newline forces a break. */
  head: string
  sub: string
  /** Per-kind rows: stats "450+|listings", cards "Priced daily|Dedicated revenue managers", feed/checks "Title|detail". */
  items: string[]
  /** Photo URLs (Guesty / Cloudinary), drawn through the same-origin image proxy. */
  photos: string[]
  /** Seconds, used only when there is no voice track yet (the voice decides timing once it exists). */
  dur?: number | null
  /** A sound effect that plays as the scene lands ('snd:<path>' from the Sounds library). */
  sfx?: string
}
export type AdContact = { name: string; role: string; phone: string; email: string; photo: string }
export type AdVoice = {
  path: string
  /** Signature of the script + voice the take was made from; a change makes the take stale. */
  sig: string
  voiceId: string
  /** Per scene, seconds into the take where its line starts / ends (null for a silent beat). */
  starts: (number | null)[]
  ends: (number | null)[]
  dur: number
}
export type AdProject = {
  id: string
  name: string
  prompt: string
  format: AdFormat
  voiceId: string
  /** The voice's display name (library voices are not all in VOICES). */
  voiceName?: string
  /** ElevenLabs delivery: steadier ↔ more expressive, and pace. */
  voiceSettings: { stability: number; style: number; speed: number }
  music: string
  musicVol: number
  captions: boolean
  /** Who the ad speaks to — decides the facts, the rules and the end card. */
  audience: AdAudience
  scenes: AdScene[]
  contact: AdContact
  voice: AdVoice | null
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export const FORMATS: Record<AdFormat, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] }
export const FORMAT_LABEL: Record<AdFormat, string> = { '16:9': 'Landscape 16:9 · YouTube, web', '9:16': 'Vertical 9:16 · Reels, TikTok, Stories', '1:1': 'Square 1:1 · Feed posts', '4:5': 'Portrait 4:5 · Instagram and Facebook feed' }

/** Voices from the ElevenLabs library (paid plan). Victoria is the house sales voice (Jon, 2026-10-29). */
export const VOICES: { id: string; name: string; blurb: string }[] = [
  { id: 'qSeXEcewz7tA0Q0qk9fH', name: 'Victoria', blurb: 'Warm, trustworthy · the house sales voice' },
  { id: 'rCuVrCHOUMY3OwyJBJym', name: 'Mia', blurb: 'Clear, smooth, polished' },
  { id: 'NtS6nEHDYMQC9QczMQuq', name: 'Katherine', blurb: 'Calm luxury narrator · British' },
  { id: 'SSfU0eLfP3qeuR4j2bwD', name: 'Christopher', blurb: 'Smooth, deep · male' },
  { id: 'c1uwEpPUcC16tq1udqxk', name: 'Harper', blurb: 'Eve’s training voice · cool, clear' },
]
const KM = (t: string) => `Music: “${t}” by Kevin MacLeod (incompetech.com) · CC BY 4.0`
/** The bundled tracks (royalty-free, credit printed on the end card). Generated tracks live in the Sounds library. */
export const MUSIC: { key: string; label: string; file: string; credit: string; mood: string }[] = [
  { key: 'werq', label: 'Werq', mood: 'Upbeat groove', file: '/ads/music/werq.mp3', credit: KM('Werq') },
  { key: 'backbay', label: 'Backbay Lounge', mood: 'Lounge, upscale', file: '/ads/music/backbay-lounge.mp3', credit: KM('Backbay Lounge') },
  { key: 'moonlight', label: 'Moonlight Beach', mood: 'Island, easy', file: '/ads/music/moonlight-beach.mp3', credit: KM('Moonlight Beach') },
  { key: 'inspired', label: 'Inspired', mood: 'Uplifting piano', file: '/ads/music/inspired.mp3', credit: KM('Inspired') },
  { key: 'wallpaper', label: 'Wallpaper', mood: 'Light, bright', file: '/ads/music/wallpaper.mp3', credit: KM('Wallpaper') },
  { key: 'funkorama', label: 'Funkorama', mood: 'Funky, fun', file: '/ads/music/funkorama.mp3', credit: KM('Funkorama') },
  { key: 'none', label: 'No music', mood: '', file: '', credit: '' },
]
export const VOICE_DEFAULTS = { stability: 0.5, style: 0.2, speed: 1 }
export const KINDS: { kind: AdKind; label: string; hint: string }[] = [
  { kind: 'title', label: 'Title', hint: 'Big headline over a photo. **Gold** words, one line per beat.' },
  { kind: 'photo', label: 'Photo', hint: 'One photo full-bleed, headline in the lower third.' },
  { kind: 'stats', label: 'Numbers', hint: 'Figures that count up. Rows: 450+|listings' },
  { kind: 'wall', label: 'Photo wall', hint: 'A grid of photos. Rows (optional) name each tile.' },
  { kind: 'cards', label: 'Three cards', hint: 'Up to three photo cards that land with the words. Rows: Title|line' },
  { kind: 'feed', label: 'Live feed', hint: 'Cards that slide in, like Lighthouse at work. Rows: Title|detail' },
  { kind: 'checks', label: 'Checklist', hint: 'Items that tick off, beside a photo. Rows: item' },
  { kind: 'rise', label: 'Results', hint: 'Headline with a rising line. Rows become chips.' },
  { kind: 'contact', label: 'Contact card', hint: 'The end card: photo, Book a call, number, email.' },
  { kind: 'cta', label: 'Book now', hint: 'Guest end card / social post: photo, headline, a button. Row 1 is the button text.' },
]

// ── Words the voice says wrong (October 2026 sessions). Applied to what the voice reads only. ──
const SPOKEN: [RegExp, string][] = [
  [/\bArt Basel\b/g, 'Art Bahzel'],
  [/\bVrbo\b/g, 'Verbo'],
  [/\bAI\b/g, 'A.I.'],
  [/\bPompano\b/g, 'Pompuhno'],
  [/\bSalato\b/g, 'Sah-lah-toe'],
]
const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
/** A US phone number is read digit by digit ("six five one, two zero zero, …"), the way people say them. */
function speakPhones(s: string): string {
  return s.replace(/\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-](\d{4})\b/g, (_m, a: string, b: string, c: string) =>
    [a, b, c].map(g => g.split('').map(d => DIGIT[+d]).join(' ')).join(', '))
}
export function spokenText(vo: string): string {
  let s = String(vo || '')
  for (let i = 0; i < SPOKEN.length; i++) s = s.replace(SPOKEN[i][0], SPOKEN[i][1])
  return speakPhones(s)
}
/** Words in the script the voice is known to stumble on — shown as a warning beside the line. */
export function riskyWords(vo: string): string[] {
  const out: string[] = []
  if (/\bSalato\b/i.test(vo)) out.push('Salato')
  if (/\bPompano\b/i.test(vo)) out.push('Pompano Beach')
  return out
}

export function voiceSig(p: Pick<AdProject, 'scenes' | 'voiceId'> & { voiceSettings?: AdProject['voiceSettings'] }): string {
  const vs = (p as any).voiceSettings || {}
  const s = p.voiceId + '|' + [vs.stability, vs.style, vs.speed].join(',') + '|' + p.scenes.map(x => x.vo.trim()).join('¶')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + ':' + p.scenes.length
}
export const LEAD = 0.6       // the voice starts this far into the video
export const PRE = 0.35       // a scene appears this long before its line
export const TAIL = 4.8       // the end card holds this long after the last word
export const XFADE = 0.5      // crossfade between scenes

export type Timeline = { starts: number[]; durs: number[]; total: number; voiced: boolean; voEnd: number; spans: { from: number; to: number }[] }

/** When each scene starts and how long it holds. The voice decides, once there is a current take. */
export function timeline(p: AdProject): Timeline {
  const n = p.scenes.length
  const v = p.voice && p.voice.sig === voiceSig(p) ? p.voice : null
  const starts: number[] = []
  const spans: { from: number; to: number }[] = []
  let voEnd = 0
  if (v && n) {
    let prevEnd = 0
    for (let i = 0; i < n; i++) {
      const s = v.starts[i], e = v.ends[i]
      if (i === 0) starts.push(0)
      else if (s == null) starts.push(LEAD + prevEnd + 0.45)
      else starts.push(Math.max(starts[i - 1] + 1, LEAD + s - PRE))
      if (s != null && e != null) { spans.push({ from: LEAD + s, to: LEAD + e }); prevEnd = e; voEnd = LEAD + e }
    }
    const total = Math.max(voEnd + TAIL, starts[n - 1] + 2.5)
    const durs = starts.map((s, i) => (i < n - 1 ? starts[i + 1] : total) - s)
    return { starts, durs, total, voiced: true, voEnd, spans }
  }
  let t = 0
  const durs: number[] = []
  for (let i = 0; i < n; i++) {
    const sc = p.scenes[i]
    const words = sc.vo.trim() ? sc.vo.trim().split(/\s+/).length : 0
    let d = sc.dur && sc.dur > 0 ? sc.dur : words ? words / 2.55 + 1.0 : 2.6
    if (i === n - 1) d += sc.dur && sc.dur > 0 ? 0 : 2.5
    starts.push(t); durs.push(d); t += d
  }
  return { starts, durs, total: t, voiced: false, voEnd: t - 2, spans: [] }
}

/** A blank project with the house defaults. */
export function blankProject(id: string, by: string, contact: AdContact): AdProject {
  const now = new Date().toISOString()
  return {
    id, name: 'Untitled ad', prompt: '', format: '16:9', voiceId: VOICES[0].id, music: 'werq', musicVol: 0.28, captions: true, audience: 'owners', voiceSettings: { ...VOICE_DEFAULTS },
    scenes: [
      { id: 's1', kind: 'title', vo: 'More revenue. A lower fee. One complete team. This is Stay Hospitality.', head: 'More **revenue.**\nLower **fee.**\nOne complete **team.**', sub: '', items: [], photos: [] },
      { id: 's2', kind: 'contact', vo: 'Book a call, and let’s see what your property can earn.', head: 'Book a **call.**', sub: '', items: [], photos: [] },
    ],
    contact, voice: null, createdAt: now, updatedAt: now, updatedBy: by,
  }
}
export function newSceneId(p: AdProject): string {
  let i = p.scenes.length + 1
  while (p.scenes.some(s => s.id === 's' + i)) i++
  return 's' + i
}

// ───────────────────────────── drawing ─────────────────────────────
export type AdAssets = {
  /** Returns a loaded image for a URL, or null while it is still loading. */
  img: (url: string) => HTMLImageElement | null
  /** A scene's media — a photo, or a library video ('video:…') synced to the scene's own clock. */
  media?: (url: string, local: number) => HTMLImageElement | HTMLVideoElement | null
  logo: HTMLImageElement | null
  display: string
  body: string
  mono: string
  credit: string
}
const C = { gold: '#D2B077', ink: '#F2EEE6', mut: '#A9B8C6', navy: '#0D2131', navy2: '#132E44', glass: 'rgba(10,26,40,0.62)', line: 'rgba(255,255,255,0.18)', green: '#4CC488' }
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
const appear = (local: number, delay: number, d = 0.6) => ease((local - delay) / d)

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k)
  ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k)
  ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y); ctx.closePath()
}
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, x: number, y: number, w: number, h: number, zoom = 1, pan = 0) {
  const iw = (img as any).naturalWidth || (img as any).videoWidth || img.width, ih = (img as any).naturalHeight || (img as any).videoHeight || img.height
  if (!iw || !ih) return
  const s = Math.max(w / iw, h / ih) * zoom
  const dw = iw * s, dh = ih * s
  ctx.drawImage(img, x + (w - dw) / 2 - pan * (dw - w) / 2, y + (h - dh) / 2, dw, dh)
}
type Seg = { t: string; gold: boolean }
function segs(text: string): Seg[] {
  const out: Seg[] = []
  const parts = String(text || '').split('**')
  for (let i = 0; i < parts.length; i++) if (parts[i]) out.push({ t: parts[i], gold: i % 2 === 1 })
  return out
}
/** Lay out rich text (**gold** words, \n breaks) into lines that fit maxW. */
function layout(ctx: CanvasRenderingContext2D, text: string, maxW: number): { words: { t: string; gold: boolean; w: number }[]; w: number }[] {
  const lines: { words: { t: string; gold: boolean; w: number }[]; w: number }[] = []
  const hard = String(text || '').split('\n')
  for (let h = 0; h < hard.length; h++) {
    let cur: { t: string; gold: boolean; w: number }[] = []
    let cw = 0
    const sp = ctx.measureText(' ').width
    const ss = segs(hard[h])
    for (let s = 0; s < ss.length; s++) {
      const ws = ss[s].t.split(/(\s+)/)
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k]
        if (!w) continue
        if (/^\s+$/.test(w)) { if (cur.length) cur[cur.length - 1].t += ' '; continue }
        const mw = ctx.measureText(w).width
        const add = cur.length ? mw + (/\s$/.test(cur[cur.length - 1].t) ? 0 : 0) : mw
        if (cur.length && cw + add > maxW) { lines.push({ words: cur, w: cw }); cur = []; cw = 0 }
        cur.push({ t: w, gold: ss[s].gold, w: mw })
        cw += (cur.length > 1 ? sp : 0) + mw
      }
    }
    lines.push({ words: cur, w: cw })
  }
  return lines
}
/** Draw rich text; each line can arrive on its own (stagger in seconds). Returns the height used. */
function rich(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, opts: { align?: 'left' | 'center'; font: string; weight?: number; local: number; delay?: number; stagger?: number; color?: string; lh?: number; shadow?: boolean }): number {
  ctx.font = `${opts.weight || 800} ${size}px ${opts.font}`
  const lines = layout(ctx, text, maxW)
  const lh = size * (opts.lh || 1.08)
  const sp = ctx.measureText(' ').width
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < lines.length; i++) {
    const a = appear(opts.local, (opts.delay || 0) + i * (opts.stagger == null ? 0.22 : opts.stagger))
    if (a <= 0) continue
    const L = lines[i]
    let cx = opts.align === 'center' ? x + (maxW - L.w) / 2 : x
    const cy = y + size + i * lh + (1 - a) * size * 0.35
    ctx.save()
    ctx.globalAlpha *= a
    if (opts.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = size * 0.35 }
    for (let k = 0; k < L.words.length; k++) {
      ctx.fillStyle = L.words[k].gold ? C.gold : (opts.color || C.ink)
      ctx.fillText(L.words[k].t.trim(), cx, cy)
      cx += L.words[k].w + sp
    }
    ctx.restore()
  }
  return lines.length * lh
}
function plain(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, color: string, weight = 500, align: 'left' | 'center' = 'left', alpha = 1): number {
  if (!text) return 0
  ctx.font = `${weight} ${size}px ${font}`
  const lines = layout(ctx, text.replace(/\*\*/g, ''), maxW)
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].words.map(w => w.t.trim()).join(' ')
    const w = ctx.measureText(s).width
    ctx.fillText(s, align === 'center' ? x + (maxW - w) / 2 : x, y + size + i * size * 1.3)
  }
  ctx.restore()
  return lines.length * size * 1.3
}
function split(row: string): [string, string] { const i = row.indexOf('|'); return i < 0 ? [row.trim(), ''] : [row.slice(0, i).trim(), row.slice(i + 1).trim()] }

function background(ctx: CanvasRenderingContext2D, W: number, H: number, img: HTMLImageElement | HTMLVideoElement | null, local: number, dur: number, dark: number) {
  if (img) {
    cover(ctx, img, 0, 0, W, H, 1.04 + 0.09 * clamp(local / Math.max(dur, 1)), 0.25 * clamp(local / Math.max(dur, 1)))
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, `rgba(6,18,30,${0.35 * dark + 0.1})`)
    g.addColorStop(0.55, `rgba(6,18,30,${0.55 * dark + 0.12})`)
    g.addColorStop(1, `rgba(6,18,30,${0.75 * dark + 0.15})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else {
    const g = ctx.createRadialGradient(W * 0.8, 0, 0, W * 0.8, 0, Math.max(W, H) * 1.1)
    g.addColorStop(0, C.navy2); g.addColorStop(0.6, C.navy); g.addColorStop(1, '#091827')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
}
function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, gold = false) {
  rr(ctx, x, y, w, h, r); ctx.fillStyle = C.glass; ctx.fill()
  ctx.lineWidth = gold ? 3 : 1.5; ctx.strokeStyle = gold ? C.gold : C.line; ctx.stroke()
}
function parseNum(s: string): { pre: string; n: number; dec: number; suf: string } | null {
  const m = String(s).match(/^([^\d]*)(\d+(?:[.,]\d+)?)(.*)$/)
  if (!m) return null
  const raw = m[2].replace(',', '')
  return { pre: m[1], n: parseFloat(raw), dec: (raw.split('.')[1] || '').length, suf: m[3] }
}

function drawScene(ctx: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const sc = p.scenes[i]
  const u = Math.min(W, H) / 1080
  const portrait = H > W * 1.1
  const pad = (portrait ? 80 : 120) * u
  const bottomSafe = (p.captions ? 190 : 110) * u
  const get = (u: string) => (!u ? null : A.media ? A.media(u, local) : A.img(u))
  const im = (k: number) => get(sc.photos[k] || '')
  const head = sc.head || ''

  if (sc.kind === 'cta') {
    background(ctx, W, H, im(0), local, dur, 0.95)
    const lw = (portrait ? 200 : 210) * u
    let y = portrait ? H * 0.2 : H * 0.17
    if (A.logo) {
      const lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
      ctx.save(); ctx.globalAlpha *= appear(local, 0); ctx.drawImage(A.logo, (W - lw) / 2, y, lw, lh); ctx.restore()
      y += lh + 60 * u
    }
    const size = (portrait ? 112 : 118) * u
    y += rich(ctx, head || 'Your South Florida **stay.**', pad, y, W - pad * 2, size, { font: A.display, local, delay: 0.25, stagger: 0.3, align: 'center' }) + 26 * u
    if (sc.sub) y += plain(ctx, sc.sub, pad, y, W - pad * 2, 38 * u, A.body, C.ink, 500, 'center', appear(local, 0.7)) + 40 * u
    const label = (sc.items[0] || 'Book at stay-hospitality.com').replace(/\|.*/, '')
    ctx.font = `700 ${40 * u}px ${A.body}`
    const bw = ctx.measureText(label).width + 110 * u, bh = 104 * u
    const a = appear(local, 1.0)
    // a soft pulse so a still post still reads as "tap me"
    const pulse = 1 + 0.03 * Math.sin(Math.max(0, local - 1.6) * 4)
    ctx.save(); ctx.globalAlpha *= a
    ctx.translate(W / 2, y + bh / 2); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -(y + bh / 2))
    rr(ctx, (W - bw) / 2, y + (1 - a) * 30 * u, bw, bh, bh / 2); ctx.fillStyle = C.gold; ctx.fill()
    ctx.fillStyle = '#1B1408'; ctx.textBaseline = 'middle'; ctx.fillText(label, (W - bw) / 2 + 55 * u, y + bh / 2 + (1 - a) * 30 * u)
    ctx.restore()
    if (sc.items[1]) plain(ctx, sc.items[1], pad, y + bh + 36 * u, W - pad * 2, 30 * u, A.body, C.mut, 500, 'center', appear(local, 1.4))
    if (A.credit && p.music !== 'none') plain(ctx, A.credit, W - 900 * u, H - 44 * u, 880 * u, 18 * u, A.mono, 'rgba(255,255,255,0.45)', 400)
    return
  }

  if (sc.kind === 'contact') {
    background(ctx, W, H, im(0), local, dur, 1.3)
    const c = p.contact || ({} as AdContact)
    const face = c.photo ? A.img(c.photo) : null
    const R = (portrait ? 300 : 260) * u
    const cx = portrait ? W / 2 : W * 0.29, cy = portrait ? H * 0.3 : H * 0.47
    const a = appear(local, 0)
    ctx.save(); ctx.globalAlpha *= a
    ctx.beginPath(); ctx.arc(cx, cy, R + 22 * u, 0, Math.PI * 2); ctx.fillStyle = 'rgba(210,176,119,0.16)'; ctx.fill()
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.save(); ctx.clip()
    if (face) cover(ctx, face, cx - R, cy - R, R * 2, R * 2); else { ctx.fillStyle = C.navy2; ctx.fillRect(cx - R, cy - R, R * 2, R * 2) }
    ctx.restore()
    ctx.lineWidth = 6 * u; ctx.strokeStyle = C.gold; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
    const tx = portrait ? pad : W * 0.5, tw = portrait ? W - pad * 2 : W * 0.44
    let ty = portrait ? H * 0.52 : H * 0.2
    const al: 'left' | 'center' = portrait ? 'center' : 'left'
    if (A.logo) {
      const lw = 230 * u, lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
      ctx.save(); ctx.globalAlpha *= appear(local, 0.2); ctx.drawImage(A.logo, portrait ? (W - lw) / 2 : tx, ty, lw, lh); ctx.restore()
      ty += lh + 50 * u
    }
    ty += rich(ctx, head || 'Book a **call.**', tx, ty, tw, 104 * u, { font: A.display, local, delay: 0.4, align: al }) + 30 * u
    const fade = (d: number) => appear(local, d)
    if (c.name) { ty += plain(ctx, c.name, tx, ty, tw, 54 * u, A.display, C.ink, 700, al, fade(0.7)) }
    if (c.role) { ty += plain(ctx, c.role, tx, ty, tw, 30 * u, A.body, C.mut, 500, al, fade(0.8)) + 26 * u }
    if (c.phone) { ty += plain(ctx, c.phone, tx, ty, tw, 92 * u, A.display, C.gold, 800, al, fade(1.1)) + 6 * u }
    if (c.email) { plain(ctx, c.email, tx, ty, tw, 30 * u, A.mono, C.ink, 500, al, fade(1.3)) }
    if (A.credit) plain(ctx, A.credit, W - 900 * u, H - 44 * u, 880 * u, 18 * u, A.mono, 'rgba(255,255,255,0.45)', 400)
    return
  }

  if (sc.kind === 'wall') {
    ctx.fillStyle = '#081622'; ctx.fillRect(0, 0, W, H)
    const cols = portrait ? 2 : 3, rows = portrait ? 4 : 3
    const n = Math.max(1, Math.min(cols * rows, sc.photos.length || 0))
    const gap = 4 * u
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows
    for (let k = 0; k < cols * rows; k++) {
      const img = sc.photos.length ? get(sc.photos[k % sc.photos.length]) : null
      const a = appear(local, k * 0.07, 0.5)
      if (a <= 0) continue
      const x = (k % cols) * (cw + gap), y = Math.floor(k / cols) * (ch + gap)
      ctx.save(); ctx.globalAlpha *= a
      const s = 0.92 + 0.08 * a
      ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(s, s); ctx.translate(-(x + cw / 2), -(y + ch / 2))
      ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip()
      if (img) cover(ctx, img, x, y, cw, ch, 1.02 + 0.06 * clamp(local / dur)); else { ctx.fillStyle = C.navy2; ctx.fillRect(x, y, cw, ch) }
      const label = sc.items[k] ? split(sc.items[k])[0] : ''
      if (label && k < n) {
        const g = ctx.createLinearGradient(0, y + ch * 0.5, 0, y + ch); g.addColorStop(0, 'rgba(6,18,30,0)'); g.addColorStop(1, 'rgba(6,18,30,0.75)')
        ctx.fillStyle = g; ctx.fillRect(x, y, cw, ch)
        plain(ctx, label, x + 28 * u, y + ch - 76 * u, cw - 56 * u, 34 * u, A.display, C.ink, 700)
      }
      ctx.restore()
    }
    if (head) {
      const a = appear(local, 0.5)
      ctx.save(); ctx.globalAlpha *= a
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
      g.addColorStop(0, 'rgba(6,18,30,0.62)'); g.addColorStop(1, 'rgba(6,18,30,0.85)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore()
      ctx.font = `800 ${120 * u}px ${A.display}`
      const hh = layout(ctx, head, W - pad * 2).length * 120 * u * 1.08
      rich(ctx, head, pad, (H - hh) / 2 - 30 * u, W - pad * 2, 120 * u, { font: A.display, local, delay: 0.6, align: 'center' })
      if (sc.sub) plain(ctx, sc.sub, pad, (H + hh) / 2, W - pad * 2, 36 * u, A.body, C.mut, 500, 'center', appear(local, 1))
    }
    return
  }

  background(ctx, W, H, im(0), local, dur, sc.kind === 'photo' ? 0.6 : 1.15)

  if (sc.kind === 'title' || sc.kind === 'photo') {
    const size = (sc.kind === 'title' ? 130 : 104) * u
    const hw = sc.kind === 'title' ? W - pad * 2 : W * (portrait ? 0.86 : 0.7)
    ctx.font = `800 ${size}px ${A.display}`
    const hh = layout(ctx, head, hw).length * size * 1.08
    if (sc.kind === 'title') {
      const y = (H - bottomSafe * 0.5 - hh) / 2 - 20 * u
      rich(ctx, head, pad, y, W - pad * 2, size, { font: A.display, local, delay: 0.15, stagger: 0.55, align: 'center' })
      if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 30 * u, W - pad * 2, 38 * u, A.body, C.mut, 500, 'center', appear(local, 0.9))
    } else {
      const y = H - bottomSafe - hh - (sc.sub ? 80 * u : 20 * u)
      rich(ctx, head, pad, y, hw, size, { font: A.display, local, delay: 0.2 })
      if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 18 * u, W * 0.6, 36 * u, A.body, C.ink, 500, 'left', appear(local, 0.6))
    }
    return
  }

  // FEED, LANDSCAPE: the headline holds the left third, the cards slide in on the right.
  if (sc.kind === 'feed' && !portrait) {
    const lw = W * 0.3
    ctx.font = `800 ${92 * u}px ${A.display}`
    const hh = layout(ctx, head, lw).length * 92 * u * 1.08
    ctx.font = `500 ${32 * u}px ${A.body}`
    const sh = sc.sub ? layout(ctx, sc.sub, lw).length * 32 * u * 1.3 : 0
    const y = (H - bottomSafe * 0.6 - hh - sh - 20 * u) / 2
    if (head) rich(ctx, head, pad, y, lw, 92 * u, { font: A.display, local, delay: 0.1 })
    if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 20 * u, lw, 32 * u, A.body, C.mut, 500, 'left', appear(local, 0.4))
    const it = sc.items.slice(0, 6)
    const lx = pad + lw + 80 * u, lwid = W - lx - pad
    const rowH = 118 * u, gap = 18 * u
    const y0 = Math.max(pad, (H - bottomSafe * 0.6 - it.length * (rowH + gap)) / 2)
    const dots = [C.gold, '#E07B5F', C.green, '#6E9BE0', '#E0B44C', C.gold]
    for (let k = 0; k < it.length; k++) {
      const [t1, t2] = split(it[k])
      const a = appear(local, 0.4 + k * 0.65, 0.55)
      if (a <= 0) continue
      const yy = y0 + k * (rowH + gap)
      ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - a) * 60 * u, 0)
      glass(ctx, lx, yy, lwid, rowH, 18 * u)
      ctx.fillStyle = dots[k % dots.length]; ctx.beginPath(); ctx.arc(lx + 40 * u, yy + rowH / 2, 9 * u, 0, Math.PI * 2); ctx.fill()
      plain(ctx, t1, lx + 72 * u, yy + 18 * u, lwid - 110 * u, 34 * u, A.body, C.ink, 700)
      plain(ctx, t2, lx + 72 * u, yy + 62 * u, lwid - 110 * u, 26 * u, A.body, C.mut, 500)
      ctx.restore()
    }
    return
  }

  // The rest share a headline at the top-left (or top on vertical) and a content area beneath.
  let top = pad + 20 * u
  if (head) top += rich(ctx, head, pad, top, W - pad * 2, (portrait ? 84 : 80) * u, { font: A.display, local, delay: 0.1 }) + 16 * u
  if (sc.sub) top += plain(ctx, sc.sub, pad, top, W - pad * 2, 32 * u, A.body, C.mut, 500, 'left', appear(local, 0.4)) + 10 * u
  const area = { x: pad, y: top + 30 * u, w: W - pad * 2, h: H - bottomSafe - top - 40 * u }

  if (sc.kind === 'stats') {
    const it = sc.items.slice(0, 6)
    const cols = portrait ? 2 : Math.min(3, Math.max(1, it.length))
    const rows = Math.ceil(it.length / cols) || 1
    const cw = area.w / cols, ch = Math.min(area.h / rows, 300 * u)
    const y0 = area.y + (area.h - ch * rows) / 2
    for (let k = 0; k < it.length; k++) {
      const [val, label] = split(it[k])
      const x = area.x + (k % cols) * cw, y = y0 + Math.floor(k / cols) * ch
      const a = appear(local, 0.2 + k * 0.15)
      if (a <= 0) continue
      ctx.save(); ctx.globalAlpha *= a
      ctx.fillStyle = C.gold; ctx.fillRect(x, y, cw - 40 * u, 4 * u)
      const pn = parseNum(val)
      const prog = ease((local - 0.2 - k * 0.15) / 1.4)
      const shown = pn ? pn.pre + (pn.n * prog).toLocaleString('en-US', { minimumFractionDigits: pn.dec, maximumFractionDigits: pn.dec }) + pn.suf : val
      ctx.font = `800 ${120 * u}px ${A.display}`; ctx.fillStyle = C.ink; ctx.fillText(shown, x, y + 150 * u)
      plain(ctx, label, x, y + 170 * u, cw - 50 * u, 32 * u, A.body, C.mut, 500)
      ctx.restore()
    }
    return
  }

  if (sc.kind === 'cards') {
    const it = sc.items.slice(0, 3)
    const n = Math.max(1, it.length)
    const fr = [0.04, 0.36, 0.66]
    for (let k = 0; k < n; k++) {
      const a = ease((local - dur * fr[k]) / 0.6)
      if (a <= 0) continue
      const [t1, t2] = split(it[k] || '')
      let x: number, y: number, w: number, ph: number
      if (portrait) { w = area.w; ph = Math.min((area.h / n) - 165 * u, w * 0.56); x = area.x; y = area.y + k * (ph + 165 * u) }
      else { const gap = 50 * u; w = (area.w - gap * (n - 1)) / n; ph = w * 0.72; x = area.x + k * (w + gap); y = area.y + (area.h - ph - 140 * u) / 2 }
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 40 * u)
      rr(ctx, x, y, w, ph, 22 * u); ctx.save(); ctx.clip()
      const img = get(sc.photos[k] || sc.photos[0] || '')
      if (img) cover(ctx, img, x, y, w, ph, 1.12 - 0.1 * a); else { ctx.fillStyle = C.navy2; ctx.fillRect(x, y, w, ph) }
      ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = C.line; rr(ctx, x, y, w, ph, 22 * u); ctx.stroke()
      plain(ctx, t1, x, y + ph + 18 * u, w, 54 * u, A.display, k === 0 ? C.gold : C.ink, 800)
      plain(ctx, t2, x, y + ph + 88 * u, w, 30 * u, A.body, C.mut, 500)
      ctx.restore()
    }
    return
  }

  if (sc.kind === 'feed' || sc.kind === 'checks') {
    const it = sc.items.slice(0, 6)
    const side = !portrait && (sc.kind === 'checks' ? !!sc.photos[0] : true)
    let lx = area.x, lw = area.w, ly = area.y
    if (sc.kind === 'checks' && sc.photos[0]) {
      const pw = portrait ? area.w : area.w * 0.48, ph = portrait ? area.h * 0.42 : Math.min(area.h, pw * 0.7)
      const img = get(sc.photos[0]); const a = appear(local, 0.1)
      ctx.save(); ctx.globalAlpha *= a; rr(ctx, area.x, area.y, pw, ph, 22 * u); ctx.save(); ctx.clip()
      if (img) cover(ctx, img, area.x, area.y, pw, ph, 1.05); ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = C.line; rr(ctx, area.x, area.y, pw, ph, 22 * u); ctx.stroke(); ctx.restore()
      if (portrait) { ly = area.y + ph + 40 * u } else { lx = area.x + pw + 60 * u; lw = area.w - pw - 60 * u }
    } else if (side) { lx = area.x + area.w * 0.36; lw = area.w * 0.64; ly = area.y - (head ? 120 * u : 0) }
    const rowH = (sc.kind === 'feed' ? 118 : 96) * u, gap = 18 * u
    const avail = (portrait ? area.y + area.h - ly : area.h + (side && sc.kind === 'feed' ? 120 * u : 0))
    const y0 = portrait ? ly : ly + Math.max(0, (avail - it.length * (rowH + gap)) / 2)
    for (let k = 0; k < it.length; k++) {
      const [t1, t2] = split(it[k])
      const delay = 0.4 + k * (sc.kind === 'feed' ? 0.65 : 0.5)
      const a = appear(local, delay, 0.55)
      const y = y0 + k * (rowH + gap)
      if (sc.kind === 'feed') {
        if (a <= 0) continue
        ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - a) * 60 * u, 0)
        glass(ctx, lx, y, lw, rowH, 18 * u)
        const dots = [C.gold, '#E07B5F', C.green, '#6E9BE0', '#E0B44C', C.gold]
        ctx.fillStyle = dots[k % dots.length]; ctx.beginPath(); ctx.arc(lx + 40 * u, y + rowH / 2, 9 * u, 0, Math.PI * 2); ctx.fill()
        plain(ctx, t1, lx + 72 * u, y + 18 * u, lw - 110 * u, 34 * u, A.body, C.ink, 700)
        plain(ctx, t2, lx + 72 * u, y + 62 * u, lw - 110 * u, 26 * u, A.body, C.mut, 500)
        ctx.restore()
      } else {
        const on = a > 0.5
        ctx.save(); ctx.globalAlpha *= 0.4 + 0.6 * a
        const bx = lx, by = y + (rowH - 44 * u) / 2
        rr(ctx, bx, by, 44 * u, 44 * u, 10 * u); ctx.lineWidth = 3 * u; ctx.strokeStyle = C.gold; ctx.stroke()
        if (on) { ctx.fillStyle = C.gold; ctx.fill(); ctx.strokeStyle = '#1B1408'; ctx.lineWidth = 5 * u; ctx.beginPath(); ctx.moveTo(bx + 11 * u, by + 23 * u); ctx.lineTo(bx + 19 * u, by + 31 * u); ctx.lineTo(bx + 34 * u, by + 13 * u); ctx.stroke() }
        plain(ctx, t1 + (t2 ? ' · ' + t2 : ''), bx + 70 * u, y + (rowH - 40 * u) / 2 - 6 * u, lw - 80 * u, 40 * u, A.body, C.ink, 600)
        ctx.restore()
      }
    }
    return
  }

  if (sc.kind === 'rise') {
    const cx = portrait ? area.x : area.x + area.w * 0.48, cw = portrait ? area.w : area.w * 0.52
    const cy = portrait ? area.y + area.h * 0.35 : area.y, ch = portrait ? area.h * 0.6 : area.h * 0.9
    // chips under the headline
    let chx = area.x, chy = portrait ? area.y : area.y + 10 * u
    for (let k = 0; k < Math.min(4, sc.items.length); k++) {
      const a = appear(local, 1 + k * 0.3)
      if (a <= 0) continue
      ctx.font = `600 ${30 * u}px ${A.body}`
      const tw = ctx.measureText(sc.items[k]).width + 50 * u
      if (!portrait && chx + tw > area.x + area.w * 0.44) { chx = area.x; chy += 76 * u }
      ctx.save(); ctx.globalAlpha *= a
      rr(ctx, chx, chy, tw, 60 * u, 30 * u); ctx.fillStyle = 'rgba(10,26,40,0.7)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.gold; ctx.stroke()
      ctx.fillStyle = C.ink; ctx.fillText(sc.items[k], chx + 25 * u, chy + 41 * u)
      ctx.restore()
      chx += tw + 16 * u
      if (portrait && chx > area.x + area.w * 0.7) { chx = area.x; chy += 76 * u }
    }
    // the line: flat and dashed before the switch, rising and gold after
    const P = (f: number) => [cx + cw * f, cy + ch * (0.82 - (f < 0.5 ? f * 0.12 : 0.06 + Math.pow((f - 0.5) / 0.5, 1.6) * 0.72))] as [number, number]
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(cx, cy + ch * 0.92); ctx.lineTo(cx + cw, cy + ch * 0.92); ctx.stroke()
    ctx.setLineDash([12 * u, 12 * u]); ctx.strokeStyle = C.mut; ctx.lineWidth = 5 * u; ctx.beginPath()
    for (let f = 0; f <= 0.5; f += 0.02) { const q = P(f); if (f === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]) }
    ctx.stroke(); ctx.setLineDash([])
    const sx = P(0.5)[0]
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2 * u; ctx.setLineDash([6 * u, 8 * u]); ctx.beginPath(); ctx.moveTo(sx, cy); ctx.lineTo(sx, cy + ch * 0.92); ctx.stroke(); ctx.setLineDash([])
    ctx.font = `500 ${26 * u}px ${A.body}`; ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.fillText('Switch to Stay', sx - 14 * u, cy + 26 * u); ctx.textAlign = 'left'
    const prog = ease((local - 0.5) / 2.2)
    ctx.strokeStyle = C.gold; ctx.lineWidth = 9 * u; ctx.lineCap = 'round'; ctx.beginPath()
    let last = P(0.5)
    for (let f = 0.5; f <= 0.5 + 0.5 * prog + 1e-6; f += 0.01) { const q = P(f); if (f === 0.5) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); last = q }
    ctx.stroke()
    if (prog > 0.98) { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(last[0], last[1], 14 * u, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
    return
  }
}

/** Find the scene playing at time t. */
export function sceneAt(tl: Timeline, t: number): number {
  let i = 0
  for (let k = 0; k < tl.starts.length; k++) if (t >= tl.starts[k]) i = k
  return i
}

/** The whole frame at time t: scene (with a crossfade from the previous one), the mark, captions. */
export function drawFrame(ctx: CanvasRenderingContext2D, p: AdProject, tl: Timeline, t: number, A: AdAssets) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const u = Math.min(W, H) / 1080
  ctx.save()
  ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H)
  if (!p.scenes.length) { ctx.restore(); return }
  const i = sceneAt(tl, t)
  const local = t - tl.starts[i]
  if (i > 0 && local < XFADE) {
    drawScene(ctx, p, i - 1, tl.durs[i - 1] + local, tl.durs[i - 1], A)
    ctx.globalAlpha = ease(local / XFADE)
  }
  drawScene(ctx, p, i, local, tl.durs[i], A)
  ctx.globalAlpha = 1
  const sc = p.scenes[i]
  if (A.logo && sc.kind !== 'contact' && sc.kind !== 'cta') {
    const lw = 150 * u, lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
    ctx.drawImage(A.logo, W - lw - 56 * u, 46 * u, lw, lh)
  }
  // CAPTIONS: the line being spoken (most viewers watch muted). Shown while the line plays.
  if (p.captions && sc.vo.trim()) {
    const a = clamp(local / 0.3) * clamp((tl.durs[i] - local) / 0.3)
    if (a > 0) {
      const g = ctx.createLinearGradient(0, H - 230 * u, 0, H)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)')
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, H - 230 * u, W, 230 * u)
      const size = (H > W * 1.1 ? 40 : 34) * u
      ctx.font = `500 ${size}px ${A.body}`
      const lines = layout(ctx, sc.vo.replace(/\*\*/g, ''), W * 0.76)
      const shown = lines.slice(0, 3)
      for (let k = 0; k < shown.length; k++) {
        const s = shown[k].words.map(w => w.t.trim()).join(' ')
        const w = ctx.measureText(s).width
        ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u
        ctx.fillText(s, (W - w) / 2, H - 60 * u - (shown.length - 1 - k) * size * 1.3)
      }
      ctx.restore()
    }
  }
  ctx.restore()
}

/** Ask the AI to write: what we send it about the house, so every script starts from the same facts. */
export const HOUSE_FACTS = `Stay Hospitality: short-term rental management across South Florida (Miami, Fort Lauderdale, Pompano, Palm Beach).
450+ listings across 140+ properties (hotels are part of the listings — say "listings", never "homes" for the count). 10 years in business. 1,000,000+ guests hosted. 4.6/5 guest rating.
Revenue: dedicated revenue managers price every listing every day against the competitive set; high-demand dates (Art Basel, New Year's Eve, the boat shows, Formula 1 Miami) are priced months ahead. We price to convert: higher conversion ranks listings higher, which books more and earns more.
Distribution: 40+ channels (Airbnb, Vrbo, Booking.com, Expedia, Marriott, Blueground, our direct site stay-hospitality.com).
Listings: built to convert (best photos first, copy that sells), refreshed every three months; underperformers are caught and fixed.
Technology: Guesty (reservations and channels), PriceLabs (pricing data), Breezeway (every task, photo-checked) and Lighthouse — our own AI platform built in-house. Lighthouse optimizes listings, builds guest guidebooks, spots recurring issues before guests do, turns problems into tasks automatically, monitors reviews and messages, checks guest ID and deposits, translates Spanish and English for the team, and schedules turnovers. Lighthouse does NOT produce the owner report.
Operations: one complete in-house team — housekeeping, maintenance, inspections and guest care (the Customer Care Team).
Results: owners who switch to Stay earn more, on a lower management fee, with full transparency every month. Never state a revenue percentage or a fee percentage.
Contact: Nick Carline, Business Development, 651-200-8283, nicholas@stay-hospitality.com.`


/** Guest-facing ads (Jon, 2026-11-02: "we should have a guest-facing ads builder too"). */
export const GUEST_FACTS = `Stay Hospitality: vacation rentals across South Florida — Miami, Fort Lauderdale, Pompano and Palm Beach. Book direct at stay-hospitality.com.
Places include high-rise apartments with bay and city views in downtown Miami, beach and ocean-view stays, resort pools, rooftop pools and lounges, and full apartments with kitchens and living space (say "many" or show it — do not promise an amenity for every stay).
Every stay is cleaned and inspected by our own team, with a digital guidebook to the neighbourhood and a Customer Care Team for every guest.
Guests rate their stays 4.6 out of 5. Over a million guests hosted.
Seasons and events worth a trip: Art Basel (December), New Year's Eve, the Fort Lauderdale and Miami boat shows, Formula 1 Miami (May), winter sun from December to March.
Rules: never promise a price, a discount, a "best rate" or availability. The call to action is to book at stay-hospitality.com — never "call us" or "text us".`

export type AdTemplate = { key: string; label: string; blurb: string; audience: AdAudience; format: AdFormat; name: string; scenes: (Omit<AdScene, 'id' | 'photos'> & { q?: string; n?: number })[] }
/** Ready-made ads: pick one and it fills itself with photos from the library — no AI needed. */
export const TEMPLATES: AdTemplate[] = [
  { key: 'owner-earn', label: 'Owners · Why Stay', blurb: '30s owner ad: hook, buildings, how, Lighthouse, results, Nick', audience: 'owners', format: '16:9', name: 'Why owners choose Stay', scenes: [
    { kind: 'title', vo: 'More revenue. A lower fee. One complete team. This is Stay Hospitality.', head: 'More **revenue.**\nLower **fee.**\nOne complete **team.**', sub: '', items: [], q: 'exterior', n: 1 },
    { kind: 'wall', vo: '', head: '', sub: '', items: [], q: 'pool', n: 9 },
    { kind: 'cards', vo: 'We price your home every day, put it on more than forty channels, and run it with one complete team.', head: '', sub: '', items: ['Priced daily|Dedicated revenue managers', '40+ channels|Everywhere guests book', 'One complete team|Housekeeping to guest care'], q: 'view', n: 3 },
    { kind: 'feed', vo: 'Lighthouse, our own AI, spots issues early and automates the work.', head: 'Our own **AI.**', sub: 'Lighthouse spots issues and automates the work', items: ['Same AC issue, 3rd time in 60 days|Recurring issue flagged · technician scheduled', 'New listing live|Guest guidebook built', 'Listing slipping vs comp set|Photos reordered · copy refreshed'], q: 'living', n: 1 },
    { kind: 'rise', vo: 'Owners who switch to Stay earn more, on a lower management fee.', head: 'Owners who switch\n**earn more.**', sub: '', items: ['Higher nightly rates', 'More booked nights', '40+ channels'], q: 'rooftop', n: 1 },
    { kind: 'contact', vo: 'Book a call with Nick today. 651-200-8283.', head: 'Book a **call.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'owner-reel', label: 'Owners · 15s reel', blurb: 'Vertical, fast: buildings, three reasons, Nick', audience: 'owners', format: '9:16', name: 'Owner reel', scenes: [
    { kind: 'wall', vo: 'Own a rental in South Florida? Here is how to earn more from it.', head: 'Own a rental in\n**South Florida?**', sub: '', items: [], q: 'pool', n: 8 },
    { kind: 'cards', vo: 'Priced every day, on more than forty channels, run by one complete team.', head: '', sub: '', items: ['Priced daily|Dedicated revenue managers', '40+ channels|Everywhere guests book', 'One complete team|Housekeeping to guest care'], q: 'view', n: 3 },
    { kind: 'contact', vo: 'Book a call with Nick. 651-200-8283.', head: 'Book a **call.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'guest-book', label: 'Guests · Book direct', blurb: '4:5 feed ad: the stay, the places, book now', audience: 'guests', format: '4:5', name: 'Book your South Florida stay', scenes: [
    { kind: 'photo', vo: 'Sun, sea and a place that feels like yours.', head: 'Your South Florida\n**stay.**', sub: 'Miami · Fort Lauderdale · Palm Beach', items: [], q: 'ocean view', n: 1 },
    { kind: 'wall', vo: '', head: '', sub: '', items: [], q: 'pool', n: 8 },
    { kind: 'cards', vo: 'Rooftop pools, ocean views, and room to spread out.', head: '', sub: '', items: ['Rooftop pools|Downtown and on the beach', 'Ocean views|Wake up to the water', 'Room to live|Kitchens and real living space'], q: 'rooftop pool', n: 3 },
    { kind: 'cta', vo: 'Book your stay at stay-hospitality.com.', head: 'Book your **stay.**', sub: '', items: ['Book at stay-hospitality.com', 'Rated 4.6 out of 5 by our guests'], q: 'balcony', n: 1 },
  ] },
  { key: 'guest-event', label: 'Guests · Event weekend', blurb: '9:16 story: Art Basel / New Year’s / boat show stays', audience: 'guests', format: '9:16', name: 'Art Basel stays', scenes: [
    { kind: 'title', vo: 'Art Basel is coming to Miami.', head: 'Art Basel\n**Miami Beach**', sub: 'December', items: [], q: 'skyline', n: 1 },
    { kind: 'photo', vo: 'Stay steps from the city, with a pool and a view of your own.', head: 'Your base for\n**the week.**', sub: '', items: [], q: 'view', n: 1 },
    { kind: 'cta', vo: 'Book now at stay-hospitality.com.', head: 'Dates go **fast.**', sub: '', items: ['Book at stay-hospitality.com'], q: 'rooftop', n: 1 },
  ] },
  { key: 'guest-post', label: 'Guests · Moving post', blurb: '1:1 animated post (6s) — export as GIF or MP4', audience: 'guests', format: '1:1', name: 'Moving post', scenes: [
    { kind: 'cta', vo: '', head: 'Your South Florida\n**stay.**', sub: 'Pools, views and room to breathe', items: ['Book at stay-hospitality.com'], q: 'pool', n: 1, dur: 6 },
  ] },
  { key: 'spotlight', label: 'Guests · Property spotlight', blurb: '4:5: one building, what is there, book now', audience: 'guests', format: '4:5', name: 'Property spotlight', scenes: [
    { kind: 'wall', vo: '', head: '', sub: '', items: [], q: 'arya', n: 8 },
    { kind: 'checks', vo: 'A rooftop pool, city views, and room to spread out.', head: 'What is **waiting.**', sub: '', items: ['Rooftop pool', 'City and bay views', 'Room to spread out', 'Cleaned and inspected by our team'], q: 'arya pool', n: 1 },
    { kind: 'cta', vo: 'Book at stay-hospitality.com.', head: 'Book your **stay.**', sub: '', items: ['Book at stay-hospitality.com'], q: 'arya', n: 1 },
  ] },
]

/** Videos already made for sales, shipped with the app (Jon, 2026-11-02: "the ones we created for sales"). */
export const BUILTIN_VIDEOS: { key: string; name: string; file: string; thumb: string; dur: number; format: AdFormat }[] = [
  { key: 'builtin:full', name: 'Why owners choose Stay — full cut', file: '/ads/library/why-owners-choose-stay-full.mp4', thumb: '/ads/library/why-owners-choose-stay-full.jpg', dur: 73.4, format: '16:9' },
  { key: 'builtin:short', name: 'Book a call — short cut', file: '/ads/library/book-a-call-short.mp4', thumb: '/ads/library/book-a-call-short.jpg', dur: 30.6, format: '16:9' },
]
