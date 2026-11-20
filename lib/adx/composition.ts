// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// stay.composition/1 — the document the composer model writes and the player draws. Each piece is AUTHORED (this
// event, this audience, these photographs), not filled into a template: layers are placed freely on the canvas with
// their own entrances, masks, colours and type. But nothing in it executes.
//
// MODEL OUTPUT IS DATA. sanitizeComposition() is the only door: every field is coerced and clamped, unknown layer
// types and unknown keys are dropped, colours must be hex or a palette key, fonts come from a fixed list, vector
// paths may only contain path-data characters, and photo / logo / music sources are never taken from the model:
// they come from the asset table the server built (hosts checked here) and from constants. The player draws to a
// canvas with fillText / drawImage / Path2D only — no HTML, CSS or script is ever built from a composition.
//
// Client and server safe; no imports, so the plain-node tests can load it.

export const ADX_FORMAT = 'stay.composition/1'

// ── the decisions Jon has not answered yet: one line each, easy to change ───────────────────────────────────────
/** Monthly AI cap for Ad Studio (old and new engine together), in dollars. Enforced in lib/adx/budget.ts. */
export const ADX_MONTHLY_CAP_USD = 50
/** The calendar moments (lib/marketing-calendar keys) the NEW engine makes. Everything else stays on the old path. */
export const ADX_MOMENTS: readonly string[] = ['thanksgiving', 'christmas', 'nye', 'basel', 'stays', 'ownerstory', 'team']
/** FROM SCRATCH (Jon, 2026-11-20: "The new ad from scratch is the old model … Need the same engine" and "team promo
 *  videos, culture events, announcements, etc, internal ads"). Pieces that belong to no calendar event: our stays for
 *  guests, the owner piece, and internal pieces for the team. Each has an identity in lib/adx/identities. */
export const ADX_ANYTIME: readonly string[] = ['stays', 'ownerstory', 'team']
/** A photograph is never drawn larger than this multiple of its real pixels. */
export const MAX_PHOTO_UPSCALE = 1.0
/** No horizontal band taller than this share of the frame may be plain ground (nothing designed in it). */
export const DEAD_BAND_MAX = 0.2
/** Smallest type that is legible on a phone, in pixels on a 1080-wide canvas. */
export const MIN_LABEL_PX = 26
export const MIN_HEADLINE_PX = 64

/** How long the music takes to fade out at the end unless a person sets it (seconds), and its fade in. */
export const MUSIC_FADE_OUT = 2
export const MUSIC_FADE_IN = 0.6
/** The music's level at time t of a piece `dur` long: up over the fade in, down to silence over the fade out. One
 *  function for the preview and both export paths, so what is heard is what is exported. */
export function musicLevel(t: number, dur: number, gain: number, fadeOut: number): number {
  const up = Math.min(1, Math.max(0, t / MUSIC_FADE_IN)), down = fadeOut > 0.01 ? Math.min(1, Math.max(0, (dur - t) / Math.min(fadeOut, Math.max(0.1, dur - MUSIC_FADE_IN)))) : 1
  return Math.max(0, Math.min(1, gain * up * down))
}
export const LOGO = { black: '/ads/stay-logo-black.png', white: '/ads/stay-logo-white.png', w: 1332, h: 636 } as const
export const FONT_FAMILIES = ['Fraunces', 'Instrument Sans', 'Bricolage Grotesque'] as const
/** The files behind the families (public/ads/fonts, SIL Open Font License). Loaded and awaited before any draw. */
export const FONT_FILES: { family: string; style: 'normal' | 'italic'; weight: string; file: string }[] = [
  { family: 'Fraunces', style: 'normal', weight: '400 700', file: '/ads/fonts/fraunces.woff2' },
  { family: 'Fraunces', style: 'italic', weight: '400 700', file: '/ads/fonts/fraunces-italic.woff2' },
  { family: 'Instrument Sans', style: 'normal', weight: '400 700', file: '/ads/fonts/instrument-sans.woff2' },
  { family: 'Bricolage Grotesque', style: 'normal', weight: '400 800', file: '/ads/fonts/bricolage-grotesque.woff2' },
]
/** Hosts a photograph may come from: the app's own storage (enhanced listing photos), the listing photo hosts and the
 *  stock hosts the studio's image proxy already serves. */
const PHOTO_HOSTS = [/^[a-z0-9]{12,30}\.supabase\.co$/i, /(^|\.)guesty\.com$/i, /(^|\.)cloudinary\.com$/i, /(^|\.)muscache\.com$/i, /(^|\.)pexels\.com$/i, /(^|\.)unsplash\.com$/i]
/** Same-origin sources: bundled ad assets and the studio's own stored images. */
const LOCAL_SRC = /^\/(ads\/[a-z0-9\-/_.]+\.(jpg|jpeg|png|webp)|api\/ads\/image\?path=ai%2F\d{6}%2F[a-z0-9]{6,40}\.(jpg|png|webp))$/i
export function photoSrcAllowed(src: string): boolean {
  const s = String(src || '')
  if (s.startsWith('/')) return LOCAL_SRC.test(s) && s.indexOf('..') < 0
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || !PHOTO_HOSTS.some(re => re.test(u.hostname))) return false
    // our own storage: public objects only
    return !/\.supabase\.co$/i.test(u.hostname) || u.pathname.startsWith('/storage/v1/object/public/')
  } catch { return false }
}

// ── channels: the frame and what the platform's own buttons cover ───────────────────────────────────────────────
export type ChannelKey = 'vertical' | 'story' | 'feed' | 'square'
export const CHANNELS: Record<ChannelKey, { label: string; hint: string; w: number; h: number; safe: Safe }> = {
  // the union of Reels, TikTok and Shorts chrome, so one file is right on all three
  vertical: { label: 'Vertical video', hint: 'Reels · TikTok · Shorts · 9:16', w: 1080, h: 1920, safe: { top: 230, bottom: 422, left: 64, right: 151 } },
  story: { label: 'Story', hint: 'Instagram and Facebook Stories · 9:16', w: 1080, h: 1920, safe: { top: 270, bottom: 384, left: 64, right: 64 } },
  feed: { label: 'Feed post', hint: 'Instagram and Facebook feed · 4:5', w: 1080, h: 1350, safe: { top: 64, bottom: 64, left: 64, right: 64 } },
  square: { label: 'Square', hint: 'Feed and ads · 1:1', w: 1080, h: 1080, safe: { top: 64, bottom: 64, left: 64, right: 64 } },
}

// ── the vocabulary ──────────────────────────────────────────────────────────────────────────────────────────────
export const LOOK_KEYS = ['stay-black', 'gallery-white', 'true-colour', 'colour-field', 'festive-lights'] as const
export const EASES = ['linear', 'outCubic', 'outExpo', 'inOutCubic', 'outBack'] as const
export const TRANSITIONS = ['none', 'cut', 'dissolve', 'dip', 'push', 'slide', 'wipe'] as const
export const DIRS = ['up', 'down', 'left', 'right'] as const
export const TREATMENTS = ['none', 'warm', 'cool', 'mono'] as const
export const MASKS = ['rect', 'arch', 'circle', 'round'] as const
export const SHAPES = ['rect', 'ellipse', 'line'] as const
export const MOTIFS = ['leaf', 'string-lights', 'bulbs-around', 'ornament', 'tree', 'snow', 'sparkle', 'firework', 'rays', 'star'] as const
export const MOTIF_VARIANTS: Record<string, readonly string[]> = {
  leaf: ['maple', 'oval', 'palm'], 'string-lights': ['multi', 'warm', 'white'], 'bulbs-around': ['multi', 'warm', 'white'],
  ornament: ['ball', 'drop'], tree: ['evergreen'], snow: ['soft'], sparkle: ['four', 'dot'], firework: ['burst'], rays: ['fan', 'full'], star: ['four', 'five'],
}
export const DRESSES = ['none', 'lights', 'leaves', 'sparkle', 'star'] as const
export const PRESETS = ['fade', 'fade-up', 'pop', 'rise-lines', 'wipe', 'draw', 'settle', 'track-in', 'light-up'] as const
export const FROMS = ['left', 'right', 'top', 'bottom', 'center'] as const
export const LAYER_TYPES = ['fill', 'photo', 'text', 'shape', 'vector', 'motif', 'logo', 'button'] as const

export type Ease = typeof EASES[number]
export type LookKey = typeof LOOK_KEYS[number]
export type MotifKey = typeof MOTIFS[number]
export type ColorRef = string                      // a key of tokens.color, or #RRGGBB
export type Box = { x: number; y: number; w: number; h: number }
export type Safe = { top: number; bottom: number; left: number; right: number }
export type TypeStyle = { family: string; weight: number; style: 'normal' | 'italic'; lineHeight: number; tracking: number; upper?: boolean }
export type Entrance = { preset: typeof PRESETS[number]; at: number; dur: number; ease?: Ease; stagger?: number; from?: typeof FROMS[number]; fromY?: number; spin?: number }
export type Cam = { scale?: number; x?: number; y?: number }
export type Run = { t: string; style?: string; color?: ColorRef } | { br: true }
type Common = { id: string; opacity?: number; rotate?: number; in?: Entrance }
export type FillLayer = Common & { type: 'fill'; color: ColorRef }
export const IDLES = ['float', 'sway', 'spin', 'pulse'] as const
export type PhotoLayer = Common & { type: 'photo'; photo: string; box: Box; /** How an added image or 3D object keeps moving once it has arrived. */ idle?: typeof IDLES[number]; focal?: { x: number; y: number }; treatment: typeof TREATMENTS[number]; mask?: { shape: typeof MASKS[number]; radius?: number }; camera?: { from: Cam; to: Cam; ease?: Ease } }
export type TextLayer = Common & { type: 'text'; style: string; color: ColorRef; box: Box; align?: 'left' | 'center' | 'right'; size?: number; fit?: { max: number; min: number; lines: number }; runs: Run[] }
export type ShapeLayer = Common & { type: 'shape'; shape: typeof SHAPES[number]; color: ColorRef; box: Box; radius?: number; stroke?: number }
export type VectorLayer = Common & { type: 'vector'; box: Box; viewBox: [number, number]; paths: { d: string; fill?: ColorRef; stroke?: ColorRef; strokeWidth?: number }[] }
export type MotifLayer = Common & { type: 'motif'; motif: MotifKey; variant?: string; color?: ColorRef; box: Box; target?: string; count?: number }
export type LogoLayer = Common & { type: 'logo'; variant: 'black' | 'white'; tint?: ColorRef; dress?: typeof DRESSES[number]; box: { x: number; y: number; w: number } }
export type ButtonLayer = Common & { type: 'button'; style: string; fill: ColorRef; color: ColorRef; size: number; box: Box; radius?: number; label: string }
export type Layer = FillLayer | PhotoLayer | TextLayer | ShapeLayer | VectorLayer | MotifLayer | LogoLayer | ButtonLayer
export type Transition = { type: typeof TRANSITIONS[number]; dir?: typeof DIRS[number]; dur?: number; ease?: Ease }
export type Scene = { id: string; name: string; start: number; dur: number; transitionIn: Transition; layers: Layer[] }

export type Brief = {
  goal: string; audience: 'guests' | 'owners' | 'team'; who: string; takeaway: string
  moment: string; momentName: string; dates: string; area: string; areaLabel: string; vibe: string
  channel: ChannelKey; seconds: number; note: string
  confirmedBy: string; confirmedAt: string
}
export type PhotoAsset = {
  src: string; w: number; h: number
  /** 'upload' (editor, 2026-11-20): an image or PNG a person added — a sticker, a badge, their own picture. It is
   *  drawn whole (never cropped) and is not counted as one of the piece's photographs. */
  source: 'ours' | 'stock' | 'ai' | 'upload'; building: string; unit: string; area: string
  /** What the picture IS (photo analysis / caption) — the composer and the audit read it. */
  shows: string
  focal?: { x: number; y: number }
}
export type Rules = {
  guestAd: boolean; noPrices: boolean; noPhone: boolean; bannedSpoken: string[]; bannedAnywhere: string[]; endsOn: string
  photoArea: string; photoTreatment: 'none' | 'any'; maxPhotoUpscale: number; textInsideSafe: boolean
  minLabelPx: number; minHeadlinePx: number; maxTransitionKinds: number; deadBandMax: number
}
export type Composition = {
  format: typeof ADX_FORMAT
  id: string
  title: string
  brief: Brief
  concept: { name: string; idea: string; look: LookKey; identity: string }
  canvas: { w: number; h: number; fps: 30; duration: number; safe: Safe }
  tokens: { color: Record<string, string>; type: Record<string, TypeStyle>; motion: { language: string; ease: Ease; easeMove: Ease } }
  assets: { photos: Record<string, PhotoAsset>; logo: typeof LOGO; audio: { music: { track: string; gain: number; credit: string; /** Seconds the music takes to fade out at the end (0 = it stops with the picture). */ fadeOut: number; /** Seconds into the song the piece starts from (0 = its beginning). */ start: number } } }
  script: { lines: { scene: string; vo: string }[]; alternates: Record<string, string[]> }
  scenes: Scene[]
  social: { caption: string; captionAlternates: string[]; hashtags: string[] }
  rules: Rules
  meta: { createdAt: string; updatedAt: string; updatedBy: string; origin: 'composer' | 'house' | 'edited'; costUsd?: number }
}

// ── the rules a piece is held to, from who it is for (never from the model) ─────────────────────────────────────
/** Words that are never spoken (the voice mispronounces them); they may appear on screen. */
export const BANNED_SPOKEN = ['Salato', 'Pompano Beach']
/** Phrases that never appear at all: Jon's standing wording rules. */
export const BANNED_ANYWHERE = ['CCS', 'Customer Care Team', 'in seconds', '2 a.m', '2am']
export const GUEST_CTA = 'Book at stay-hospitality.com'
export const OWNER_CTA = 'Talk to Nick · 651.200.8283'
/** The channels behind "40+ platforms": when the number is used, these are named. */
export const CHANNEL_NAMES = ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Marriott', 'Blueground', 'stay-hospitality.com']
export function rulesFor(brief: Pick<Brief, 'audience' | 'area'>): Rules {
  // an internal piece for the team sells nothing: no booking button, no owner line — it ends on the mark
  const team = brief.audience === 'team', guests = !team && brief.audience !== 'owners'
  return {
    guestAd: guests, noPrices: guests, noPhone: guests, bannedSpoken: BANNED_SPOKEN.slice(), bannedAnywhere: BANNED_ANYWHERE.slice(),
    endsOn: guests ? GUEST_CTA : team ? '' : OWNER_CTA, photoArea: brief.area || '', photoTreatment: 'none', maxPhotoUpscale: MAX_PHOTO_UPSCALE,
    textInsideSafe: true, minLabelPx: MIN_LABEL_PX, minHeadlinePx: MIN_HEADLINE_PX, maxTransitionKinds: 2, deadBandMax: DEAD_BAND_MAX,
  }
}
export function canvasFor(channel: ChannelKey): Composition['canvas'] {
  const c = CHANNELS[channel] || CHANNELS.vertical
  return { w: c.w, h: c.h, fps: 30, duration: 15, safe: { ...c.safe } }
}

// ── coercion helpers ────────────────────────────────────────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, lo: number, hi: number, d: number): number => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).indexOf(v) >= 0 ? (v as T) : d)
/** Plain text only: control characters out, whitespace collapsed, length capped. */
export const cleanText = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const KEY = /^[a-z][a-z0-9-]{0,23}$/i
const hex6 = (c: string) => (c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c).toUpperCase()
const idOf = (v: unknown, d: string) => { const s = String(v ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40); return s || d }
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE\s,.\-+]*$/

/** A colour reference the player can resolve: a palette key that exists, or a hex. Anything else becomes `d`. */
function colorRef(v: unknown, palette: Record<string, string>, d: string): string {
  const s = String(v ?? '').trim()
  if (HEX.test(s)) return hex6(s)
  if (KEY.test(s) && Object.prototype.hasOwnProperty.call(palette, s)) return s
  return d
}
export function resolveColor(doc: Pick<Composition, 'tokens'>, c: string | undefined, d = '#000000'): string {
  const s = String(c || '')
  const p = doc.tokens.color
  if (Object.prototype.hasOwnProperty.call(p, s)) return p[s]
  return HEX.test(s) ? hex6(s) : d
}

function box(v: unknown, W: number, H: number, d: Box): Box {
  const b = isObj(v) ? v : {}
  return { x: Math.round(num(b.x, -W, 2 * W, d.x)), y: Math.round(num(b.y, -H, 2 * H, d.y)), w: Math.round(num(b.w, 1, 2 * W, d.w)), h: Math.round(num(b.h, 1, 2 * H, d.h)) }
}
function entrance(v: unknown, sceneDur: number): Entrance | undefined {
  if (!isObj(v) || (PRESETS as readonly string[]).indexOf(v.preset) < 0) return undefined
  const e: Entrance = { preset: v.preset, at: num(v.at, 0, Math.max(0, sceneDur - 0.2), 0), dur: num(v.dur, 0.15, 2.4, 0.6) }
  if ((EASES as readonly string[]).indexOf(v.ease) >= 0) e.ease = v.ease
  if (v.stagger != null) e.stagger = num(v.stagger, 0, 0.4, 0.1)
  if ((FROMS as readonly string[]).indexOf(v.from) >= 0) e.from = v.from
  if (v.fromY != null) e.fromY = num(v.fromY, -800, 800, -240)
  if (v.spin != null) e.spin = num(v.spin, -360, 360, 0)
  return e
}
const cam = (v: unknown): Cam => { const c = isObj(v) ? v : {}; return { scale: num(c.scale, 1, 1.6, 1), x: num(c.x, -0.2, 0.2, 0), y: num(c.y, -0.2, 0.2, 0) } }

function layer(raw: unknown, ctx: { W: number; H: number; dur: number; palette: Record<string, string>; types: Record<string, TypeStyle>; photos: Record<string, PhotoAsset>; ink: string; notes: string[]; ids: Set<string>; sid: string; n: number }): Layer | null {
  if (!isObj(raw)) return null
  const type = raw.type
  if ((LAYER_TYPES as readonly string[]).indexOf(type) < 0) { ctx.notes.push(`${ctx.sid}: dropped a layer of unknown type "${cleanText(type, 20)}"`); return null }
  let id = idOf(raw.id, `${ctx.sid}-l${ctx.n}`)
  while (ctx.ids.has(id)) id += 'x'
  ctx.ids.add(id)
  const { W, H, palette } = ctx
  const common: Common = { id }
  if (raw.opacity != null) common.opacity = num(raw.opacity, 0, 1, 1)
  if (raw.rotate != null) common.rotate = num(raw.rotate, -360, 360, 0)
  const en = entrance(raw.in, ctx.dur); if (en) common.in = en
  const full: Box = { x: 0, y: 0, w: W, h: H }
  if (type === 'fill') return { ...common, type, color: colorRef(raw.color, palette, '#000000') }
  if (type === 'photo') {
    const key = String(raw.photo ?? '')
    if (!Object.prototype.hasOwnProperty.call(ctx.photos, key)) { ctx.notes.push(`${id}: dropped, no photograph "${cleanText(key, 30)}" in the asset table`); return null }
    const l: PhotoLayer = { ...common, type, photo: key, box: box(raw.box, W, H, full), treatment: pick(raw.treatment, TREATMENTS, 'none') }
    if (isObj(raw.focal)) l.focal = { x: num(raw.focal.x, 0, 1, 0.5), y: num(raw.focal.y, 0, 1, 0.5) }
    if ((IDLES as readonly string[]).indexOf(raw.idle) >= 0 && ctx.photos[key].source === 'upload') l.idle = raw.idle
    if (isObj(raw.mask) && (MASKS as readonly string[]).indexOf(raw.mask.shape) >= 0 && raw.mask.shape !== 'rect') l.mask = { shape: raw.mask.shape, ...(raw.mask.radius != null ? { radius: num(raw.mask.radius, 0, 600, 24) } : {}) }
    if (isObj(raw.camera)) l.camera = { from: cam(raw.camera.from), to: cam(raw.camera.to), ...((EASES as readonly string[]).indexOf(raw.camera.ease) >= 0 ? { ease: raw.camera.ease } : {}) }
    return l
  }
  if (type === 'text') {
    const style = typeof raw.style === 'string' && Object.prototype.hasOwnProperty.call(ctx.types, raw.style) ? raw.style : 'display'
    const runs: Run[] = []
    for (const r of Array.isArray(raw.runs) ? raw.runs.slice(0, 16) : []) {
      if (!isObj(r)) continue
      if (r.br === true) { runs.push({ br: true }); continue }
      // a run keeps its inner spaces: "somewhere " must stay apart from the accent word that follows
      const t = String(r.t ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').slice(0, 140)
      if (!t.trim()) continue
      const run: { t: string; style?: string; color?: string } = { t }
      if (typeof r.style === 'string' && Object.prototype.hasOwnProperty.call(ctx.types, r.style)) run.style = r.style
      if (r.color != null) run.color = colorRef(r.color, palette, ctx.ink)
      runs.push(run)
    }
    if (!runs.some(r => !('br' in r))) return null
    const l: TextLayer = { ...common, type, style, color: colorRef(raw.color, palette, ctx.ink), box: box(raw.box, W, H, { x: 64, y: 300, w: W - 128, h: 200 }), runs }
    if (raw.align === 'center' || raw.align === 'right') l.align = raw.align
    if (isObj(raw.fit)) { const max = num(raw.fit.max, 20, 280, 96); l.fit = { max: Math.round(max), min: Math.round(num(raw.fit.min, 20, max, Math.min(max, 72))), lines: Math.round(num(raw.fit.lines, 1, 5, 2)) } }
    else l.size = Math.round(num(raw.size, 18, 280, 28))
    return l
  }
  if (type === 'shape') {
    const l: ShapeLayer = { ...common, type, shape: pick(raw.shape, SHAPES, 'rect'), color: colorRef(raw.color, palette, ctx.ink), box: box(raw.box, W, H, full) }
    if (raw.radius != null) l.radius = num(raw.radius, 0, 1000, 0)
    if (raw.stroke != null) l.stroke = num(raw.stroke, 1, 40, 2)
    return l
  }
  if (type === 'vector') {
    const vb = Array.isArray(raw.viewBox) ? raw.viewBox : []
    const paths: VectorLayer['paths'] = []
    for (const p of Array.isArray(raw.paths) ? raw.paths.slice(0, 16) : []) {
      if (!isObj(p)) continue
      const d = String(p.d ?? '')
      if (!d || d.length > 3000 || !PATH_D.test(d)) { ctx.notes.push(`${id}: dropped a path that is not plain path data`); continue }
      paths.push({ d, ...(p.fill != null ? { fill: colorRef(p.fill, palette, ctx.ink) } : {}), ...(p.stroke != null ? { stroke: colorRef(p.stroke, palette, ctx.ink), strokeWidth: num(p.strokeWidth, 0.2, 60, 2) } : {}) })
    }
    if (!paths.length) return null
    return { ...common, type, box: box(raw.box, W, H, full), viewBox: [num(vb[0], 1, 4000, 100), num(vb[1], 1, 4000, 100)], paths }
  }
  if (type === 'motif') {
    if ((MOTIFS as readonly string[]).indexOf(raw.motif) < 0) { ctx.notes.push(`${id}: dropped, no motif "${cleanText(raw.motif, 20)}"`); return null }
    const motif = raw.motif as MotifKey
    const l: MotifLayer = { ...common, type, motif, variant: pick(raw.variant, MOTIF_VARIANTS[motif] || [], (MOTIF_VARIANTS[motif] || [''])[0]), box: box(raw.box, W, H, { x: 0, y: 0, w: 200, h: 200 }) }
    if (raw.color != null) l.color = colorRef(raw.color, palette, ctx.ink)
    if (typeof raw.target === 'string') l.target = idOf(raw.target, '')
    if (raw.count != null) l.count = Math.round(num(raw.count, 1, 80, 12))
    return l
  }
  if (type === 'logo') {
    const b = isObj(raw.box) ? raw.box : {}
    const l: LogoLayer = { ...common, type, variant: raw.variant === 'white' ? 'white' : 'black', box: { x: Math.round(num(b.x, -W, 2 * W, 64)), y: Math.round(num(b.y, -H, 2 * H, 64)), w: Math.round(num(b.w, 60, W, 150)) } }
    if (raw.tint != null && l.variant === 'white') l.tint = colorRef(raw.tint, palette, '#FFFFFF')
    if ((DRESSES as readonly string[]).indexOf(raw.dress) >= 0 && raw.dress !== 'none') l.dress = raw.dress
    return l
  }
  // button
  const label = cleanText(raw.label, 60)
  if (!label) return null
  const l: ButtonLayer = { ...common, type: 'button', style: typeof raw.style === 'string' && Object.prototype.hasOwnProperty.call(ctx.types, raw.style) ? raw.style : 'button', fill: colorRef(raw.fill, palette, ctx.ink), color: colorRef(raw.color, palette, '#FFFFFF'), size: Math.round(num(raw.size, 22, 72, 40)), box: box(raw.box, W, H, { x: 190, y: 1100, w: 700, h: 108 }), label }
  if (raw.radius != null) l.radius = num(raw.radius, 0, 400, 54)
  return l
}

const DEFAULT_TYPES: Record<string, TypeStyle> = {
  display: { family: 'Fraunces', weight: 600, style: 'normal', lineHeight: 1.06, tracking: -0.01 },
  displayAccent: { family: 'Fraunces', weight: 500, style: 'italic', lineHeight: 1.06, tracking: -0.01 },
  label: { family: 'Instrument Sans', weight: 600, style: 'normal', lineHeight: 1.2, tracking: 0.2, upper: true },
  button: { family: 'Instrument Sans', weight: 700, style: 'normal', lineHeight: 1, tracking: 0.01 },
}
function typeStyle(v: unknown, d: TypeStyle): TypeStyle {
  const s = isObj(v) ? v : {}
  const out: TypeStyle = {
    family: pick(s.family, FONT_FAMILIES, d.family as typeof FONT_FAMILIES[number]),
    weight: Math.round(num(s.weight, 400, 800, d.weight) / 100) * 100,
    style: s.style === 'italic' ? 'italic' : s.style === 'normal' ? 'normal' : d.style,
    lineHeight: num(s.lineHeight, 0.9, 1.6, d.lineHeight), tracking: num(s.tracking, -0.05, 0.4, d.tracking),
  }
  if (out.family !== 'Fraunces') out.style = 'normal'          // only Fraunces ships an italic
  if (out.family !== 'Bricolage Grotesque' && out.weight > 700) out.weight = 700
  if (s.upper === true || (s.upper == null && d.upper)) out.upper = true
  return out
}

/** The trusted half of a piece: built by the server (or carried by a saved file) and never taken from the model. */
export type TrustedParts = { id: string; title?: string; brief: Brief; canvas: Composition['canvas']; photos: Record<string, PhotoAsset>; music?: { track: string; gain?: number; credit?: string; fadeOut?: number; start?: number }; meta?: Partial<Composition['meta']> }

function photoAsset(v: unknown): PhotoAsset | null {
  if (!isObj(v) || !photoSrcAllowed(String(v.src || ''))) return null
  const a: PhotoAsset = {
    src: String(v.src), w: Math.round(num(v.w, 1, 20000, 1200)), h: Math.round(num(v.h, 1, 20000, 800)),
    source: pick(v.source, ['ours', 'stock', 'ai', 'upload'] as const, 'ours'), building: cleanText(v.building, 60), unit: cleanText(v.unit, 80), area: cleanText(v.area, 30), shows: cleanText(v.shows, 240),
  }
  if (isObj(v.focal)) a.focal = { x: num(v.focal.x, 0, 1, 0.5), y: num(v.focal.y, 0, 1, 0.5) }
  return a
}
/** A brief as the wizard sent it, coerced field by field. */
export function cleanBrief(v: unknown): Brief {
  const b = isObj(v) ? v : {}
  return {
    goal: cleanText(b.goal, 200), audience: b.audience === 'owners' ? 'owners' : b.audience === 'team' ? 'team' : 'guests', who: cleanText(b.who, 240), takeaway: cleanText(b.takeaway, 300),
    moment: idOf(b.moment, ''), momentName: cleanText(b.momentName, 80), dates: cleanText(b.dates, 60), area: idOf(b.area, ''), areaLabel: cleanText(b.areaLabel, 60), vibe: cleanText(b.vibe, 80),
    channel: pick(b.channel, Object.keys(CHANNELS) as ChannelKey[], 'vertical'), seconds: Math.round(num(b.seconds, 6, 60, 15)), note: cleanText(b.note, 400),
    confirmedBy: cleanText(b.confirmedBy, 120), confirmedAt: cleanText(b.confirmedAt, 40),
  }
}

/**
 * THE ONLY DOOR. `authored` is whatever the model (or a browser) sent: concept, tokens, scenes, script, social.
 * `trusted` is what the server knows: who it is for, the frame, the photographs it may use. Returns a document the
 * player can draw without checking anything again, and the notes of what was dropped or changed.
 */
export function sanitizeComposition(authored: unknown, trusted: TrustedParts): { doc: Composition; notes: string[] } {
  const a = isObj(authored) ? authored : {}
  const notes: string[] = []
  const brief = cleanBrief(trusted.brief)
  const ch = CHANNELS[brief.channel]
  const W = ch.w, H = ch.h
  const safe: Safe = { ...ch.safe }

  // photographs: only from the trusted table, only from allowed hosts
  const photos: Record<string, PhotoAsset> = {}
  for (const [k, v] of Object.entries(isObj(trusted.photos) ? trusted.photos : {}).slice(0, 24)) {
    const pa = photoAsset(v)
    if (pa && KEY.test(k.replace(/_/g, '-'))) photos[k] = pa; else notes.push(`photograph "${cleanText(k, 30)}" refused (source not allowed)`)
  }

  // palette and type
  const tk = isObj(a.tokens) ? a.tokens : {}
  const palette: Record<string, string> = {}
  for (const [k, v] of Object.entries(isObj(tk.color) ? tk.color : {}).slice(0, 14)) if (KEY.test(k) && HEX.test(String(v))) palette[k] = hex6(String(v))
  if (!Object.keys(palette).length) { palette.ground = '#000000'; palette.ink = '#FFFFFF'; notes.push('no usable palette: black and white used') }
  const types: Record<string, TypeStyle> = {}
  for (const [k, v] of Object.entries(isObj(tk.type) ? tk.type : {}).slice(0, 8)) if (KEY.test(k)) types[k] = typeStyle(v, DEFAULT_TYPES[k] || DEFAULT_TYPES.display)
  for (const k of Object.keys(DEFAULT_TYPES)) if (!types[k]) types[k] = { ...DEFAULT_TYPES[k] }
  const mo = isObj(tk.motion) ? tk.motion : {}
  const ink = Object.values(palette).slice().sort((x, y) => lum(y) - lum(x))[0]      // the lightest colour: a readable default on unknown ground

  // scenes, laid end to end
  const scenes: Scene[] = []
  const ids = new Set<string>()
  let at = 0
  const rawScenes = Array.isArray(a.scenes) ? a.scenes.slice(0, 8) : []
  rawScenes.forEach((rs, i) => {
    if (!isObj(rs)) return
    let sid = idOf(rs.id, 's' + (i + 1)); while (ids.has(sid)) sid += 'x'; ids.add(sid)
    const dur = Math.round(num(rs.dur, 1.2, 14, 3) * 30) / 30
    const tr = isObj(rs.transitionIn) ? rs.transitionIn : {}
    const type = scenes.length === 0 ? 'none' : pick(tr.type, TRANSITIONS, 'cut')
    const transitionIn: Transition = { type }
    if (type !== 'none' && type !== 'cut') { transitionIn.dur = num(tr.dur, 0.2, Math.min(1, dur * 0.4), 0.5); if ((EASES as readonly string[]).indexOf(tr.ease) >= 0) transitionIn.ease = tr.ease }
    if (type === 'push' || type === 'slide' || type === 'wipe') transitionIn.dir = pick(tr.dir, DIRS, 'up')
    const layers: Layer[] = []
    ;(Array.isArray(rs.layers) ? rs.layers.slice(0, 28) : []).forEach((rl: unknown, n: number) => { const l = layer(rl, { W, H, dur, palette, types, photos, ink, notes, ids, sid, n }); if (l) layers.push(l) })
    if (!layers.length) { notes.push(`${sid}: dropped, nothing drawable in it`); return }
    // every scene starts on a finished ground, so no frame is ever empty
    if (layers[0].type !== 'fill') layers.unshift({ id: sid + '-ground', type: 'fill', color: Object.keys(palette)[0] })
    for (const l of layers) if (l.type === 'motif' && l.target && !layers.some(x => x.id === l.target)) delete l.target
    scenes.push({ id: sid, name: cleanText(rs.name, 60) || 'Scene ' + (scenes.length + 1), start: Math.round(at * 1000) / 1000, dur, transitionIn, layers })
    at += dur
  })
  if (!scenes.length) notes.push('no drawable scene')
  const duration = Math.round(at * 1000) / 1000

  // script and social
  const sc = isObj(a.script) ? a.script : {}
  const lines: { scene: string; vo: string }[] = []
  for (const ln of Array.isArray(sc.lines) ? sc.lines.slice(0, 12) : []) if (isObj(ln) && scenes.some(s => s.id === ln.scene)) lines.push({ scene: String(ln.scene), vo: cleanText(ln.vo, 300) })
  const alternates: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(isObj(sc.alternates) ? sc.alternates : {}).slice(0, 12)) if (scenes.some(s => s.id === k) && Array.isArray(v)) alternates[k] = v.slice(0, 4).map(x => cleanText(x, 300)).filter(Boolean)
  const so = isObj(a.social) ? a.social : {}
  const co = isObj(a.concept) ? a.concept : {}
  const used = new Set<string>()
  for (const s of scenes) for (const l of s.layers) if (l.type === 'photo') used.add(l.photo)
  const usedPhotos: Record<string, PhotoAsset> = {}
  for (const k of Object.keys(photos)) if (used.has(k)) usedPhotos[k] = photos[k]
  const music = trusted.music || { track: '' }
  const m = trusted.meta || {}
  const now = new Date().toISOString()
  const doc: Composition = {
    format: ADX_FORMAT,
    id: idOf(trusted.id, 'piece'),
    title: cleanText(trusted.title || a.title || co.name, 120) || 'Untitled piece',
    brief,
    concept: { name: cleanText(co.name, 80), idea: cleanText(co.idea, 500), look: pick(co.look, LOOK_KEYS, 'colour-field'), identity: idOf(co.identity || brief.moment, '') },
    canvas: { w: W, h: H, fps: 30, duration, safe },
    tokens: { color: palette, type: types, motion: { language: cleanText(mo.language, 40), ease: pick(mo.ease, EASES, 'outExpo'), easeMove: pick(mo.easeMove, EASES, 'inOutCubic') } },
    assets: { photos: usedPhotos, logo: LOGO, audio: { music: { track: /^[a-z0-9]{1,24}$/.test(String(music.track || '')) ? String(music.track) : '', gain: num(music.gain, 0, 1, 0.5), credit: cleanText(music.credit, 160), fadeOut: num(music.fadeOut, 0, 8, MUSIC_FADE_OUT), start: num(music.start, 0, 90, 0) } } },
    script: { lines, alternates },
    scenes,
    social: {
      caption: cleanText(so.caption, 2200),
      captionAlternates: (Array.isArray(so.captionAlternates) ? so.captionAlternates.slice(0, 3) : []).map((x: unknown) => cleanText(x, 2200)).filter(Boolean),
      hashtags: (Array.isArray(so.hashtags) ? so.hashtags.slice(0, 6) : []).map((x: unknown) => String(x || '').trim()).filter((x: string) => /^#[A-Za-z0-9_]{1,40}$/.test(x)),
    },
    rules: rulesFor(brief),
    meta: { createdAt: cleanText(m.createdAt, 40) || now, updatedAt: cleanText(m.updatedAt, 40) || now, updatedBy: cleanText(m.updatedBy, 120), origin: pick(m.origin, ['composer', 'house', 'edited'] as const, 'composer'), ...(Number.isFinite(Number(m.costUsd)) && Number(m.costUsd) > 0 ? { costUsd: Math.round(Number(m.costUsd) * 10000) / 10000 } : {}) },
  }
  return { doc, notes }
}

/** A saved or seeded document, read back through the same door (its own brief, canvas and photo table are the trusted half). */
export function reopenComposition(stored: unknown): { doc: Composition; notes: string[] } {
  const s = isObj(stored) ? stored : {}
  const assets = isObj(s.assets) ? s.assets : {}
  const music = isObj(assets.audio) && isObj(assets.audio.music) ? assets.audio.music : {}
  return sanitizeComposition(s, { id: String(s.id || ''), title: typeof s.title === 'string' ? s.title : undefined, brief: s.brief as Brief, canvas: s.canvas as Composition['canvas'], photos: isObj(assets.photos) ? (assets.photos as Record<string, PhotoAsset>) : {}, music: { track: String(music.track || ''), gain: music.gain, credit: String(music.credit || ''), fadeOut: music.fadeOut, start: music.start }, meta: isObj(s.meta) ? s.meta : {} })
}

// ── colour maths shared by the player and the audit ─────────────────────────────────────────────────────────────
export function rgbOf(hex: string): [number, number, number] { const h = hex6(HEX.test(hex) ? hex : '#000000'); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] }
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function lum(hex: string): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const contrast = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

// ── words in and out of a text layer, for editing in place: *stars* mark the accent, a new line is a break ──────
export function runsToPlain(l: TextLayer): string {
  let out = ''
  for (const r of l.runs) out += 'br' in r ? '\n' : r.style || r.color ? '*' + r.t.trim() + '*' + (/\s$/.test(r.t) ? ' ' : '') : r.t
  return out
}
/** The accent run's look is kept from the layer as it was authored, so retyping never loses the design. */
export function plainToRuns(text: string, was: TextLayer): Run[] {
  const accent = was.runs.find(r => !('br' in r) && (r.style || r.color)) as { t: string; style?: string; color?: string } | undefined
  const runs: Run[] = []
  String(text || '').replace(/\r/g, '').split('\n').slice(0, 6).forEach((line, i) => {
    if (i) runs.push({ br: true })
    line.split('*').forEach((part, k) => {
      const t = part.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 140)
      if (!t.trim()) { if (t && runs.length && !('br' in runs[runs.length - 1])) (runs[runs.length - 1] as { t: string }).t += ' '; return }
      if (k % 2 === 1 && accent) runs.push({ t: t.trim(), ...(accent.style ? { style: accent.style } : {}), ...(accent.color ? { color: accent.color } : {}) })
      else runs.push({ t: k % 2 === 1 ? t.trim() : t })
    })
  })
  // spaces between a plain run and the accent that follows it live on the plain run
  for (let i = 0; i < runs.length - 1; i++) { const a = runs[i], b = runs[i + 1]; if (!('br' in a) && !('br' in b) && (b.style || b.color) && !/\s$/.test(a.t)) a.t += ' ' }
  for (let i = 1; i < runs.length; i++) { const a = runs[i - 1], b = runs[i]; if (!('br' in a) && !('br' in b) && (a.style || a.color) && !/^\s/.test(b.t) && !/^[.,!?;:]/.test(b.t)) b.t = ' ' + b.t }
  return runs.length && runs.some(r => !('br' in r)) ? runs : was.runs
}
