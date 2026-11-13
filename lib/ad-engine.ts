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

import qrcode from 'qrcode-generator'
import { drawSignatureFrame } from './ad-signature'
import { CURRENT_OWNER_MOMENTS } from './marketing-calendar'

/** The Signature look's layouts (lib/ad-signature). */
export type SigLayoutKey = 'hero' | 'list' | 'numbers' | 'cards' | 'gallery' | 'quote' | 'end'
export const SIG_LAYOUTS: { key: SigLayoutKey; label: string; hint: string }[] = [
  { key: 'hero', label: 'Hero', hint: 'One photo, full screen, headline set over it' },
  { key: 'list', label: 'List', hint: 'Photo above, up to four numbered rows below' },
  { key: 'numbers', label: 'Numbers', hint: 'Up to three figures that count up (rows like 40+|Booking platforms)' },
  { key: 'cards', label: 'Photo cards', hint: 'Two or three cards, each its own photo, title and line (rows like Title|detail; one photo per row)' },
  { key: 'gallery', label: 'Montage', hint: 'Up to four photos, quick full-screen cuts, headline on the last' },
  { key: 'quote', label: 'Quote', hint: 'A guest or owner line in large serif, who said it under' },
  { key: 'end', label: 'End card', hint: 'Logo, headline, button, QR code' },
]
export type AdKind = 'title' | 'cinema' | 'kinetic' | 'reveal' | 'mask' | 'panel' | 'ticker' | 'callouts' | 'polaroid' | 'event' | 'photo' | 'stats' | 'wall' | 'cards' | 'feed' | 'checks' | 'rise' | 'timeline' | 'team' | 'quote' | 'poster' | 'contact' | 'cta'
  | 'beats' | 'tiles' | 'grid' | 'calendar' | 'dates' | 'hub' | 'beforeafter' | 'tilegrid' | 'livefeed' | 'roles' | 'curve' | 'triad'
/** Jon, 2026-11-02: "need more style … a wide range of edits, range of styles and looks". */
export type AdStyle = {
  font: 'auto' | 'sans' | 'serif' | 'condensed' | 'elegant'
  caps: 'auto' | 'on' | 'off'
  grade: 'auto' | 'natural' | 'warm' | 'cool' | 'mono' | 'vivid' | 'faded' | 'duotone' | 'golden' | 'noir'
  pace: 'calm' | 'normal' | 'fast'
  finish: 'auto' | 'film' | 'soft' | 'glow' | 'clean'
  frame: 'none' | 'border' | 'letterbox'
  logo: 'auto' | 'gold' | 'black' | 'white' | 'accent' | 'off'
  /** What the Stay mark wears for the season (Jon, 2026-11-10: "revamp logo to fit theme, maybe add Christmas lights to the logo"). */
  dress?: 'auto' | LogoDress
  /** What sits over the photo: the look's colour wash, a neutral scrim for legibility, or nothing at all (Jon, 2026-11-04: "some with no filter"). */
  wash?: 'auto' | 'look' | 'neutral' | 'none'
  /** Custom colours on top of the look ('' = the look's own). */
  accent?: string
  base?: string
  text?: string
}
export type LogoDress = 'none' | 'lights' | 'snow' | 'xmas' | 'sparkle' | 'leaves' | 'hearts' | 'glow' | 'bats' | 'stars'
export const STYLE_DEFAULT: AdStyle = { font: 'auto', caps: 'auto', grade: 'auto', pace: 'normal', finish: 'auto', frame: 'none', logo: 'auto', dress: 'auto', wash: 'auto' }
export const STYLE_OPTIONS: { [K in keyof AdStyle]: { key: AdStyle[K]; label: string }[] } = {
  font: [{ key: 'auto', label: 'Look’s own' }, { key: 'sans', label: 'Bold sans' }, { key: 'serif', label: 'Serif' }, { key: 'condensed', label: 'Condensed' }, { key: 'elegant', label: 'Elegant' }],
  caps: [{ key: 'auto', label: 'Look’s own' }, { key: 'on', label: 'ALL CAPS' }, { key: 'off', label: 'Normal case' }],
  grade: [{ key: 'auto', label: 'Look’s own' }, { key: 'natural', label: 'Natural' }, { key: 'warm', label: 'Warm' }, { key: 'cool', label: 'Cool' }, { key: 'vivid', label: 'Vivid' }, { key: 'faded', label: 'Faded film' }, { key: 'mono', label: 'Black & white' }, { key: 'duotone', label: 'Duotone' }, { key: 'golden', label: 'Gold tone' }, { key: 'noir', label: 'Noir' }],
  pace: [{ key: 'calm', label: 'Calm' }, { key: 'normal', label: 'Normal' }, { key: 'fast', label: 'Fast' }],
  finish: [{ key: 'auto', label: 'Look’s own' }, { key: 'film', label: 'Film grain' }, { key: 'soft', label: 'Soft' }, { key: 'glow', label: 'Light leak' }, { key: 'clean', label: 'Clean' }],
  frame: [{ key: 'none', label: 'Full bleed' }, { key: 'border', label: 'Border' }, { key: 'letterbox', label: 'Letterbox' }],
  logo: [{ key: 'auto', label: 'Look’s own' }, { key: 'white', label: 'White' }, { key: 'black', label: 'Black' }, { key: 'accent', label: 'Theme colour' }, { key: 'gold', label: 'Gold' }, { key: 'off', label: 'Off' }],
  dress: [{ key: 'auto', label: 'Look’s own' }, { key: 'none', label: 'Plain' }, { key: 'xmas', label: 'Lights + snow' }, { key: 'lights', label: 'Christmas lights' }, { key: 'snow', label: 'Snow cap' }, { key: 'sparkle', label: 'Sparkle' }, { key: 'leaves', label: 'Autumn leaves' }, { key: 'hearts', label: 'Hearts' }, { key: 'stars', label: 'Stars' }, { key: 'glow', label: 'Neon glow' }, { key: 'bats', label: 'Bats' }],
  wash: [{ key: 'auto', label: 'Look’s own' }, { key: 'look', label: 'Colour wash' }, { key: 'neutral', label: 'Just a scrim' }, { key: 'none', label: 'No filter' }],
}

/** How a scene arrives from the one before it. 'auto' varies them across the ad. */
export type AdTransition = 'auto' | 'fade' | 'zoom' | 'push' | 'wipe' | 'flash' | 'cut' | 'slide' | 'iris' | 'blinds' | 'spin' | 'blur' | 'doors' | 'glitch' | 'whip' | 'dip' | 'diamond' | 'crosszoom' | 'leak' | 'split' | 'dipwhite'
export const TRANSITIONS: AdTransition[] = ['auto', 'fade', 'crosszoom', 'zoom', 'push', 'slide', 'whip', 'wipe', 'iris', 'diamond', 'doors', 'split', 'blinds', 'spin', 'blur', 'leak', 'glitch', 'dip', 'dipwhite', 'flash', 'cut']
/** THE TRANSITIONS BROWSER (Jon, 2026-11-10: "build transitions between scenes like Final Cut Pro"). Each one
 *  named the way an editor knows it, grouped the way Final Cut groups them, with its own length and — where it
 *  moves — a direction. */
export type TrDir = 'left' | 'right' | 'up' | 'down'
export type TrLen = 'short' | 'normal' | 'long'
export const TR_DIRECTIONAL: AdTransition[] = ['push', 'slide', 'whip', 'wipe']
export const TR_LEN: Record<TrLen, number> = { short: 0.6, normal: 1, long: 1.7 }
export const TRANSITION_META: { key: AdTransition; label: string; hint: string; group: 'Dissolves' | 'Movements' | 'Wipes' | 'Lights' | 'Stylized' }[] = [
  { key: 'auto', label: 'Auto', hint: 'Picked for the look and the pace', group: 'Dissolves' },
  { key: 'fade', label: 'Cross dissolve', hint: 'The classic: one picture melts into the next', group: 'Dissolves' },
  { key: 'dip', label: 'Fade to black', hint: 'Out to black, then in — a chapter break', group: 'Dissolves' },
  { key: 'dipwhite', label: 'Fade to white', hint: 'Out to white, then in — bright and airy', group: 'Dissolves' },
  { key: 'blur', label: 'Blur dissolve', hint: 'Soft focus between the two', group: 'Dissolves' },
  { key: 'cut', label: 'Hard cut', hint: 'No transition — cut on the beat', group: 'Dissolves' },
  { key: 'crosszoom', label: 'Cross zoom', hint: 'Zooms through the first picture into the next, with motion blur', group: 'Movements' },
  { key: 'zoom', label: 'Zoom in', hint: 'The next scene settles in from slightly larger', group: 'Movements' },
  { key: 'push', label: 'Push', hint: 'The new scene pushes the old one off screen', group: 'Movements' },
  { key: 'slide', label: 'Slide', hint: 'The new scene slides over the old one', group: 'Movements' },
  { key: 'whip', label: 'Whip pan', hint: 'A fast camera whip with motion blur', group: 'Movements' },
  { key: 'spin', label: 'Spin', hint: 'Rotates and scales in', group: 'Movements' },
  { key: 'wipe', label: 'Wipe', hint: 'A clean angled edge sweeps across', group: 'Wipes' },
  { key: 'iris', label: 'Circle', hint: 'Opens from the centre in a circle', group: 'Wipes' },
  { key: 'diamond', label: 'Diamond', hint: 'Opens from the centre in a diamond', group: 'Wipes' },
  { key: 'doors', label: 'Doors open', hint: 'Opens from the middle outwards', group: 'Wipes' },
  { key: 'split', label: 'Split', hint: 'The old scene splits top and bottom to reveal the next', group: 'Wipes' },
  { key: 'blinds', label: 'Blinds', hint: 'Horizontal bands roll open', group: 'Wipes' },
  { key: 'leak', label: 'Light leak', hint: 'A warm film light-leak washes across', group: 'Lights' },
  { key: 'flash', label: 'Flash', hint: 'A white camera flash on the cut', group: 'Lights' },
  { key: 'glitch', label: 'Glitch', hint: 'Digital tearing — tech, nightlife', group: 'Stylized' },
]
export const trMeta = (k: string) => TRANSITION_META.find(x => x.key === k)
/** How a scene's headline arrives (Jon, 2026-11-03: "more everything"). */
export type AdTextAnim = 'auto' | 'rise' | 'pop' | 'type' | 'wipe' | 'blur' | 'words' | 'drop'
export const TEXT_ANIMS: { key: AdTextAnim; label: string }[] = [{ key: 'auto', label: 'Auto' }, { key: 'rise', label: 'Rise' }, { key: 'pop', label: 'Pop' }, { key: 'words', label: 'Word by word' }, { key: 'type', label: 'Typewriter' }, { key: 'wipe', label: 'Wipe' }, { key: 'blur', label: 'Focus' }, { key: 'drop', label: 'Drop' }]
/** The camera move on a scene's photo. */
export type AdCam = 'auto' | 'in' | 'out' | 'left' | 'right' | 'up' | 'still' | 'drift'
export const CAMS: { key: AdCam; label: string }[] = [{ key: 'auto', label: 'Auto' }, { key: 'in', label: 'Push in' }, { key: 'out', label: 'Pull out' }, { key: 'left', label: 'Pan left' }, { key: 'right', label: 'Pan right' }, { key: 'up', label: 'Tilt up' }, { key: 'drift', label: 'Drift' }, { key: 'still', label: 'Still' }]
/** Colour presets for the custom-colour controls (beyond the looks). */
export const SWATCHES = ['#D2B077', '#0D2131', '#FFFFFF', '#111111', '#F4EEE4', '#E2412B', '#FF5FA2', '#FF8A5B', '#F2B544', '#5FE0D2', '#2F7DF6', '#4CC488', '#7B5CF0', '#1D3A31', '#B5562E', '#E9D8B4']
export type AdAudience = 'owners' | 'partners' | 'guests'
export type AdFormat = '16:9' | '9:16' | '1:1' | '4:5' | 'letter'
/** What a project is (Jon, 2026-11-04): a video ad, a static flyer/poster, a short animated post, or an owner story. */
export type AdKindOf = 'video' | 'flyer' | 'post' | 'story'
export type AdScene = {
  id: string
  kind: AdKind
  /** How this scene comes in (default auto). */
  tr?: AdTransition
  /** The transition's length and, for push / slide / whip / wipe, which way it travels. */
  trs?: TrLen
  trd?: TrDir
  /** Headline animation, camera move and an optional badge/sticker. */
  anim?: AdTextAnim
  cam?: AdCam
  badge?: string
  /** What the voice says over this scene. Empty = a music-only beat. */
  vo: string
  /** On-screen headline. Wrap a word in **double stars** to give it the accent colour. A newline forces a break. */
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
  /** Motion graphics layered on the scene (FX keys). */
  fx?: string[]
  /** Per-graphic options (placement, size, amount, speed, colour, variant, blink), keyed by FX key. Missing = that graphic's default. */
  fxo?: Record<string, FxOpts>
  /** Pro designs: a small mono line above the content (e.g. NIGHTLY RATE · NEXT 5 WEEKS). */
  eyebrow?: string
  /** How dark the photo behind the scene is: 1 light · 0 normal · 2 dark. Missing = the design's default. */
  dim?: number
  /** This scene's own styling on top of the look (Jon, 2026-11-10: "more custom designs"). Missing = the look's. */
  cu?: SceneCustom
  /** EVENT AD (Jon, 2026-11-12: "Event, things to do, and then hit them with book your Stay now"): which act the
   *  scene belongs to — 'event' (the vibe of the event), 'todo' (things to do nearby), 'book' (our listings + CTA). */
  act?: AdAct
  /** Where the scene's picture comes from: 'ai' (generated for us), 'stock' (licensed), 'ours' (our listing photos).
   *  A 'book' scene is always 'ours'. */
  src?: AdImgSource
  /** The AI image description for this scene (generic — no names, logos or real people; lib/ad-image-prompt). */
  imgPrompt?: string
  /** Planned as an AI image but not generated yet — the photo shown is a stock stand-in. */
  aiPending?: boolean
  /** A QR code on the scene (Jon, 2026-11-12: "add the QR codes … for the free estimators"): the link it
   *  opens and the line under it. Drawn as a white tile, crisp at any export size. */
  qr?: string
  qrLabel?: string
  /** Signature look: which of its six layouts draws this scene ('' / missing = picked from the content). */
  sig?: SigLayoutKey
}
export type AdAct = 'event' | 'todo' | 'book'
export type AdImgSource = 'ai' | 'stock' | 'ours'
/** Per-scene custom design: every field optional, each one overrides the ad's look for this scene only. */
export type SceneCustom = {
  /** Headline size against the design's own. */
  size?: 'S' | 'L' | 'XL'
  font?: 'sans' | 'serif' | 'condensed' | 'elegant'
  /** Accent (the gold words, rules, buttons) and text colour, as #rrggbb. */
  accent?: string
  text?: string
  /** What sits over the photo: nothing (true colour), a lighter wash, or a darker one. */
  shade?: 'none' | 'light' | 'dark'
  grade?: 'natural' | 'warm' | 'cool' | 'vivid' | 'faded' | 'mono'
  /** Which part of the photo shows when it is cropped: -1 left/top … 1 right/bottom. */
  fx?: number
  fy?: number
  /** Extra zoom into the photo: 1.15, 1.3, 1.5. */
  zoom?: number
}
export const CU_SIZE: { key: '' | 'S' | 'L' | 'XL'; label: string; k: number }[] = [{ key: 'S', label: 'Smaller', k: 0.8 }, { key: '', label: 'Normal', k: 1 }, { key: 'L', label: 'Larger', k: 1.2 }, { key: 'XL', label: 'Largest', k: 1.4 }]
export const CU_FONTS: { key: '' | NonNullable<SceneCustom['font']>; label: string }[] = [{ key: '', label: 'Look’s own' }, { key: 'sans', label: 'Bold sans' }, { key: 'serif', label: 'Serif' }, { key: 'condensed', label: 'Condensed' }, { key: 'elegant', label: 'Elegant' }]
export const CU_SHADES: { key: '' | NonNullable<SceneCustom['shade']>; label: string; hint: string }[] = [{ key: '', label: 'Look’s own', hint: 'The wash the look was designed with' }, { key: 'none', label: 'No filter', hint: 'The photo exactly as shot' }, { key: 'light', label: 'Lighter', hint: 'Less wash — more of the photo' }, { key: 'dark', label: 'Darker', hint: 'More wash — the words stand out' }]
export const CU_GRADES: { key: '' | NonNullable<SceneCustom['grade']>; label: string }[] = [{ key: '', label: 'Look’s own' }, { key: 'natural', label: 'Natural' }, { key: 'warm', label: 'Warm' }, { key: 'cool', label: 'Cool' }, { key: 'vivid', label: 'Vivid' }, { key: 'faded', label: 'Faded' }, { key: 'mono', label: 'Black & white' }]
export const CU_ZOOMS = [1, 1.15, 1.3, 1.5]
/** True when a scene carries any custom styling. */
export const hasCustom = (sc: Pick<AdScene, 'cu'>) => !!sc.cu && Object.keys(sc.cu).some(k => { const v = (sc.cu as any)[k]; return v !== undefined && v !== '' && v !== null && !(k === 'zoom' && v === 1) && !((k === 'fx' || k === 'fy') && v === 0) })
/** Clean a custom block coming from a saved file or the browser: unknown keys and bad values dropped. */
export function cleanCustom(c: any): SceneCustom | undefined {
  if (!c || typeof c !== 'object') return undefined
  const o: SceneCustom = {}
  const hex = (v: any) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
  if (['S', 'L', 'XL'].indexOf(c.size) >= 0) o.size = c.size
  if (['sans', 'serif', 'condensed', 'elegant'].indexOf(c.font) >= 0) o.font = c.font
  if (hex(c.accent)) o.accent = c.accent
  if (hex(c.text)) o.text = c.text
  if (['none', 'light', 'dark'].indexOf(c.shade) >= 0) o.shade = c.shade
  if (['natural', 'warm', 'cool', 'vivid', 'faded', 'mono'].indexOf(c.grade) >= 0) o.grade = c.grade
  const n = (v: any, a: number, b: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : 0 }
  if (n(c.fx, -1, 1)) o.fx = n(c.fx, -1, 1)
  if (n(c.fy, -1, 1)) o.fy = n(c.fy, -1, 1)
  if (n(c.zoom, 1, 2) > 1) o.zoom = n(c.zoom, 1, 2)
  return Object.keys(o).length ? o : undefined
}
export type FxOpts = { pos?: string; size?: 'S' | 'M' | 'L'; amt?: 'low' | 'med' | 'high'; speed?: 'slow' | 'normal' | 'fast'; color?: string; variant?: string; blink?: 'on' | 'off' }
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
  /** The visual style (LOOKS): accent colour, base and photo tint. */
  look?: string
  /** What the ad is for (GOALS), set when it was started. */
  goal?: string
  /** Where it will run (PLATFORMS key) — sets the shape, the safe zones and the length rules. */
  platform?: string
  /** What this project is: video (default), flyer (one static design), post (a short loop), story. */
  kind?: AdKindOf
  /** The calendar moment it was made for (marketing-calendar key), if any. */
  moment?: string
  /** Signature look: the season's colours (a key of SIG_TONES in lib/ad-signature). Without it the moment decides. */
  tone?: string
  /** Team workflow: draft → review → approved, with notes for whoever picks it up next. */
  status?: 'draft' | 'review' | 'approved'
  notes?: string
  /** The Instagram / Facebook caption that goes out with the piece (Jon, 2026-11-10: "cool photos, captions and ads"). */
  social?: string
  /** Fine-grained style on top of the look (each 'auto' falls back to the look's own choice). */
  style?: AdStyle
  scenes: AdScene[]
  contact: AdContact
  voice: AdVoice | null
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export const FORMATS: Record<AdFormat, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], letter: [2550, 3300] }
export const FORMAT_LABEL: Record<AdFormat, string> = { '16:9': 'Landscape 16:9 · YouTube, web', '9:16': 'Vertical 9:16 · Reels, TikTok, Stories', '1:1': 'Square 1:1 · Feed posts', '4:5': 'Portrait 4:5 · Instagram and Facebook feed', letter: 'Letter 8.5×11 in · print' }
/** Flyer sizes. */
export const FLYER_SIZES: { key: AdFormat; label: string; hint: string }[] = [
  { key: '4:5', label: 'Instagram post', hint: '1080×1350' },
  { key: '9:16', label: 'Story', hint: '1080×1920' },
  { key: '1:1', label: 'Square', hint: '1080×1080' },
  { key: 'letter', label: 'Print · Letter', hint: '8.5×11 in at 300 dpi' },
  { key: '16:9', label: 'Screen / slide', hint: '1920×1080' },
]

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
  // 2026-11-04 (Jon: "need more sounds, more music that we can use"). All Kevin MacLeod, CC BY 4.0 — the credit is
  // drawn into the end card like the first six. Trimmed to 100 s with a fade.
  { key: 'jingle', label: 'Jingle Bells (calm)', mood: 'Christmas, gentle', file: '/ads/music/jingle-bells-calm.mp3', credit: KM('Jingle Bells Calm') },
  { key: 'deckhalls', label: 'Deck the Halls', mood: 'Christmas, bright', file: '/ads/music/deck-the-halls-b.mp3', credit: KM('Deck the Halls B') },
  { key: 'sugarplum', label: 'Sugar Plum Fairy', mood: 'Holiday, elegant', file: '/ads/music/dance-of-the-sugar-plum-fairy.mp3', credit: KM('Dance of the Sugar Plum Fairy') },
  { key: 'electrodoodle', label: 'Electrodoodle', mood: 'Electronic, festival', file: '/ads/music/electrodoodle.mp3', credit: KM('Electrodoodle') },
  { key: 'pamgaea', label: 'Pamgaea', mood: 'Electronic, driving', file: '/ads/music/pamgaea.mp3', credit: KM('Pamgaea') },
  { key: 'glitter', label: 'Glitter Blast', mood: 'Party, big', file: '/ads/music/glitter-blast.mp3', credit: KM('Glitter Blast') },
  { key: 'crypto', label: 'Crypto', mood: 'Tech, owners', file: '/ads/music/crypto.mp3', credit: KM('Crypto') },
  { key: 'dispersion', label: 'Dispersion Relation', mood: 'Ambient, calm', file: '/ads/music/dispersion-relation.mp3', credit: KM('Dispersion Relation') },
  { key: 'floating', label: 'Floating Cities', mood: 'Cinematic, soft', file: '/ads/music/floating-cities.mp3', credit: KM('Floating Cities') },
  { key: 'heart', label: 'Heart of Nowhere', mood: 'Cinematic, warm', file: '/ads/music/heart-of-nowhere.mp3', credit: KM('Heart of Nowhere') },
  { key: 'deliberate', label: 'Deliberate Thought', mood: 'Thoughtful piano', file: '/ads/music/deliberate-thought.mp3', credit: KM('Deliberate Thought') },
  { key: 'dreamer', label: 'Dreamer', mood: 'Dreamy, light', file: '/ads/music/dreamer.mp3', credit: KM('Dreamer') },
  { key: 'carefree', label: 'Carefree', mood: 'Ukulele, happy', file: '/ads/music/carefree.mp3', credit: KM('Carefree') },
  { key: 'beachfront', label: 'Beachfront Celebration', mood: 'Tropical, upbeat', file: '/ads/music/beachfront-celebration.mp3', credit: KM('Beachfront Celebration') },
  { key: 'bossa', label: 'Bossa Antigua', mood: 'Bossa nova, chic', file: '/ads/music/bossa-antigua.mp3', credit: KM('Bossa Antigua') },
  { key: 'smooth', label: 'Smooth Lovin', mood: 'Smooth jazz, romantic', file: '/ads/music/smooth-lovin.mp3', credit: KM('Smooth Lovin') },
  { key: 'docks', label: 'Night on the Docks', mood: 'Sax, late night', file: '/ads/music/night-on-the-docks-sax.mp3', credit: KM('Night on the Docks - Sax') },
  { key: 'ultralounge', label: 'Ultralounge', mood: 'Lounge, cool', file: '/ads/music/ultralounge.mp3', credit: KM('Ultralounge') },
  { key: 'airport', label: 'Airport Lounge', mood: 'Lounge, travel', file: '/ads/music/airport-lounge.mp3', credit: KM('Airport Lounge') },
  { key: 'lobby', label: 'Lobby Time', mood: 'Jazz, lobby', file: '/ads/music/lobby-time.mp3', credit: KM('Lobby Time') },
  { key: 'hidden', label: 'Hidden Agenda', mood: 'Sleek, modern', file: '/ads/music/hidden-agenda.mp3', credit: KM('Hidden Agenda') },
  { key: 'cheery', label: 'Cheery Monday', mood: 'Bright, quick', file: '/ads/music/cheery-monday.mp3', credit: KM('Cheery Monday') },
  { key: 'impact', label: 'Impact Moderato', mood: 'Epic, trailer', file: '/ads/music/impact-moderato.mp3', credit: KM('Impact Moderato') },
  { key: 'macabre', label: 'Danse Macabre', mood: 'Halloween, classical', file: '/ads/music/danse-macabre.mp3', credit: KM('Danse Macabre') },
  { key: 'none', label: 'No music', mood: '', file: '', credit: '' },
]
export const VOICE_DEFAULTS = { stability: 0.5, style: 0.2, speed: 1 }
export const KINDS: { kind: AdKind; label: string; hint: string }[] = [
  { kind: 'mask', label: 'Text mask', hint: 'Giant headline (1 to 3 short words) with the photo showing through the letters. Bold statement.' },
  { kind: 'panel', label: 'Split panel', hint: 'One photo on one side, a solid colour panel with the headline on the other. Clean and editorial.' },
  { kind: 'ticker', label: 'Ticker', hint: 'Full-screen photo with the headline scrolling across a colour band like a marquee. Energy.' },
  { kind: 'callouts', label: 'Callouts', hint: 'One photo with up to 4 short feature labels stacked beside it (e.g. Rooftop pool). Rows: the labels.' },
  { kind: 'polaroid', label: 'Polaroid', hint: 'One photo in a white instant-photo frame that drops in, caption written on it. Personal, warm.' },
  { kind: 'event', label: 'Event / date', hint: 'A big date block for an event or season. Row 1: the date (e.g. DEC 5–7). Headline: the event.' },
  { kind: 'cinema', label: 'Cinematic', hint: 'Letterboxed full-screen photo, slow dolly, elegant headline and a small place line. Best opener.' },
  { kind: 'kinetic', label: 'Kinetic type', hint: 'The headline punches in word by word, huge, over a blurred photo. 2 to 6 words. Great hook.' },
  { kind: 'reveal', label: 'Reveal', hint: 'The photo opens out of a circle with a ring of light; headline lands in the lower third.' },
  { kind: 'title', label: 'Title', hint: 'Big headline over a photo. **Gold** words, one line per beat.' },
  { kind: 'photo', label: 'Photo', hint: 'One photo full-bleed, headline in the lower third.' },
  { kind: 'wall', label: 'Montage', hint: 'Full-screen photos one after another in quick cuts (2 to 5 photos), headline holds over them. Never a grid.' },
  { kind: 'cards', label: 'Three beats', hint: 'Three full-screen moments one after another, each with its own big title. Rows: Title|line' },
  { kind: 'stats', label: 'Numbers', hint: 'Figures that count up. Rows: 450+|listings' },
  { kind: 'feed', label: 'Live feed', hint: 'Cards that slide in, like Lighthouse at work. Rows: Title|detail' },
  { kind: 'checks', label: 'Checklist', hint: 'Items that tick off, beside a photo. Rows: item' },
  { kind: 'rise', label: 'Results', hint: 'Headline with a rising line. Rows become chips.' },
  { kind: 'timeline', label: 'Timeline', hint: 'Milestones along a gold line, landing one by one. Rows: Week 1|Agreement and walk-through. Up to 6.' },
  { kind: 'team', label: 'Team', hint: 'People cards: a round photo (or initials), name and role. Rows: Name|Role; one photo per row, in order. Up to 6.' },
  { kind: 'quote', label: 'Quote', hint: 'One line we stand behind, big, with a big quotation mark; the sub line is who said it. Photo behind.' },
  { kind: 'poster', label: 'Poster', hint: 'A designed page. Row 1: the date; row 2: the button text; row 3 (optional): dark · gallery · neon · band to force a style (otherwise light looks get the gallery mat, Festival and Miami get neon). Flyers and posts.' },
  { kind: 'contact', label: 'Contact card', hint: 'The end card: photo, Book a call, number, email.' },
  { kind: 'cta', label: 'Book now', hint: 'Guest end card / social post: photo, headline, a button. Row 1 is the button text.' },
  // Pro designs — the twelve from the two sales videos (2026-11-04), editable here.
  { kind: 'beats', label: 'Beat lines', hint: 'Pro · the hook: 2 to 4 short lines (one per line of the headline) landing one per beat over the photo. **Gold** the key word.' },
  { kind: 'tiles', label: 'Count-up tiles', hint: 'Pro · figures that count up under a gold rule. Rows: 450+|listings (up to 9). Sub: chips split by · (e.g. Miami · Fort Lauderdale).' },
  { kind: 'grid', label: 'Photo wall', hint: 'Pro · up to 9 photos as a labelled wall that pops in (rows label the photos). With a headline it becomes a full-bleed dimmed wall with the line over it.' },
  { kind: 'calendar', label: 'Pricing calendar', hint: 'Pro · nightly rates for 5 weeks, a few cells repricing live. Eyebrow: the label. Sub: the green tag. Row 1: footnote. Row 2: Mon–Sun base rates (189,179,…).' },
  { kind: 'dates', label: 'Event rates', hint: 'Pro · event cards that flip from a standard rate to a premium one. Rows: Dec|Art Basel Miami Beach|$309|$899. Sub: footnote.' },
  { kind: 'hub', label: 'Channel hub', hint: 'Pro · the listing at the centre with a spoke to each channel. Rows: the channels (stay-hospitality.com last turns gold). Eyebrow: centre label. Headline or sub: the line under it.' },
  { kind: 'beforeafter', label: 'Before → after', hint: 'Pro · a listing rebuilds. Photo 1: background; photos 2–4: before; 5–7: after. Sub: old title; headline: new title. Rows: the checklist.' },
  { kind: 'tilegrid', label: 'Feature tiles', hint: 'Pro · a name (Light**house**), a mono tag (eyebrow or sub) and tiles that light up in turn. Rows: the tiles (up to 12).' },
  { kind: 'livefeed', label: 'Live feed (split)', hint: 'Pro · title on the left, events sliding in on the right. Rows: Title|detail|#colour. Eyebrow + sub sit with the title.' },
  { kind: 'roles', label: 'Role tiles', hint: 'Pro · a centred headline, then tiles that light up in turn, then a line under them (sub). Rows: the roles.' },
  { kind: 'curve', label: 'Switch curve', hint: 'Pro · results: headline and chips on the left, the dashed line and the rising gold line on the right. Rows: chips. Sub: the marker label.' },
  { kind: 'triad', label: 'Three cards', hint: 'Pro · three photo cards that land with the words. Photo 1: background; photos 2–4: the cards. Rows: Title|line.' },
]

// ── Words the voice says wrong (October 2026 sessions). Applied to what the voice reads only. ──
const SPOKEN: [RegExp, string][] = [
  [/\bArt Basel\b/g, 'Art Bahzel'],
  [/\bVrbo\b/g, 'Verbo'],
  [/\bAI\b/g, 'A.I.'],
  [/\bPompano\b/g, 'Pompuhno'],
  [/\bSalato\b/g, 'Sah-lah-toe'],
  [/\bstay-hospitality\.com\b/gi, 'stay dash hospitality dot com'],
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
/** Captions show the line as people read it: a spelled-out web address or phone number goes back to its written form. */
export function captionText(vo: string): string {
  let s = String(vo || '').replace(/\*\*/g, '')
  s = s.replace(/stay\s+dash\s+hospitality\s+dot\s+com/gi, 'stay-hospitality.com')
  const D: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }
  s = s.replace(/\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,.-]*){10}/gi, m => {
    const d = (m.match(/zero|oh|one|two|three|four|five|six|seven|eight|nine/gi) || []).map(w => D[w.toLowerCase()]).join('')
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` + (/[.,]\s*$/.test(m) ? m.trim().slice(-1) + ' ' : ' ') : m
  }).trim()
  return s
}
/** Headline tidy (the writer is not reliable about it): each line starts with a capital, and the gold
 *  emphasis sits on a word that carries meaning — never "the", "your", "book" and the like. */
const FILLER = new Set(['the', 'your', 'our', 'a', 'an', 'book', 'stay', 'here', 'this', 'it', 'my', 'we', 'you', 'and', 'to', 'in', 'of', 'for', 'with', 'at', 'on', 'is', 'are', 'be', 'all', 'more', 'right', 'now', 'designed', 'made', 'just', 'every', 'one', 'that', 'its', "it's"])
/** A message to owners who are already with us (a calendar moment says so): it thanks and informs, it does not sell. */
export const toCurrentOwners = (p: { moment?: string }) => !!p.moment && CURRENT_OWNER_MOMENTS.indexOf(p.moment) >= 0
export function tidyHead(h: string): string {
  let s = String(h || '')
  // move gold off a filler word onto the strongest word in the headline
  const golds = Array.from(s.matchAll(/\*\*([^*]+)\*\*/g)).map(m => m[1])
  if (golds.length && golds.every(g => g.trim().split(/\s+/).every(w => FILLER.has(w.toLowerCase().replace(/[^a-z']/g, ''))))) {
    s = s.replace(/\*\*/g, '')
    const words = s.split(/(\s+)/)
    let best = -1, bl = 0
    words.forEach((w, i) => { const c = w.toLowerCase().replace(/[^a-z']/g, ''); if (c.length > 3 && !FILLER.has(c) && c.length >= bl) { best = i; bl = c.length } })
    if (best >= 0) { const m = words[best].match(/^([^A-Za-z]*)(.*?)([^A-Za-z]*)$/); if (m) words[best] = m[1] + '**' + m[2] + '**' + m[3] }
    s = words.join('')
  }
  // names keep their capitals
  s = s.replace(/\b(lighthouse|miami|florida|botanica|elser|amrit|nick|stay hospitality|fort lauderdale|palm beach|singer island|art basel)\b/gi, w => w.split(' ').map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(' '))
  // a capital opens the headline — and a new line only when it starts a new sentence ("Priced\nevery day", not "Priced\nEvery day")
  const lines = s.split('\n')
  return lines.map((line, k) => (k === 0 || /[.!?:]\s*(\*\*)?\s*$/.test(lines[k - 1]) ? line.replace(/^(\s*(?:\*\*)?\s*)([a-z])/, (_m, a: string, b: string) => a + b.toUpperCase()) : line)).join('\n')
}
/** THE AD AUDIT — the checks an ad expert runs before anything ships (Jon, 2026-11-03: "as an ad expert,
 *  audit this"). Deterministic; the AI review on top of it lives in /api/ads/audit. Each issue can carry a
 *  one-click fix: a scene patch or a project patch. */
export type AuditIssue = { sev: 'high' | 'med' | 'low'; scene?: number; code: string; msg: string; fix?: { scene?: Partial<AdScene>; project?: Partial<AdProject>; label: string } }
export function auditAd(p: AdProject, tl: Timeline, facts: string): AuditIssue[] {
  const out: AuditIssue[] = []
  const sc = p.scenes, n = sc.length, guests = p.audience === 'guests'
  if (!n) return [{ sev: 'high', code: 'empty', msg: 'No scenes yet.' }]
  const PF = platformOf(p)
  const first = sc[0]
  // a beat-lines hook lands one line at a time — the first line is what has to stop the scroll
  const hw = (first.kind === 'beats' ? (first.head || '').split('\n')[0] : first.head || '').replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean).length
  if (hw > 6) out.push({ sev: 'high', scene: 0, code: 'hook-long', msg: `The hook is ${hw} words — people decide in 1.5 s. Cut it to 2–5.` })
  if (!first.head.trim()) out.push({ sev: 'high', scene: 0, code: 'hook-missing', msg: 'The first scene has no headline — most people watch muted, so the hook must be on screen.' })
  if (/^(welcome|introducing|stay hospitality)/i.test(first.head.replace(/\*\*/g, '').trim())) out.push({ sev: 'med', scene: 0, code: 'hook-weak', msg: 'Opening on "Welcome" or the company name wastes the hook. Lead with a feeling, a benefit or the place.' })
  if (/^(welcome to|introducing|this is stay)/i.test(first.vo.trim())) out.push({ sev: 'low', scene: 0, code: 'hook-vo', msg: 'The first line opens with "Welcome to" - lead with the place or the feeling instead.' })
  if (!first.photos.length && ['stats', 'contact'].indexOf(first.kind) < 0) out.push({ sev: 'high', scene: 0, code: 'hook-photo', msg: 'The first scene has no photo — the strongest image belongs here.' })
  const last = sc[n - 1]
  if (guests && last.kind !== 'cta') out.push({ sev: 'high', scene: n - 1, code: 'cta', msg: 'A guest ad must end on the Book now card.', fix: { label: 'Make it the Book now card', scene: { kind: 'cta', items: ['Book at stay-hospitality.com'] } } })
  if (!guests && !toCurrentOwners(p) && last.kind !== 'contact') out.push({ sev: 'high', scene: n - 1, code: 'contact', msg: 'An owner or partner ad must end on Nick’s contact card.', fix: { label: 'Make it the contact card', scene: { kind: 'contact' } } })
  if (tl.durs[n - 1] < 3.2) out.push({ sev: 'med', scene: n - 1, code: 'end-short', msg: `The end card holds ${tl.durs[n - 1].toFixed(1)} s — too short to read the call to action.`, fix: tl.voiced ? undefined : { label: 'Hold it 4.5 s', scene: { dur: 4.5 } } })
  if (!p.captions) out.push({ sev: 'med', code: 'captions', msg: 'Captions are off — most feed viewers watch muted.', fix: { label: 'Turn captions on', project: { captions: true } } })
  if (p.music === 'none') out.push({ sev: 'low', code: 'music', msg: 'No music. Even a quiet bed lifts watch time.', fix: { label: 'Use Werq', project: { music: 'werq' } } })
  if (tl.total > PF.max) out.push({ sev: 'med', code: 'length', msg: `${tl.total.toFixed(0)} s is over the ${PF.max} s limit for a ${PF.label}. Cut scenes or lines.` })
  else if (tl.total > 35 && (PF.key === 'reel' || PF.key === 'tiktok')) out.push({ sev: 'low', code: 'length-soft', msg: `${tl.total.toFixed(0)} s on a ${PF.label}: 15–30 s keeps more viewers to the end.` })
  if (n > Math.max(4, tl.total / 2.4)) out.push({ sev: 'med', code: 'too-many', msg: `${n} scenes in ${tl.total.toFixed(0)} s is a flicker — aim for one scene every 3–4 s.` })
  // photos
  const seen = new Map<string, number>()
  // a pro design's photo 1 is its background; a photo wall's tiles and a card's contents are allowed to echo the ad
  const shown = (x: AdScene) => x.kind === 'grid' ? [] : PRO_KINDS.indexOf(x.kind) >= 0 ? x.photos.slice(0, 1) : x.photos
  sc.forEach((x, i) => shown(x).forEach(u => { if (seen.has(u)) out.push({ sev: 'med', scene: i, code: 'dup-photo', msg: `Same photo as scene ${seen.get(u)! + 1}. Give each scene its own.` }); else seen.set(u, i) }))
  sc.forEach((x, i) => { if (!x.photos.length && ['stats', 'contact', 'checks', 'feed', 'rise'].indexOf(x.kind) < 0) out.push({ sev: 'high', scene: i, code: 'no-photo', msg: 'No photo on a photo-led scene.' }) })
  // words per second, voice risks, numbers
  const allowed = new Set(numbersIn(facts + ' ' + (p.prompt || '') + ' 1M 1000000 651 200 8283'))
  sc.forEach((x, i) => {
    const w = x.vo.trim().split(/\s+/).filter(Boolean).length
    if (w && !tl.voiced && w / Math.max(1, tl.durs[i]) > 3.1) out.push({ sev: 'med', scene: i, code: 'fast', msg: `${w} words in ${tl.durs[i].toFixed(1)} s — too fast to land. Cut the line or let it hold longer.` })
    const risky = riskyWords(x.vo); if (risky.length) out.push({ sev: 'med', scene: i, code: 'voice-risk', msg: `The voice says ${risky.join(' and ')} wrong — keep it on screen only.` })
    // pricing calendars and event-rate cards carry illustrative rates, labelled as such on the slide
    const illus = (x.kind === 'calendar' || x.kind === 'dates') && /illustrat/i.test(x.sub + ' ' + x.items.join(' '))
    // colours (#E07B5F) and property names (17WEST, 3316, District 225) are not claims
    const clean = (t: string) => t.replace(/#[0-9a-f]{3,8}\b/gi, ' ').replace(/\b(17 ?west|district 225|3316|906|1587|2023|7071)\b/gi, ' ')
    const bad = numbersIn(clean([x.vo, x.head, x.sub, illus ? '' : x.items.join(' ')].join(' '))).filter(v => !allowed.has(v) && !(illus && /^\d+$/.test(v)))
    if (bad.length) out.push({ sev: x.kind === 'livefeed' ? 'low' : 'high', scene: i, code: 'number', msg: x.kind === 'livefeed' ? `The feed shows example events (${Array.from(new Set(bad)).join(', ')}) — make sure they read as examples, not results.` : `Check ${Array.from(new Set(bad)).join(', ')} — not in our facts.` })
    if (guests && /\$|\bcall us\b|\btext us\b|\d{3}[-.]\d{3}[-.]\d{4}/i.test(x.vo + ' ' + x.head + ' ' + x.items.join(' '))) out.push({ sev: 'high', scene: i, code: 'guest-rule', msg: 'Guest ads never show a price or "call us" — the only ask is to book at stay-hospitality.com.' })
    if (!x.head.trim() && !x.vo.trim() && ['wall', 'photo', 'grid'].indexOf(x.kind) < 0) out.push({ sev: 'low', scene: i, code: 'blank', msg: 'Nothing said and nothing on screen.' })
    if (i > 0 && x.kind === sc[i - 1].kind && ['photo', 'wall'].indexOf(x.kind) < 0) out.push({ sev: 'low', scene: i, code: 'same-kind', msg: `Two ${x.kind} scenes in a row — vary the design.` })
  })
  if (!sc.some(x => /\*\*/.test(x.head))) out.push({ sev: 'low', code: 'no-gold', msg: 'No highlighted word anywhere — mark the key word in a headline with **…** for the brand accent.' })
  const named = sc.some(x => /stay hospitality|17 ?west|amrit|elser|botanica|garden hotel|arya|aria|salato|capri|eden|nomad|lucerne|hendricks|boynton|park towers/i.test(x.vo + ' ' + x.head + ' ' + x.sub))
  if (!named) out.push({ sev: 'med', code: 'no-name', msg: guests ? 'The property is never named — people cannot search for it.' : 'Stay Hospitality is never named.' })
  return out.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.sev] - { high: 0, med: 1, low: 2 }[b.sev]))
}
/** FIRST-PASS TOUCH-UP (Jon, 2026-11-04: "we need a review, an audit and an overall touch-up when videos are first
 *  generated"). Runs on every freshly built ad before anyone sees it. Only safe, reversible fixes — it never rewrites
 *  what is said and never invents a fact; everything it cannot fix stays in the review as a check to make. */
const ALT_KIND: Partial<Record<AdKind, AdKind>> = { title: 'photo', photo: 'cinema', cinema: 'panel', panel: 'cinema', kinetic: 'title', mask: 'title', reveal: 'cinema', ticker: 'photo', polaroid: 'photo', callouts: 'checks', quote: 'cinema' }
const WILD_TR: AdTransition[] = ['spin', 'glitch', 'blinds', 'diamond', 'iris', 'doors', 'flash', 'whip']
export function polishAd(p0: AdProject): { project: AdProject; changes: string[] } {
  const p: AdProject = JSON.parse(JSON.stringify(p0))
  const ch: string[] = []
  const sc = p.scenes
  if (!sc.length) return { project: p, changes: ch }
  const video = (p.kind || 'video') === 'video' || p.kind === 'story'
  const guests = p.audience === 'guests'
  // the right end card, added (never replacing a scene that carries content)
  if (video) {
    const last = sc[sc.length - 1]
    if (guests && last.kind !== 'cta') {
      if (last.kind === 'contact') { last.kind = 'cta'; last.items = ['Book at stay-hospitality.com']; ch.push('Guest ad: the end card is now Book at stay-hospitality.com') }
      else { sc.push({ id: 'end' + sc.length, kind: 'cta', vo: '', head: 'Your South Florida **stay.**', sub: '', items: ['Book at stay-hospitality.com'], photos: (sc[0].photos || []).slice(0, 1), tr: 'fade' }); ch.push('Added the Book now end card') }
    }
    if (!guests && !toCurrentOwners(p) && last.kind !== 'contact') { sc.push({ id: 'end' + sc.length, kind: 'contact', vo: '', head: 'Book a **call.**', sub: '', items: [], photos: [], tr: 'fade' }); ch.push('Added Nick’s contact card as the end card') }
    if (!p.captions) { p.captions = true; ch.push('Captions on — most people watch muted') }
    if (p.music === 'none') { p.music = 'werq'; ch.push('Added a music bed (Werq)') }
  }
  // transitions: calm and consistent — the writer's flashy picks go back to the ad's own family
  let wild = 0
  sc.forEach((x, i) => { if (x.tr && WILD_TR.indexOf(x.tr) >= 0) { x.tr = 'auto'; wild++ } if (i === sc.length - 1 && (x.kind === 'cta' || x.kind === 'contact') && x.tr !== 'fade') x.tr = 'fade' })
  if (wild) ch.push(`Calmed ${wild} transition${wild > 1 ? 's' : ''} — one clean family across the ad`)
  // photos never repeat: a repeated photo is dropped where the scene has others, or swapped for a spare one
  const used = new Set<string>(), spare: string[] = []
  sc.forEach(x => { if (PRO_KINDS.indexOf(x.kind) < 0) x.photos.slice(1).forEach(u => spare.push(u)) })
  let dups = 0
  sc.forEach(x => {
    if (x.kind === 'grid') return
    if (PRO_KINDS.indexOf(x.kind) >= 0) { if (x.photos[0]) used.add(x.photos[0]); return }
    const out: string[] = []
    x.photos.forEach((u, k) => {
      if (!used.has(u)) { out.push(u); used.add(u); return }
      dups++
      if (k === 0 && x.photos.length === 1) { const alt = spare.find(s => !used.has(s)); if (alt) { out.push(alt); used.add(alt) } else out.push(u) }
    })
    x.photos = out.length ? out : x.photos
  })
  if (dups) ch.push(`Removed ${dups} repeated photo${dups > 1 ? 's' : ''} — every scene shows its own`)
  // the same design twice in a row reads as a stutter
  let swaps = 0
  for (let i = 1; i < sc.length; i++) if (sc[i].kind === sc[i - 1].kind && ALT_KIND[sc[i].kind] && sc[i].photos.length) { sc[i].kind = ALT_KIND[sc[i].kind]!; swaps++ }
  if (swaps) ch.push(`Varied ${swaps} back-to-back design${swaps > 1 ? 's' : ''}`)
  // the brand accent: a headline with no gold word gets its last word in gold
  let golds = 0
  sc.forEach(x => {
    const h = (x.head || '').trim()
    if (!h || /\*\*/.test(h) || x.kind === 'contact' || x.kind === 'beforeafter' || x.kind === 'poster' || h.split(/\s+/).length < 2) return
    const lines = h.split('\n'), L = lines.length - 1, m = lines[L].match(/^(.*\s)?(\S+)$/)
    if (!m) return
    lines[L] = (m[1] || '') + '**' + m[2] + '**'; x.head = lines.join('\n'); golds++
  })
  if (golds) ch.push(`Accent on ${golds} headline${golds > 1 ? 's' : ''}`)
  // timing without a voice take: lines get time to land, the end card holds long enough to read
  if (!p.voice) {
    let paced = 0
    sc.forEach((x, i) => {
      const w = x.vo.trim().split(/\s+/).filter(Boolean).length
      const need = w ? +(w / 2.55 + 1).toFixed(1) : 0
      if (x.dur && need && x.dur < need) { x.dur = need; paced++ }
      if (i === sc.length - 1 && video && (x.kind === 'cta' || x.kind === 'contact') && x.dur && x.dur < 4.5) { x.dur = 4.5; paced++ }
    })
    if (paced) ch.push(`Gave ${paced} scene${paced > 1 ? 's' : ''} time to land`)
  }
  return { project: p, changes: ch }
}
export function auditScore(issues: AuditIssue[]): number {
  return Math.max(0, Math.min(100, 100 - issues.reduce((a, i) => a + (i.sev === 'high' ? 15 : i.sev === 'med' ? 7 : 3), 0)))
}
/** Every number an ad may state comes from the facts or the brief (Jon: never invent numbers). */
export function numbersIn(text: string): string[] {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?\s*(?:[kKmM]\b)?/g) || []).map(n => {
    const t = n.replace(/,/g, '').trim(); const m = t.match(/^([\d.]+)\s*([kKmM])?$/)
    if (!m) return t
    const v = parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1)
    return String(v)
  })
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
  /** An elegant serif for the editorial looks (falls back to display). */
  serif?: string
  /** A condensed display face (single weight) and an elegant high-contrast serif. */
  condensed?: string
  elegant?: string
  /** The Stay mark in each colour (transparent PNGs). */
  logos?: { gold: HTMLImageElement | null; black: HTMLImageElement | null; white: HTMLImageElement | null }
  /** A scene's media — a photo, or a library video ('video:…') synced to the scene's own clock. */
  media?: (url: string, local: number) => HTMLImageElement | HTMLVideoElement | null
  logo: HTMLImageElement | null
  display: string
  body: string
  mono: string
  credit: string
}
type LookDef = { font?: 'sans' | 'serif' | 'condensed' | 'elegant'; caps?: boolean; grade?: AdStyle['grade']; finish?: AdStyle['finish']; logo?: 'gold' | 'black' | 'white'; fx?: string[]; mesh?: [string, string, string]; wash?: 'look' | 'neutral' | 'none'
  /** The mark in the look's own colour (the white logo, tinted), and what it wears for the season. */
  logoTint?: string; dress?: LogoDress }
type Palette = { serif?: boolean; light?: boolean; def?: LookDef; /** the Book button, when it is not the accent */ btn?: string; gold: string; ink: string; mut: string; navy: string; navy2: string; deep: string; tint: string; glass: string; line: string; green: string }
/** Visual styles (Jon, 2026-11-02: "create new visual … revamp … vibe"). `gold` is the accent the
 *  headline's **marked** words, rings and buttons take; `tint` darkens photos so text reads. */
/** The curated set shown first (Jon, 2026-11-04: "quality vs quantity"): six designed looks; the rest sit under "More looks". */
// THE HOUSE LOOK IS BLACK (Jon, 2026-11-10: "we are not gold theme color, look at our logo, it's black — ok to
// play with it during holiday season or be able to select it, but need to default it"). Stay black is what every
// new ad starts in and what "Default look" puts back; gold lives on as a look you pick (Navy & gold, Black & gold,
// Holiday, Champagne).
export const DEFAULT_LOOK = 'signature'
export const LOOKS_FEATURED = ['signature', 'house', 'housewhite', 'pure', 'editorial', 'ivory', 'stay', 'holiday', 'xmasred', 'winter']
export const LOOKS: { key: string; label: string; blurb: string; c: Palette }[] = [
  { key: 'signature', label: 'Signature', blurb: 'The premium look — film-graded photos, serif type set line by line, one clean wipe', c: { def: { font: 'elegant', grade: 'natural', finish: 'clean', logo: 'white', wash: 'neutral' }, gold: '#D4B47C', ink: '#F7F2E9', mut: '#B8B0A4', navy: '#0E0F11', navy2: '#16181B', deep: '#000000', tint: '0,0,0', glass: 'rgba(0,0,0,0.58)', line: 'rgba(255,255,255,0.2)', green: '#9BE3B5' } },
  { key: 'house', label: 'Stay black', blurb: 'The house look — black, white type, the Stay logo', c: { def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'white', wash: 'neutral' }, gold: '#FFFFFF', ink: '#FFFFFF', mut: '#B4B4B4', navy: '#0A0A0A', navy2: '#1B1B1B', deep: '#000000', tint: '0,0,0', glass: 'rgba(0,0,0,0.58)', line: 'rgba(255,255,255,0.24)', green: '#9BE3B5' } },
  { key: 'housewhite', label: 'Stay white', blurb: 'White, black type, black logo, the website’s navy — like stay-hospitality.com', c: { light: true, def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'black', wash: 'none' }, gold: '#0A175F', ink: '#0B0B0B', mut: '#55565E', navy: '#FFFFFF', navy2: '#FFFFFF', deep: '#EEEEEE', tint: '255,255,255', glass: 'rgba(255,255,255,0.88)', line: 'rgba(0,0,0,0.12)', green: '#1F9D55' } },
  { key: 'stay', label: 'Navy & gold', blurb: 'Navy with gold — holidays and special pieces', c: { def: { logo: 'gold' }, gold: '#D2B077', ink: '#F2EEE6', mut: '#A9B8C6', navy: '#0D2131', navy2: '#132E44', deep: '#091827', tint: '6,18,30', glass: 'rgba(10,26,40,0.62)', line: 'rgba(255,255,255,0.18)', green: '#4CC488' } },
  { key: 'sunset', label: 'Sunset', blurb: 'Warm coral, golden hour', c: { def: { grade: 'warm', finish: 'glow' }, gold: '#FFB37A', ink: '#FFF4EA', mut: '#E7C3B0', navy: '#2A1220', navy2: '#4A1E2C', deep: '#1A0A14', tint: '38,12,22', glass: 'rgba(48,16,30,0.6)', line: 'rgba(255,220,200,0.22)', green: '#7FD1A6' } },
  { key: 'ocean', label: 'Ocean', blurb: 'Aqua and deep blue, beachy', c: { def: { grade: 'cool' }, gold: '#5FE0D2', ink: '#EFFBFF', mut: '#A8CFDA', navy: '#062A3A', navy2: '#0A4258', deep: '#031B27', tint: '2,26,38', glass: 'rgba(4,36,52,0.6)', line: 'rgba(200,245,255,0.2)', green: '#5FE0A0' } },
  { key: 'editorial', label: 'Editorial', blurb: 'Serif type, cream on deep green, magazine feel', c: { serif: true, def: { font: 'serif', finish: 'film' }, gold: '#E9D8B4', ink: '#F7F1E6', mut: '#C8C0AE', navy: '#0F1F1A', navy2: '#1D3A31', deep: '#08120F', tint: '8,20,16', glass: 'rgba(14,30,25,0.6)', line: 'rgba(240,230,210,0.25)', green: '#9FD3B0' } },
  { key: 'mono', label: 'Minimal luxe', blurb: 'Black and white, serif, editorial', c: { serif: true, def: { font: 'serif', grade: 'mono', logo: 'white' }, gold: '#FFFFFF', ink: '#F5F5F2', mut: '#B9B9B4', navy: '#0B0B0B', navy2: '#1E1E1E', deep: '#000000', tint: '0,0,0', glass: 'rgba(12,12,12,0.6)', line: 'rgba(255,255,255,0.25)', green: '#CFCFCF' } },
  { key: 'bold', label: 'Bold pop', blurb: 'Bright yellow, high energy', c: { def: { font: 'condensed', caps: true, grade: 'vivid' }, gold: '#FFD84A', ink: '#FFFFFF', mut: '#C9C9D6', navy: '#14112A', navy2: '#2A2160', deep: '#0B0920', tint: '14,10,36', glass: 'rgba(20,16,50,0.62)', line: 'rgba(255,255,255,0.22)', green: '#4CE08A' } },
  // Light looks: cream / white grounds, dark type, the BLACK logo.
  { key: 'linen', label: 'Linen', blurb: 'Light cream, serif, black logo', c: { light: true, def: { font: 'serif', grade: 'warm', finish: 'soft', logo: 'black' }, gold: '#9A6A38', ink: '#1C1813', mut: '#5E554B', navy: '#F4EEE4', navy2: '#FFFDF8', deep: '#E7DDCD', tint: '248,243,235', glass: 'rgba(255,252,246,0.86)', line: 'rgba(0,0,0,0.12)', green: '#4E8A5B' } },
  { key: 'paper', label: 'Swiss white', blurb: 'White, condensed caps, red accent, black logo', c: { light: true, def: { font: 'condensed', caps: true, grade: 'natural', finish: 'clean', logo: 'black' }, gold: '#E2412B', ink: '#0E0E0E', mut: '#4F4F4F', navy: '#FFFFFF', navy2: '#FFFFFF', deep: '#EDEDED', tint: '255,255,255', glass: 'rgba(255,255,255,0.9)', line: 'rgba(0,0,0,0.14)', green: '#1F9D55' } },
  { key: 'sand', label: 'Sand', blurb: 'Beige and terracotta, elegant type', c: { light: true, def: { font: 'elegant', grade: 'warm', finish: 'soft', logo: 'black' }, gold: '#B5562E', ink: '#2A1F16', mut: '#6A5847', navy: '#EEE3D3', navy2: '#F8F1E6', deep: '#E0D2BD', tint: '240,230,214', glass: 'rgba(250,244,234,0.86)', line: 'rgba(60,40,20,0.15)', green: '#5E8A4E' } },
  { key: 'fresh', label: 'Fresh white', blurb: 'Clean white, navy type, Stay gold', c: { light: true, def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'black' }, gold: '#A8803F', ink: '#0D2131', mut: '#4A5B6B', navy: '#F7F8FA', navy2: '#FFFFFF', deep: '#E9EDF2', tint: '250,251,253', glass: 'rgba(255,255,255,0.88)', line: 'rgba(13,33,49,0.12)', green: '#2E9B6A' } },
  // More dark looks.
  { key: 'noir', label: 'Noir', blurb: 'Black & white photos, gold, condensed caps', c: { def: { font: 'condensed', caps: true, grade: 'mono', finish: 'film', logo: 'gold' }, gold: '#D2B077', ink: '#FFFFFF', mut: '#BDBDBD', navy: '#080808', navy2: '#1A1A1A', deep: '#000000', tint: '0,0,0', glass: 'rgba(10,10,10,0.65)', line: 'rgba(255,255,255,0.22)', green: '#D2B077' } },
  { key: 'miami', label: 'Miami nights', blurb: 'Neon pink on violet, vivid, light leak', c: { def: { font: 'condensed', caps: true, grade: 'vivid', finish: 'glow', logo: 'white' }, gold: '#FF5FA2', ink: '#FFFFFF', mut: '#D9C6F0', navy: '#1A0B2E', navy2: '#341457', deep: '#0D0518', tint: '26,8,46', glass: 'rgba(30,10,52,0.62)', line: 'rgba(255,180,230,0.25)', green: '#4FF0D0' } },
  { key: 'tropic', label: 'Tropic', blurb: 'Jungle green and coral, vivid', c: { def: { font: 'sans', grade: 'vivid', finish: 'soft', logo: 'white' }, gold: '#FF8A5B', ink: '#FFF8F0', mut: '#BFD9C8', navy: '#0B2A1F', navy2: '#124234', deep: '#061710', tint: '6,30,20', glass: 'rgba(8,36,26,0.62)', line: 'rgba(220,255,235,0.2)', green: '#7FE3A8' } },
  { key: 'aurora', label: 'Aurora', blurb: 'Teal-to-violet gradient, bokeh, modern', c: { def: { font: 'sans', grade: 'cool', finish: 'soft', logo: 'white', fx: ['bokeh'], mesh: ['#0E7C86', '#3B2A8C', '#0A1030'] }, gold: '#7CF2E0', ink: '#F4FBFF', mut: '#B9D4E6', navy: '#121A3F', navy2: '#1E2A5E', deep: '#080C22', tint: '14,18,56', glass: 'rgba(20,28,80,0.55)', line: 'rgba(200,240,255,0.22)', green: '#7CF2B0' } },
  { key: 'champagne', label: 'Champagne', blurb: 'Gold gradient, elegant serif, sparkle — New Year’s Eve', c: { def: { font: 'elegant', grade: 'golden', finish: 'glow', logo: 'white', logoTint: '#F3D9A0', dress: 'sparkle', fx: ['sparkle'], mesh: ['#8A6A2E', '#3A2A12', '#1A1208'] }, gold: '#F3D9A0', ink: '#FFF8EC', mut: '#D9C7A6', navy: '#2A1E0E', navy2: '#4A3617', deep: '#160F06', tint: '34,24,10', glass: 'rgba(50,36,16,0.6)', line: 'rgba(255,230,180,0.25)', green: '#CDE3A0' } },
  // Seasonal looks (Jon, 2026-11-04: Christmas post, Ultra, boat show — "real design").
  // CHRISTMAS, DONE PROPERLY (Jon, 2026-11-10: "the theme builder like Christmas needs to be much better, fit the
  // colours, revamp the logo to fit the theme, maybe add Christmas lights to the logo in Book now, be more creative").
  // Three real Christmas palettes — evergreen, red, winter white — each with the Stay mark tinted to the season and
  // wearing a string of blinking bulbs (and snow on the letters), a red or green Book button wrapped in lights, and
  // the season's graphics on by default.
  { key: 'holiday', label: 'Christmas green', blurb: 'Evergreen, warm gold, a red Book button — the mark in cream with lights and snow', c: { def: { font: 'serif', grade: 'warm', finish: 'glow', logo: 'white', logoTint: '#F6E7C8', dress: 'xmas', fx: ['snow'] }, btn: '#C8102E', gold: '#E9C46A', ink: '#FBF4E6', mut: '#CFC8AE', navy: '#0B3324', navy2: '#124632', deep: '#051A11', tint: '5,32,20', glass: 'rgba(8,44,30,0.66)', line: 'rgba(233,196,106,0.32)', green: '#7FD9A4' } },
  { key: 'xmasred', label: 'Christmas red', blurb: 'Deep cranberry, gold, an evergreen Book button — the mark in cream with lights', c: { def: { font: 'serif', grade: 'warm', finish: 'glow', logo: 'white', logoTint: '#FFF1DA', dress: 'xmas', fx: ['snow', 'bokeh'] }, btn: '#1E6B43', gold: '#F2C94C', ink: '#FFF6EA', mut: '#EBC9C2', navy: '#6A0D18', navy2: '#8C1424', deep: '#3A050C', tint: '70,8,18', glass: 'rgba(96,10,24,0.66)', line: 'rgba(242,201,76,0.34)', green: '#9EE0B4' } },
  { key: 'winter', label: 'Winter white', blurb: 'Snow white, cranberry type, the black mark with lights — clean and festive', c: { light: true, def: { font: 'elegant', grade: 'natural', finish: 'soft', logo: 'black', dress: 'lights', wash: 'neutral', fx: ['snow'] }, btn: '#B3121F', gold: '#B3121F', ink: '#1A1414', mut: '#5D5050', navy: '#FBF8F3', navy2: '#FFFFFF', deep: '#EDE6DA', tint: '251,248,243', glass: 'rgba(255,253,249,0.88)', line: 'rgba(179,18,31,0.18)', green: '#1E6B43' } },
  { key: 'festival', label: 'Festival', blurb: 'Electric violet and acid lime, condensed caps, neon grid — Ultra, F1, race week', c: { def: { font: 'condensed', caps: true, grade: 'vivid', finish: 'glow', logo: 'white', dress: 'glow', fx: ['grid'], mesh: ['#3A0CA3', '#7209B7', '#0B0220'] }, gold: '#C8FF3D', ink: '#FFFFFF', mut: '#D8CCFF', navy: '#12063A', navy2: '#2B0E7A', deep: '#07021A', tint: '18,6,58', glass: 'rgba(30,10,90,0.6)', line: 'rgba(200,255,61,0.28)', green: '#C8FF3D' } },
  // EVERY EVENT GETS ITS OWN DRESS (Jon, 2026-11-10: "need this for all events, not just Christmas").
  { key: 'usa', label: 'Fourth of July', blurb: 'Deep navy, red and white, the mark with twinkling stars', c: { def: { font: 'condensed', caps: true, grade: 'natural', finish: 'clean', logo: 'white', dress: 'stars', wash: 'neutral', fx: ['fireworks'] }, btn: '#C8102E', gold: '#FF5A6A', ink: '#FFFFFF', mut: '#C9D3E6', navy: '#0B1F4D', navy2: '#14306E', deep: '#061233', tint: '8,22,60', glass: 'rgba(11,31,77,0.66)', line: 'rgba(255,255,255,0.24)', green: '#9BE3B5' } },
  { key: 'spooky', label: 'Halloween', blurb: 'Midnight black and pumpkin orange, the mark in orange with bats', c: { def: { font: 'condensed', caps: true, grade: 'cool', finish: 'film', logo: 'white', logoTint: '#FF8A2A', dress: 'bats', fx: ['bokeh'] }, btn: '#FF7A1A', gold: '#FF8A2A', ink: '#F6EEE4', mut: '#BFB3C9', navy: '#120A1C', navy2: '#22132F', deep: '#07040C', tint: '14,8,22', glass: 'rgba(18,10,28,0.68)', line: 'rgba(255,138,42,0.3)', green: '#B8F28A' } },
  { key: 'nautical', label: 'Nautical', blurb: 'Navy, white and a red stripe, clean sans — boat shows and the Fourth', c: { light: true, def: { font: 'sans', caps: true, grade: 'cool', finish: 'clean', logo: 'black', fx: [] }, gold: '#C62828', ink: '#0B1F3A', mut: '#4B5E78', navy: '#F4F6F9', navy2: '#FFFFFF', deep: '#E6EBF2', tint: '244,246,249', glass: 'rgba(255,255,255,0.78)', line: 'rgba(11,31,58,0.16)', green: '#1B7F5A' } },
  { key: 'harvest', label: 'Harvest', blurb: 'Burnt orange, deep brown, cream — Thanksgiving and fall', c: { def: { font: 'serif', grade: 'warm', finish: 'soft', logo: 'white', logoTint: '#FBE3C4', dress: 'leaves', fx: ['leaves'] }, gold: '#E08A3C', ink: '#FBF1E3', mut: '#D9B99A', navy: '#3A1E12', navy2: '#5A2E1A', deep: '#24110A', tint: '48,24,14', glass: 'rgba(70,36,20,0.62)', line: 'rgba(224,138,60,0.3)', green: '#9DB36A' } },
  { key: 'rose', label: 'Rose', blurb: 'Deep rose and blush, elegant serif — Valentine’s, romance', c: { def: { font: 'elegant', grade: 'warm', finish: 'glow', logo: 'white', logoTint: '#FFE3EA', dress: 'hearts', fx: ['hearts'] }, gold: '#FFB3C1', ink: '#FFF3F5', mut: '#E6BFC8', navy: '#4A1020', navy2: '#6E1A33', deep: '#2E0A14', tint: '60,12,28', glass: 'rgba(80,16,38,0.62)', line: 'rgba(255,179,193,0.3)', green: '#7FD9A4' } },
  { key: 'midnight', label: 'Midnight', blurb: 'Deep blue, light rays, cinematic', c: { def: { font: 'sans', grade: 'cool', finish: 'film', logo: 'gold', fx: ['rays'], mesh: ['#0A2A5A', '#071530', '#03091A'] }, gold: '#D2B077', ink: '#EAF0FF', mut: '#A8B6D0', navy: '#071530', navy2: '#0E2250', deep: '#030A1C', tint: '5,16,40', glass: 'rgba(8,22,60,0.6)', line: 'rgba(200,220,255,0.2)', green: '#5FE0A0' } },
  { key: 'golden', label: 'Golden hour', blurb: 'Warm amber, elegant serif, light leak', c: { def: { font: 'elegant', grade: 'warm', finish: 'glow', logo: 'gold' }, gold: '#F2B544', ink: '#FFF6E8', mut: '#E3CDB0', navy: '#24170C', navy2: '#3D2814', deep: '#140C05', tint: '36,22,10', glass: 'rgba(40,24,10,0.6)', line: 'rgba(255,220,170,0.22)', green: '#B9D98A' } },
  // True-colour looks (Jon, 2026-11-04: "better colour schemes, some with no filter") — photos untouched, type reads on a soft shadow.
  { key: 'pure', label: 'True colour', blurb: 'Photos exactly as shot, no wash, white type with a soft shadow, Stay gold', c: { def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'white', wash: 'none' }, gold: '#D2B077', ink: '#FFFFFF', mut: '#E6E6E6', navy: '#101418', navy2: '#1C232B', deep: '#07090C', tint: '0,0,0', glass: 'rgba(0,0,0,0.45)', line: 'rgba(255,255,255,0.3)', green: '#4CC488' } },
  { key: 'blackgold', label: 'Black & gold', blurb: 'Pure black, gold accent, photos untouched — luxury without a tint', c: { def: { font: 'serif', grade: 'natural', finish: 'clean', logo: 'gold', wash: 'neutral' }, gold: '#C9A96E', ink: '#FFFFFF', mut: '#C8C2B8', navy: '#000000', navy2: '#161616', deep: '#000000', tint: '0,0,0', glass: 'rgba(0,0,0,0.55)', line: 'rgba(201,169,110,0.3)', green: '#C9A96E' } },
  { key: 'emerald', label: 'Emerald & brass', blurb: 'Deep emerald, brass accent, natural photos', c: { def: { font: 'serif', grade: 'natural', finish: 'clean', logo: 'gold', wash: 'neutral' }, gold: '#C9A96E', ink: '#F6F3EC', mut: '#B9C8BE', navy: '#0E3B2E', navy2: '#165040', deep: '#07241B', tint: '0,0,0', glass: 'rgba(14,59,46,0.72)', line: 'rgba(201,169,110,0.28)', green: '#7FD9A4' } },
  { key: 'slate', label: 'Slate & coral', blurb: 'Slate blue-grey, coral accent, natural photos — modern', c: { def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'white', wash: 'neutral' }, gold: '#FF7A59', ink: '#F4F6F8', mut: '#B9C2CC', navy: '#2F3E4E', navy2: '#3D4F62', deep: '#1F2A36', tint: '0,0,0', glass: 'rgba(47,62,78,0.7)', line: 'rgba(255,255,255,0.22)', green: '#5FE0A0' } },
  { key: 'lagoon', label: 'Lagoon', blurb: 'Deep teal, sand accent, natural photos — beach without the blue tint', c: { def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'white', wash: 'neutral' }, gold: '#E8D5B5', ink: '#F3FAFA', mut: '#A9CBCB', navy: '#0E5C63', navy2: '#147780', deep: '#083B40', tint: '0,0,0', glass: 'rgba(14,92,99,0.7)', line: 'rgba(232,213,181,0.3)', green: '#7FE3C8' } },
  { key: 'ivory', label: 'Ivory & charcoal', blurb: 'Warm ivory, charcoal type, brass accent, photos untouched', c: { light: true, def: { font: 'serif', grade: 'natural', finish: 'clean', logo: 'black', wash: 'none' }, gold: '#B08D57', ink: '#232323', mut: '#6B665E', navy: '#F6F2EA', navy2: '#FFFDF9', deep: '#EBE4D6', tint: '255,255,255', glass: 'rgba(255,253,249,0.86)', line: 'rgba(0,0,0,0.12)', green: '#4E8A5B' } },
  { key: 'terracotta', label: 'Terracotta & olive', blurb: 'Cream, terracotta accent, olive details, photos untouched', c: { light: true, def: { font: 'elegant', grade: 'natural', finish: 'clean', logo: 'black', wash: 'none' }, gold: '#C4603A', ink: '#2B2118', mut: '#6E6256', navy: '#F3EBDD', navy2: '#FBF6EC', deep: '#E6DBC7', tint: '255,255,255', glass: 'rgba(251,246,236,0.86)', line: 'rgba(43,33,24,0.14)', green: '#6E7F3E' } },
  { key: 'sky', label: 'Sky', blurb: 'Powder blue, deep navy type, bright blue accent — airy, photos untouched', c: { light: true, def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'black', wash: 'none' }, gold: '#1E6FD9', ink: '#0B1F3A', mut: '#4B5E78', navy: '#E8F1F8', navy2: '#F6FAFD', deep: '#D6E4F0', tint: '255,255,255', glass: 'rgba(246,250,253,0.86)', line: 'rgba(11,31,58,0.14)', green: '#1B7F5A' } },
  { key: 'charcoal', label: 'Charcoal & white', blurb: 'Charcoal, white type, white accent, no tint — clean and modern', c: { def: { font: 'sans', grade: 'natural', finish: 'clean', logo: 'white', wash: 'neutral' }, gold: '#FFFFFF', ink: '#FFFFFF', mut: '#BDBDBD', navy: '#1F1F1F', navy2: '#2C2C2C', deep: '#121212', tint: '0,0,0', glass: 'rgba(20,20,20,0.6)', line: 'rgba(255,255,255,0.25)', green: '#9BE3B5' } },
]
let C: Palette = LOOKS[0].c
// Per-frame style state, set by drawFrame from the look + the ad's style.
let GRADE = ''          // canvas filter for photos
let DUO: [string, string] | null = null  // duotone shadows/highlights
let FXS: string[] = []  // the look's default graphics
let DRESS: LogoDress = 'none'   // what the Stay mark wears this frame
let LOGO_TINT = ''               // the mark's colour when the look (or "Theme colour") tints it

// ── THE SEASONAL MARK ─────────────────────────────────────────────────────────────────────────────────────────
// The logo PNG recoloured (a white mark filled with any colour, cached) and dressed for the season: a string of
// blinking Christmas bulbs swagged across the top of the letters, snow settled on them, champagne sparkle, or a
// few autumn leaves. Used everywhere the mark is drawn — the corner, the Book now card, the contact card.
const markCache = new Map<string, HTMLCanvasElement>()
function markCanvas(img: HTMLImageElement, tint: string, snow: boolean): CanvasImageSource {
  if (!tint && !snow) return img
  if (typeof document === 'undefined') return img
  const w = img.naturalWidth || 222, h = img.naturalHeight || 106
  const key = img.src + '|' + tint + '|' + (snow ? 1 : 0)
  const hit = markCache.get(key); if (hit) return hit
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const g = cv.getContext('2d'); if (!g) return img
  g.drawImage(img, 0, 0, w, h)
  if (tint) { g.globalCompositeOperation = 'source-in'; g.fillStyle = tint; g.fillRect(0, 0, w, h) }
  if (snow) {
    // snow settles on the top of every letter: a soft white band with a scalloped lower edge, kept to the glyphs
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = '#FFFFFF'
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0)
    const n = 14
    for (let k = n; k >= 0; k--) { const x = (k / n) * w, y = h * (0.2 + 0.07 * Math.sin(k * 2.3) + 0.04 * Math.sin(k * 5.1)); g.lineTo(x, y) }
    g.closePath(); g.fill()
    // a cool shadow under the snow line, so white snow reads even on a cream or white mark
    g.strokeStyle = 'rgba(120,150,180,0.85)'; g.lineWidth = Math.max(1.5, h * 0.035); g.beginPath()
    for (let k = 0; k <= n; k++) { const x = (k / n) * w, y = h * (0.2 + 0.07 * Math.sin(k * 2.3) + 0.04 * Math.sin(k * 5.1)) + g.lineWidth / 2; if (k) g.lineTo(x, y); else g.moveTo(x, y) }
    g.stroke()
    g.globalCompositeOperation = 'source-over'
  }
  if (markCache.size > 40) markCache.clear()
  markCache.set(key, cv)
  return cv
}
const XMAS = ['#E8343F', '#2FBF71', '#F6C744', '#5BC8F5', '#FF8A3D', '#FFFFFF']
/** One Christmas bulb with its glow. `on` is 0–1 (the blink). */
function bulb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, on: number, ang = 0) {
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5.5); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.55 * on; ctx.fillStyle = g; ctx.fillRect(x - r * 5.5, y - r * 5.5, r * 11, r * 11)
  ctx.restore()
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang)
  ctx.fillStyle = '#2B2B2B'; ctx.fillRect(-r * 0.55, -r * 2.15, r * 1.1, r * 0.9)
  ctx.globalAlpha = 0.55 + 0.45 * on; ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.45, 0, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 0.5 * on; ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.45, r * 0.28, r * 0.45, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.beginPath()
  ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r)
  ctx.fill(); ctx.restore()
}
/** Draws the Stay mark at x,y (w×h), tinted and dressed for the look. `t` drives the blink. */
function drawMark(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, t: number) {
  const snow = DRESS === 'snow' || DRESS === 'xmas'
  if (DRESS === 'glow') {
    // a neon halo that breathes behind the mark
    ctx.save(); ctx.shadowColor = C.gold; ctx.shadowBlur = (18 + 10 * Math.sin(t * 3)) * (w / 220)
    ctx.drawImage(markCanvas(img, LOGO_TINT, false), x, y, w, h); ctx.drawImage(markCanvas(img, LOGO_TINT, false), x, y, w, h); ctx.restore()
  }
  ctx.drawImage(markCanvas(img, LOGO_TINT, snow), x, y, w, h)
  const s = w / 220
  if (DRESS === 'lights' || DRESS === 'xmas') {
    // a wire swagged in two loops across the top of the letters, a bulb every so often, chasing on and off
    const y0 = y + h * 0.02, x0 = x - w * 0.08, x1 = x + w * 1.08, sag = h * 0.32
    const yAt = (f: number) => y0 + sag * Math.abs(Math.sin(f * Math.PI * 2))
    ctx.save(); ctx.strokeStyle = 'rgba(30,40,30,0.85)'; ctx.lineWidth = Math.max(1, 2.2 * s); ctx.beginPath()
    for (let k = 0; k <= 60; k++) { const f = k / 60, xx = x0 + f * (x1 - x0); if (k) ctx.lineTo(xx, yAt(f)); else ctx.moveTo(xx, yAt(f)) }
    ctx.stroke(); ctx.restore()
    const n = 11
    for (let k = 0; k <= n; k++) {
      const f = k / n, xx = x0 + f * (x1 - x0), yy = yAt(f) + 7 * s
      const on = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2 - k * 1.1))
      bulb(ctx, xx, yy, 5.2 * s, XMAS[k % XMAS.length], on, Math.sin(k * 1.7) * 0.25)
    }
  }
  if (DRESS === 'sparkle') {
    const pts: [number, number, number][] = [[-0.06, 0.1, 1], [1.05, 0.05, 0.8], [0.92, 0.95, 0.6], [0.1, 0.95, 0.7], [0.5, -0.12, 0.55]]
    pts.forEach(([fx, fy, sz], k) => { const tw = 0.5 + 0.5 * Math.sin(t * 2.6 + k * 1.9); star4(ctx, x + fx * w, y + fy * h, 13 * s * sz * (0.6 + 0.6 * tw), LOGO_TINT || C.gold, 0.35 + 0.65 * tw) })
  }
  if (DRESS === 'hearts') {
    ;[[-0.09, 0.2, 1], [1.07, 0.15, 0.8], [1.0, 0.95, 0.6], [-0.03, 0.9, 0.55]].forEach(([fx, fy, sz], k) => {
      const hx = x + fx * w, hy = y + fy * h - 4 * s * Math.sin(t * 1.6 + k), r = 9 * s * sz * (1 + 0.08 * Math.sin(t * 3 + k))
      ctx.save(); ctx.fillStyle = k % 2 ? '#FF8FA8' : (LOGO_TINT || '#FFB3C1'); ctx.globalAlpha = 0.85
      ctx.beginPath(); ctx.moveTo(hx, hy + r); ctx.bezierCurveTo(hx - r * 1.3, hy, hx - r * 0.6, hy - r, hx, hy - r * 0.3); ctx.bezierCurveTo(hx + r * 0.6, hy - r, hx + r * 1.3, hy, hx, hy + r); ctx.fill(); ctx.restore()
    })
  }
  if (DRESS === 'stars') {
    ;[[-0.08, 0.05, 1, '#FFFFFF'], [1.06, 0.1, 0.8, '#E63946'], [0.95, 0.98, 0.6, '#FFFFFF'], [0.04, 0.95, 0.6, '#E63946'], [0.5, -0.14, 0.55, '#FFFFFF']].forEach(([fx, fy, sz, c], k) => {
      const tw = 0.5 + 0.5 * Math.sin(t * 2.4 + k * 1.7), r = 11 * s * (sz as number) * (0.7 + 0.4 * tw), cx = x + (fx as number) * w, cy = y + (fy as number) * h
      ctx.save(); ctx.fillStyle = c as string; ctx.globalAlpha = 0.5 + 0.5 * tw; ctx.beginPath()
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2) }
      ctx.closePath(); ctx.fill(); ctx.restore()
    })
  }
  if (DRESS === 'bats') {
    ;[[-0.12, 0.1, 1], [1.08, -0.05, 0.8], [1.02, 0.85, 0.65]].forEach(([fx, fy, sz], k) => {
      const bx = x + fx * w + 6 * s * Math.sin(t * 1.3 + k), by = y + fy * h + 5 * s * Math.cos(t * 1.7 + k), r = 13 * s * sz, flap = 0.6 + 0.4 * Math.sin(t * 9 + k * 2)
      ctx.save(); ctx.fillStyle = LOGO_TINT || '#FF7A1A'; ctx.globalAlpha = 0.9; ctx.beginPath()
      ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx - r * 0.5, by - r * 0.6 * flap, bx - r * 1.4, by - r * 0.2 * flap); ctx.quadraticCurveTo(bx - r * 0.9, by + r * 0.1, bx - r * 0.6, by + r * 0.35)
      ctx.quadraticCurveTo(bx - r * 0.25, by + r * 0.1, bx, by + r * 0.3); ctx.quadraticCurveTo(bx + r * 0.25, by + r * 0.1, bx + r * 0.6, by + r * 0.35)
      ctx.quadraticCurveTo(bx + r * 0.9, by + r * 0.1, bx + r * 1.4, by - r * 0.2 * flap); ctx.quadraticCurveTo(bx + r * 0.5, by - r * 0.6 * flap, bx, by); ctx.fill(); ctx.restore()
    })
  }
  if (DRESS === 'leaves') {
    const cols = ['#C8541E', '#E08A3C', '#9C3B19', '#D9A441']
    ;[[-0.1, 0.15, 0.6], [1.06, 0.7, -0.5], [0.97, -0.05, 1.2]].forEach(([fx, fy, rot], k) => {
      const lx = x + fx * w, ly = y + fy * h + 3 * s * Math.sin(t * 1.4 + k), r = 12 * s
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(rot + 0.15 * Math.sin(t + k)); ctx.fillStyle = cols[k % cols.length]
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r, -r * 0.2, 0, r); ctx.quadraticCurveTo(-r, -r * 0.2, 0, -r); ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = s; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r * 1.3); ctx.stroke(); ctx.restore()
    })
  }
}
/** Bulbs all the way round a pill-shaped button, chasing — the Book now button dressed for Christmas. */
function lightsAround(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, u: number) {
  const r = h / 2, straight = w - 2 * r, per = 2 * straight + 2 * Math.PI * r
  const n = Math.max(10, Math.round(per / (48 * u)))
  const pad = 16 * u
  for (let k = 0; k < n; k++) {
    let d = (k / n) * per, px = 0, py = 0
    const R = r + pad
    if (d < straight) { px = x + r + d; py = y - pad }
    else if ((d -= straight) < Math.PI * r) { const a = -Math.PI / 2 + d / r; px = x + w - r + Math.cos(a) * R; py = y + r + Math.sin(a) * R }
    else if ((d -= Math.PI * r) < straight) { px = x + w - r - d; py = y + h + pad }
    else { d -= straight; const a = Math.PI / 2 + d / r; px = x + r + Math.cos(a) * R; py = y + r + Math.sin(a) * R }
    const on = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 4 - k * 0.9))
    bulb(ctx, px, py, 6 * u, XMAS[k % XMAS.length], on, Math.atan2(py - (y + r), px - (x + w / 2)) + Math.PI / 2)
  }
}
let PD = 1              // pace: >1 slower, <1 faster
let CAPS = false
let FONTW = 0           // a single-weight display face (condensed) draws at its own weight
let DISPLAY = ''
let FS = 1             // the elegant serif runs small; scale it up
let ANIM: AdTextAnim = 'rise'
// Per-scene custom design (SceneCustom): the wash multiplier, the photo's focus point and extra zoom, the plain sans face.
let SHADE = 1
let FOCX = 0, FOCY = 0, PZOOM = 1
let BASE_SANS = ''
let CAM: AdCam = 'auto'
const hexRgb = (h: string): [number, number, number] => { const x = h.replace('#', ''); const n = parseInt(x.length === 3 ? x.split('').map(c => c + c).join('') : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const lumOf = (h: string) => { const [r, g, b] = hexRgb(h); return 0.299 * r + 0.587 * g + 0.114 * b }
const shade = (h: string, d: number) => { const [r, g, b] = hexRgb(h).map(v => Math.max(0, Math.min(255, Math.round(v + d)))); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') }
const isHex = (h?: string) => !!h && /^#[0-9a-f]{6}$/i.test(h)
/** Camera: zoom and pan at a point in the scene. Auto = the house push-in with a slight pan. */
function camAt(local: number, dur: number): { z: number; x: number; y: number } {
  const k = clamp(local / Math.max(dur, 1)), m = 1 / PD
  switch (CAM) {
    case 'in': return { z: 1.0 + 0.2 * m * k, x: 0, y: 0 }
    case 'out': return { z: 1.22 - 0.2 * m * k, x: 0, y: 0 }
    case 'left': return { z: 1.14, x: (0.6 - 1.2 * k) * m, y: 0 }
    case 'right': return { z: 1.14, x: (-0.6 + 1.2 * k) * m, y: 0 }
    case 'up': return { z: 1.16, x: 0, y: (0.6 - 1.2 * k) * m }
    case 'still': return { z: 1.02, x: 0, y: 0 }
    case 'drift': return { z: 1.08 + 0.03 * Math.sin(local * 0.8), x: 0.25 * Math.sin(local * 0.5), y: 0.2 * Math.cos(local * 0.4) }
    default: return { z: 1.04 + 0.09 * m * k, x: 0.25 * m * k, y: 0 }
  }
}
const GRADES: Record<string, string> = { natural: '', warm: 'sepia(0.16) saturate(1.12) brightness(1.03)', cool: 'saturate(0.92) contrast(1.05) hue-rotate(-7deg) brightness(1.02)', vivid: 'saturate(1.35) contrast(1.08)', faded: 'contrast(0.86) saturate(0.82) brightness(1.07)', mono: 'grayscale(1) contrast(1.12)' }
/** Resolve the look + the ad's style into what the renderer uses. */
export function resolveStyle(p: Pick<AdProject, 'look' | 'style'>) {
  const L = (LOOKS.find(l => l.key === p.look) || LOOKS[0]).c
  const st = { ...STYLE_DEFAULT, ...(p.style || {}) }
  const d = L.def || {}
  return {
    font: st.font === 'auto' ? (d.font || (L.serif ? 'serif' : 'sans')) : st.font,
    caps: st.caps === 'auto' ? !!d.caps : st.caps === 'on',
    grade: st.grade === 'auto' ? (d.grade || 'natural') : st.grade,
    wash: (st.wash || 'auto') === 'auto' ? (d.wash || 'look') : st.wash as 'look' | 'neutral' | 'none',
    pace: st.pace,
    finish: st.finish === 'auto' ? (d.finish || 'film') : st.finish,
    frame: st.frame,
    logo: st.logo === 'auto' ? (d.logo || (L.light ? 'black' : 'white')) : st.logo,
    dress: ((st.dress || 'auto') === 'auto' ? (d.dress || 'none') : st.dress) as LogoDress,
    logoTint: st.logo === 'auto' ? (d.logoTint || '') : '',
    accent: st.accent || '', base: st.base || '', text: st.text || '',
  }
}
/** Overlay strength: light looks wash photos harder so dark type reads. */
let WASH: 'look' | 'neutral' | 'none' = 'look'
/** Overlay alpha over photos: the look's wash as designed, a lighter neutral scrim, or nothing. */
const TA = (a: number) => Math.min(0.96, SHADE * (WASH === 'none' ? 0 : WASH === 'neutral' ? (C.light ? Math.min(0.6, a * 0.7) : a * 0.55) : (C.light ? Math.min(0.92, a * 1.25 + 0.12) : a)))
const fnt = (w: number | string, size: number, fam: string) => `${fam === DISPLAY && FONTW ? FONTW : w} ${fam === DISPLAY ? size * FS : size}px ${fam}`
/** Readable text on the accent colour (button labels, ticks). */
const onAccent = () => { const h = C.gold.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)); return l > 150 ? '#14110B' : '#FFFFFF' }
/** What the ad is meant to do — set when an ad is started; it steers the writer. */
export const GOALS: { key: string; label: string; audience: AdAudience; brief: string }[] = [
  { key: 'bookings', label: 'Get bookings', audience: 'guests', brief: 'Goal: drive direct bookings at stay-hospitality.com.' },
  { key: 'event', label: 'Promote an event / season', audience: 'guests', brief: 'Goal: fill dates around a specific event or season.' },
  { key: 'owners', label: 'Win new owners', audience: 'owners', brief: 'Goal: get property owners to book a call with Nick.' },
  { key: 'partners', label: 'Partner referrals', audience: 'partners', brief: 'Goal: get realtors, lenders and advisors to refer owners.' },
  { key: 'brand', label: 'Brand awareness', audience: 'guests', brief: 'Goal: make people remember Stay Hospitality and its places.' },
]
/** Where the ad will run. Shape, safe zones (what the app's own UI covers) and the length that performs. */
export const PLATFORMS: { key: string; label: string; format: AdFormat; max: number; best: string; safe: { top: number; bottom: number; right: number } }[] = [
  { key: 'reel', label: 'Instagram Reel', format: '9:16', max: 60, best: '15–30 s', safe: { top: 0.11, bottom: 0.2, right: 0.12 } },
  { key: 'story', label: 'Story', format: '9:16', max: 15, best: '≤ 15 s', safe: { top: 0.14, bottom: 0.2, right: 0.06 } },
  { key: 'tiktok', label: 'TikTok', format: '9:16', max: 60, best: '15–30 s', safe: { top: 0.12, bottom: 0.22, right: 0.14 } },
  { key: 'shorts', label: 'YouTube Shorts', format: '9:16', max: 60, best: '15–35 s', safe: { top: 0.1, bottom: 0.21, right: 0.14 } },
  { key: 'feed', label: 'Feed post', format: '4:5', max: 60, best: '15–25 s', safe: { top: 0, bottom: 0, right: 0 } },
  { key: 'square', label: 'Square', format: '1:1', max: 60, best: '15–25 s', safe: { top: 0, bottom: 0, right: 0 } },
  { key: 'web', label: 'YouTube / web', format: '16:9', max: 120, best: '30–60 s', safe: { top: 0, bottom: 0.1, right: 0 } },
]
export const platformOf = (p: Pick<AdProject, 'platform' | 'format'>) => PLATFORMS.find(x => x.key === p.platform) || PLATFORMS.find(x => x.format === p.format && x.key !== 'story' && x.key !== 'tiktok') || PLATFORMS[0]

/** VIBES (Jon, 2026-11-03: "catchier vibes and looks"): one tap sets look + style + graphics + music + pace. */
export const VIBES: { key: string; label: string; blurb: string; look: string; style: Partial<AdStyle>; fx: string[]; music: string }[] = [
  { key: 'luxe', label: 'Luxury calm', blurb: 'Editorial serif, bokeh, lounge music', look: 'editorial', style: { pace: 'calm', finish: 'soft' }, fx: ['bokeh'], music: 'backbay' },
  { key: 'energy', label: 'Miami energy', blurb: 'Neon pink, fast cuts, sparkle', look: 'miami', style: { pace: 'fast' }, fx: ['sparkle'], music: 'funkorama' },
  { key: 'golden', label: 'Golden hour', blurb: 'Amber light rays, elegant serif', look: 'golden', style: {}, fx: ['rays'], music: 'moonlight' },
  { key: 'clean', label: 'Clean & modern', blurb: 'White, corner brackets, bright', look: 'fresh', style: { finish: 'clean' }, fx: ['corners'], music: 'wallpaper' },
  { key: 'noir', label: 'Noir cinema', blurb: 'Black & white, letterbox, film grain', look: 'noir', style: { frame: 'letterbox', finish: 'film' }, fx: [], music: 'inspired' },
  { key: 'tropic', label: 'Tropical', blurb: 'Jungle green and coral, waves', look: 'tropic', style: { grade: 'vivid' }, fx: ['waves'], music: 'werq' },
  { key: 'aurora', label: 'Aurora', blurb: 'Teal-violet gradient, bokeh, glow line', look: 'aurora', style: {}, fx: ['bokeh', 'glowline'], music: 'wallpaper' },
  { key: 'champagne', label: 'Champagne', blurb: 'Gold tone photos, sparkle, elegant', look: 'champagne', style: {}, fx: ['sparkle'], music: 'backbay' },
  { key: 'tech', label: 'Lighthouse tech', blurb: 'Midnight blue, tech grid, scanlines — owner ads', look: 'midnight', style: {}, fx: ['grid'], music: 'inspired' },
  { key: 'party', label: 'Celebration', blurb: 'Bold pop, confetti, stripes — events', look: 'bold', style: { pace: 'fast' }, fx: ['confetti', 'stripes'], music: 'funkorama' },
  { key: 'duotone', label: 'Duotone', blurb: 'Two-colour photos in the look’s accent', look: 'stay', style: { grade: 'duotone' }, fx: ['orb'], music: 'werq' },
  { key: 'linen', label: 'Linen soft', blurb: 'Cream, serif, black logo, bokeh', look: 'linen', style: { pace: 'calm' }, fx: ['bokeh'], music: 'moonlight' },
]

/** Proven ad concepts the team can start from (Jon, 2026-11-03: "give the team the best ideas"). */
export const IDEAS: { key: string; goal: string; title: string; why: string; prompt: string }[] = [
  { key: 'wake', goal: 'bookings', title: 'Wake up here', why: 'The first-morning feeling sells more than amenities. Opens on the view, ends on the bed.', prompt: 'A guest Reel about waking up at <property>: open on the view from the balcony at sunrise, then coffee, the pool, the bed. One idea: the first morning. End on Book at stay-hospitality.com.' },
  { key: 'golden', goal: 'bookings', title: 'Golden hour', why: 'Sunset light makes every property look premium; pairs with calm music and slow pacing.', prompt: 'A calm guest ad about golden hour at <property>: rooftop or pool at sunset, the balcony, dinner out, back to the room. Slow, elegant. End on Book at stay-hospitality.com.' },
  { key: 'weekend', goal: 'bookings', title: 'The 48-hour weekend', why: 'A plan is easier to book than a place. Friday arrive → Saturday pool → Sunday slow.', prompt: 'A guest Reel that plans a weekend at <property>: Friday night arrival, Saturday at the pool and the beach, Sunday slow morning. Three beats. End on Book at stay-hospitality.com.' },
  { key: 'local', goal: 'bookings', title: 'Steps from it all', why: 'Location is the most-asked question; show what is walkable.', prompt: 'A guest ad about the location of <property>: what is steps away (beach, restaurants, nightlife, the marina), then the room to come back to. Callouts scene for the walkable list. End on Book at stay-hospitality.com.' },
  { key: 'space', goal: 'bookings', title: 'More room than a hotel', why: 'Families and groups book on space: kitchen, living room, separate bedrooms.', prompt: 'A guest ad for families and groups at <property>: a full kitchen, a real living room, separate bedrooms, the pool. Warm. End on Book at stay-hospitality.com.' },
  { key: 'work', goal: 'bookings', title: 'Work from paradise', why: 'Longer stays: a desk, fast wifi, a view, the pool at 5 pm.', prompt: 'A guest ad for remote workers at <property>: a quiet place to work with a view, fast wifi, then the pool at five. Monthly stays welcome. End on Book at stay-hospitality.com.' },
  { key: 'event', goal: 'event', title: 'Be there for the event', why: 'Date-led ads convert: the event, the dates, how close you stay.', prompt: 'An event ad for <event> on <dates>: the city energy, how close <property> is to it, the room to come back to. Use the Event / date scene with the real dates. End on Book at stay-hospitality.com.' },
  { key: 'winter', goal: 'event', title: 'Winter sun', why: 'December to March is the demand season for the north; sell warmth.', prompt: 'A winter-sun ad for <property> aimed at travellers escaping the cold, December to March: the pool, the beach, the balcony in the sun. End on Book at stay-hospitality.com.' },
  { key: 'switch', goal: 'owners', title: 'Why owners switch', why: 'The core owner story: revenue managed daily, 40+ channels, one team, Lighthouse, lower fee.', prompt: 'An owner ad: why owners switch to Stay Hospitality — revenue managed daily, listed on 40+ channels, Lighthouse spots issues and automates work, one complete team, a lower fee and full transparency. End on the contact card with Nick.' },
  { key: 'highdates', goal: 'owners', title: 'Priced for the big dates', why: 'Owners worry about leaving money on the table on Art Basel, New Year, F1.', prompt: 'An owner ad about pricing the high-demand dates months ahead — Art Basel, New Year’s Eve, the boat shows, Formula 1 Miami — with dedicated revenue managers pricing every day. End on the contact card with Nick.' },
  { key: 'lighthouse', goal: 'owners', title: 'Meet Lighthouse', why: 'Our own AI is a differentiator no competitor has: show it working.', prompt: 'An owner ad introducing Lighthouse, our in-house AI: spots recurring issues before guests do, turns problems into tasks, builds guest guidebooks, optimises listings, monitors reviews. Use the Live feed scene. End on the contact card with Nick.' },
  { key: 'team', goal: 'owners', title: 'One complete team', why: 'Owners leave managers over service; show housekeeping, maintenance, inspections, guest care.', prompt: 'An owner ad about the complete in-house team: housekeeping, maintenance, inspections, the Customer Care Team — and what that means for reviews and revenue. End on the contact card with Nick.' },
  { key: 'partner', goal: 'partners', title: 'Your client just asked', why: 'Realtors get asked “who should manage it?” — give them the answer to forward.', prompt: 'A partner ad for realtors and advisors: when a client asks who should manage their property, here is the answer — Stay Hospitality, 450+ listings, 10 years, daily pricing, one team. Send an address, get a projection. End on the contact card with Nick.' },
  { key: 'brand', goal: 'brand', title: 'South Florida, stayed well', why: 'Brand film: the portfolio across Miami, Fort Lauderdale, Pompano and Palm Beach.', prompt: 'A brand film for Stay Hospitality guests: South Florida stays from downtown Miami high-rises to the beach — montage of our best places, one line per city. End on Book at stay-hospitality.com.' },
]

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
const appear = (local: number, delay: number, d = 0.6) => ease((local - delay * PD) / (d * PD))

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k)
  ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k)
  ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y); ctx.closePath()
}
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, x: number, y: number, w: number, h: number, zoom = 1, pan = 0, panY = 0) {
  const iw = (img as any).naturalWidth || (img as any).videoWidth || img.width, ih = (img as any).naturalHeight || (img as any).videoHeight || img.height
  if (!iw || !ih) return
  const s = Math.max(w / iw, h / ih) * zoom * PZOOM
  const dw = iw * s, dh = ih * s
  // The scene's own focus point moves the crop; the camera's pan rides on top, never past the photo's edge.
  if (FOCX) pan = Math.max(-1, Math.min(1, pan * (1 - Math.abs(FOCX)) + FOCX))
  if (FOCY) panY = Math.max(-1, Math.min(1, panY * (1 - Math.abs(FOCY)) + FOCY))
  const dx = x + (w - dw) / 2 - pan * (dw - w) / 2, dy = y + (h - dh) / 2 - panY * (dh - h) / 2
  if (DUO) {
    // DUOTONE: grayscale photo, shadows pushed to one colour (lighten), highlights to another (multiply)
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
    try { ctx.filter = (ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : '') + 'grayscale(1) contrast(1.1)' } catch { /* */ }
    ctx.drawImage(img, dx, dy, dw, dh)
    try { ctx.filter = 'none' } catch { /* */ }
    ctx.globalCompositeOperation = 'lighten'; ctx.fillStyle = DUO[0]; ctx.fillRect(x, y, w, h)
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = DUO[1]; ctx.fillRect(x, y, w, h)
    ctx.restore()
    return
  }
  if (GRADE) { ctx.save(); const f = ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : ''; try { ctx.filter = f + GRADE } catch { /* no filter support */ } }
  ctx.drawImage(img, dx, dy, dw, dh)
  if (GRADE) ctx.restore()
}
type Seg = { t: string; gold: boolean }
function segs(text: string): Seg[] {
  const out: Seg[] = []
  const parts = String(text || '').split('**')
  for (let i = 0; i < parts.length; i++) if (parts[i]) out.push({ t: parts[i], gold: i % 2 === 1 })
  return out
}
/** Lay out rich text (**gold** words, \n breaks) into lines that fit maxW. */
function layout(ctx: CanvasRenderingContext2D, text: string, maxW: number): { words: { t: string; gold: boolean; w: number; g?: boolean }[]; w: number }[] {
  const lines: { words: { t: string; gold: boolean; w: number; g?: boolean }[]; w: number }[] = []
  const hard = String(text || '').split('\n')
  for (let h = 0; h < hard.length; h++) {
    let cur: { t: string; gold: boolean; w: number; g?: boolean }[] = []
    let cw = 0
    const sp = ctx.measureText(' ').width
    const ss = segs(hard[h])
    for (let s = 0; s < ss.length; s++) {
      const ws = ss[s].t.split(/(\s+)/)
      let atStart = true
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k]
        if (!w) continue
        if (/^\s+$/.test(w)) { if (cur.length) cur[cur.length - 1].t += ' '; atStart = false; continue }
        const mw = ctx.measureText(w).width
        // "**views**." — punctuation (or any text) that follows a gold run with no space is glued to it
        const glue = atStart && s > 0 && cur.length > 0 && !/\s$/.test(cur[cur.length - 1].t)
        atStart = false
        if (!glue && cur.length && cw + sp + mw > maxW) { lines.push({ words: cur, w: cw }); cur = []; cw = 0 }
        cur.push({ t: w, gold: ss[s].gold, w: mw, g: glue })
        cw += (cur.length > 1 && !glue ? sp : 0) + mw
      }
    }
    lines.push({ words: cur, w: cw })
  }
  return lines
}
/** Draw rich text; each line can arrive on its own (stagger in seconds). Returns the height used. */
/** Jon, 2026-11-03: "make sure the fonts fit in the different style layouts". The largest size (≤ the
 *  design's size) at which the text fits: no word wider than the box, and — when a height is given —
 *  all lines inside it. Leaves ctx.font set to the fitted size. Every font (condensed, serif, the
 *  scaled-up elegant face) and every shape goes through this, so nothing spills off the frame. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, maxH = 0, weight: number | string = 800, font = DISPLAY, lh = 1.08): number {
  let s = size
  for (let k = 0; k < 18; k++) {
    ctx.font = fnt(weight, s, font)
    const lines = layout(ctx, text, maxW)
    const S = font === DISPLAY ? s * FS : s
    const wide = lines.some(L => L.w > maxW * 1.002)
    const tall = maxH > 0 && lines.length * S * lh > maxH
    if (!wide && !tall) return s
    s *= 0.92
    if (s < size * 0.35) break
  }
  ctx.font = fnt(weight, s, font)
  return s
}
const linesH = (ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, font = DISPLAY, lh = 1.08) => layout(ctx, text, maxW).length * (font === DISPLAY ? size * FS : size) * lh

function rich(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, opts: { align?: 'left' | 'center'; font: string; weight?: number; local: number; delay?: number; stagger?: number; color?: string; lh?: number; shadow?: boolean; maxH?: number }): number {
  size = fitSize(ctx, text, maxW, size, opts.maxH || 0, opts.weight || 800, opts.font, opts.lh || 1.08)
  const lines = layout(ctx, text, maxW)
  const S = opts.font === DISPLAY ? size * FS : size
  const lh = S * (opts.lh || 1.08)
  const sp = ctx.measureText(' ').width
  ctx.textBaseline = 'alphabetic'
  const mode = ANIM
  if (typeof globalThis !== 'undefined' && (globalThis as any).__adFit) { const W0 = ctx.canvas.width, H0 = ctx.canvas.height; const Lc = layout(ctx, text, maxW); const S0 = opts.font === DISPLAY ? size * FS : size; Lc.forEach((L, k) => { const x0 = opts.align === 'center' ? x + (maxW - L.w) / 2 : x; const yb = y + S0 + k * S0 * (opts.lh || 1.08); if (L.w > maxW * 1.01 || x0 < -2 || x0 + L.w > W0 + 2 || yb > H0 + 2 || yb - S0 < -2) (globalThis as any).__adFit.push({ text: text.slice(0, 40), w: Math.round(L.w), maxW: Math.round(maxW), x: Math.round(x0), y: Math.round(yb), W: W0, H: H0 }) }) }
  const d0 = opts.delay || 0, stg = opts.stagger == null ? 0.22 : opts.stagger
  let wordIx = 0
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const t0 = d0 + i * stg
    const a = mode === 'type' ? clamp((opts.local - t0 * PD) / (Math.max(0.5, L.words.length * 0.16) * PD)) : appear(opts.local, t0, mode === 'drop' ? 0.45 : 0.6)
    if (a <= 0 && mode !== 'words') { wordIx += L.words.length; continue }
    const x0 = opts.align === 'center' ? x + (maxW - L.w) / 2 : x
    let cx = x0
    const base = y + S + i * lh
    ctx.save()
    if (mode === 'rise' || mode === 'auto') { ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * S * 0.35) }
    else if (mode === 'drop') { ctx.globalAlpha *= a; ctx.translate(0, -(1 - a) * S * 0.9 + Math.sin(a * Math.PI) * S * 0.06) }
    else if (mode === 'pop') { ctx.globalAlpha *= a; const z = 1 + 0.35 * (1 - a) - 0.05 * Math.sin(a * Math.PI); ctx.translate(x0 + L.w / 2, base - S * 0.35); ctx.scale(z, z); ctx.translate(-(x0 + L.w / 2), -(base - S * 0.35)) }
    else if (mode === 'blur') { ctx.globalAlpha *= Math.min(1, a * 1.6); try { ctx.filter = `blur(${Math.round((1 - a) * S * 0.22)}px)` } catch { /* no filter */ } }
    else if (mode === 'type' || mode === 'wipe') {
      ctx.beginPath(); ctx.rect(x0 - 4, base - S * 1.1, (L.w + 8) * a, S * 1.45); ctx.clip()
    }
    if (opts.shadow !== false) { const k2 = WASH === 'none' ? 1.6 : WASH === 'neutral' ? 1.25 : 1; ctx.shadowColor = C.light ? `rgba(255,255,255,${Math.min(0.9, 0.55 * k2)})` : `rgba(0,0,0,${Math.min(0.8, 0.45 * k2)})`; ctx.shadowBlur = size * 0.35 * k2; if (WASH === 'none') ctx.shadowOffsetY = size * 0.03 }
    for (let k = 0; k < L.words.length; k++) {
      let wa = 1
      if (mode === 'words') { wa = appear(opts.local, d0 + (wordIx + k) * 0.12, 0.35); if (wa <= 0) { cx += L.words[k].w + (L.words[k + 1]?.g ? 0 : sp); continue } }
      ctx.save()
      if (mode === 'words') { ctx.globalAlpha *= wa; ctx.translate(0, (1 - wa) * S * 0.25) }
      ctx.fillStyle = L.words[k].gold ? C.gold : (opts.color || C.ink)
      ctx.fillText(L.words[k].t.trim(), cx, base)
      ctx.restore()
      cx += L.words[k].w + (L.words[k + 1]?.g ? 0 : sp)
    }
    ctx.restore()
    if ((mode === 'wipe' || mode === 'type') && a > 0 && a < 1) {
      // the wipe's accent bar / the typewriter's caret at the reveal edge
      ctx.save(); ctx.fillStyle = C.gold; const ex = x0 + (L.w + 8) * a
      if (mode === 'wipe') ctx.fillRect(ex - 3, base - S * 1.05, Math.max(4, S * 0.06), S * 1.35); else if (Math.floor(opts.local * 6) % 2 === 0) ctx.fillRect(ex, base - S * 0.8, Math.max(3, S * 0.05), S * 0.9)
      ctx.restore()
    }
    wordIx += L.words.length
  }
  return lines.length * lh
}
function plain(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, color: string, weight = 500, align: 'left' | 'center' = 'left', alpha = 1): number {
  if (!text) return 0
  ctx.font = fnt(weight, size, font)
  const lines = layout(ctx, text.replace(/\*\*/g, ''), maxW)
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
  if (WASH !== 'look') { ctx.shadowColor = C.light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * (WASH === 'none' ? 0.5 : 0.3) }
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
    const cm = camAt(local, dur)
    cover(ctx, img, 0, 0, W, H, cm.z, cm.x, cm.y)
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, `rgba(${C.tint},${TA(0.35 * dark + 0.1)})`)
    g.addColorStop(0.55, `rgba(${C.tint},${TA(0.55 * dark + 0.12)})`)
    g.addColorStop(1, `rgba(${C.tint},${TA(0.75 * dark + 0.15)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else {
    meshBg(ctx, W, H, local)
  }
}
/** A slowly moving gradient mesh — the look's colours — for scenes and panels without a photo. */
function meshBg(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const m = C.def?.mesh
  const g = ctx.createRadialGradient(W * 0.8, 0, 0, W * 0.8, 0, Math.max(W, H) * 1.1)
  g.addColorStop(0, C.navy2); g.addColorStop(0.6, C.navy); g.addColorStop(1, C.deep)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  if (!m) return
  const blobs: [number, number, number, string][] = [
    [0.2 + 0.1 * Math.sin(t * 0.5), 0.3 + 0.1 * Math.cos(t * 0.4), 0.75, m[0]],
    [0.8 + 0.08 * Math.cos(t * 0.35), 0.7 + 0.1 * Math.sin(t * 0.45), 0.8, m[1]],
    [0.55 + 0.1 * Math.sin(t * 0.3), 0.1 + 0.08 * Math.cos(t * 0.6), 0.6, m[2]],
  ]
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.75
  for (const [bx, by, r, col] of blobs) {
    const rg = ctx.createRadialGradient(W * bx, H * by, 0, W * bx, H * by, Math.max(W, H) * r)
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
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
  const PF = platformOf(p)
  // vertical captions run to three lines: content stops above them
  const bottomSafe = Math.max((p.captions ? 190 : 110) * u, H * PF.safe.bottom + (p.captions ? (portrait ? 250 : 150) : 40) * u)
  const get = (u: string) => (!u ? null : A.media ? A.media(u, local) : A.img(u))
  const im = (k: number) => get(sc.photos[k] || '')
  const head = CAPS ? (sc.head || '').toUpperCase() : sc.head || ''
  const fam = motionFamily(p)
  ANIM = sc.anim && sc.anim !== 'auto' ? sc.anim : (sc.kind === 'cinema' || sc.kind === 'panel' ? (fam === 'lively' ? 'rise' : 'blur') : fam === 'lively' ? (sc.kind === 'title' || sc.kind === 'photo' ? 'words' : 'rise') : 'rise')
  CAM = sc.cam || 'auto'

  if (PRO_KINDS.indexOf(sc.kind) >= 0) { drawPro(ctx, p, i, local, dur, A, get, bottomSafe); return }

  if (sc.kind === 'cta') {
    background(ctx, W, H, im(0), local, dur, 0.95)
    // a dressed mark is the star of a seasonal end card, so it is drawn larger
    const lw = (portrait ? 200 : 210) * u * (DRESS !== 'none' ? 1.45 : 1)
    let y = portrait ? H * 0.2 : H * 0.17
    if (A.logo) {
      const lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
      ctx.save(); ctx.globalAlpha *= appear(local, 0); drawMark(ctx, A.logo, (W - lw) / 2, y, lw, lh, local); ctx.restore()
      y += lh + (DRESS === 'lights' || DRESS === 'xmas' ? 74 : 60) * u
    }
    const size = (portrait ? 112 : 118) * u
    y += rich(ctx, head || 'Your South Florida **stay.**', pad, y, W - pad * 2, size, { font: A.display, local, delay: 0.25, stagger: 0.3, align: 'center', maxH: H * 0.3 }) + 26 * u
    if (sc.sub) y += plain(ctx, sc.sub, pad, y, W - pad * 2, 38 * u, A.body, C.ink, 500, 'center', appear(local, 0.7)) + 40 * u
    if (DRESS === 'lights' || DRESS === 'xmas') y += 26 * u  // the bulbs round the button need air
    const label = (sc.items[0] || 'Book at stay-hospitality.com').replace(/\|.*/, '')
    ctx.font = fnt(700, 40 * u, A.body)
    const bw = ctx.measureText(label).width + 110 * u, bh = 104 * u
    const a = appear(local, 1.0)
    // a soft pulse so a still post still reads as "tap me"
    const pulse = 1 + 0.03 * Math.sin(Math.max(0, local - 1.6) * 4)
    ctx.save(); ctx.globalAlpha *= a
    ctx.translate(W / 2, y + bh / 2); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -(y + bh / 2))
    rr(ctx, (W - bw) / 2, y + (1 - a) * 30 * u, bw, bh, bh / 2); ctx.fillStyle = C.btn || C.gold; ctx.fill()
    ctx.fillStyle = C.btn ? (lumOf(C.btn) > 150 ? '#14110B' : '#FFFFFF') : onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(label, (W - bw) / 2 + 55 * u, y + bh / 2 + (1 - a) * 30 * u)
    if (DRESS === 'lights' || DRESS === 'xmas') lightsAround(ctx, (W - bw) / 2, y + (1 - a) * 30 * u, bw, bh, local, u)
    ctx.restore()
    if (sc.items[1]) plain(ctx, sc.items[1], pad, y + bh + 36 * u, W - pad * 2, 30 * u, A.body, C.mut, 500, 'center', appear(local, 1.4))
    if (A.credit && p.music !== 'none') plain(ctx, A.credit, W - 900 * u, H - 44 * u, 880 * u, 18 * u, A.mono, 'rgba(255,255,255,0.45)', 400)
    return
  }

  if (sc.kind === 'contact') {
    background(ctx, W, H, im(0), local, dur, 1.3)
    const c = p.contact || ({} as AdContact)
    const face = c.photo ? A.img(c.photo) : null
    const sq = !portrait && W < H * 1.25
    const R = (portrait ? 300 : sq ? 190 : 260) * u
    const cx = portrait ? W / 2 : sq ? W * 0.27 : W * 0.29, cy = portrait ? H * 0.3 : sq ? H * 0.34 : H * 0.47
    const a = appear(local, 0)
    ctx.save(); ctx.globalAlpha *= a
    ctx.beginPath(); ctx.arc(cx, cy, R + 22 * u, 0, Math.PI * 2); ctx.fillStyle = 'rgba(210,176,119,0.16)'; ctx.fill()
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.save(); ctx.clip()
    if (face) cover(ctx, face, cx - R, cy - R, R * 2, R * 2); else { ctx.fillStyle = C.navy2; ctx.fillRect(cx - R, cy - R, R * 2, R * 2) }
    ctx.restore()
    ctx.lineWidth = 6 * u; ctx.strokeStyle = C.gold; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
    const tx = portrait ? pad : sq ? W * 0.48 : W * 0.5, tw = portrait ? W - pad * 2 : sq ? W * 0.46 : W * 0.44
    let ty = portrait ? H * 0.52 : sq ? H * 0.16 : H * 0.2
    const al: 'left' | 'center' = portrait ? 'center' : 'left'
    if (A.logo) {
      const lw = 230 * u, lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
      ctx.save(); ctx.globalAlpha *= appear(local, 0.2); drawMark(ctx, A.logo, portrait ? (W - lw) / 2 : tx, ty, lw, lh, local); ctx.restore()
      ty += lh + 50 * u
    }
    ty += rich(ctx, head || 'Book a **call.**', tx, ty, tw, fitHard(ctx, head || 'Book a **call.**', tw, 104 * u), { font: A.display, local, delay: 0.4, align: al, maxH: H * 0.22 }) + 30 * u
    const fade = (d: number) => appear(local, d)
    if (c.name) { ty += plain(ctx, c.name, tx, ty, tw, 54 * u, A.display, C.ink, 700, al, fade(0.7)) }
    if (c.role) { ty += plain(ctx, c.role, tx, ty, tw, 30 * u, A.body, C.mut, 500, al, fade(0.8)) + 26 * u }
    if (c.phone) { ty += plain(ctx, c.phone, tx, ty, tw, fitLine(ctx, c.phone, tw, 92 * u, 800, A.display), A.display, C.gold, 800, al, fade(1.1)) + 6 * u }
    if (c.email) { plain(ctx, c.email, tx, ty, tw, fitLine(ctx, c.email, tw, 30 * u, 500, A.mono), A.mono, C.ink, 500, al, fade(1.3)) }
    if (A.credit) plain(ctx, A.credit, W - 900 * u, H - 44 * u, 880 * u, 18 * u, A.mono, 'rgba(255,255,255,0.45)', 400)
    return
  }

  // MONTAGE (Jon, 2026-11-02: "never use a collage photo ever"): one photo at a time, full screen,
  // quick cuts with a push-in; the headline holds over them. No grids, ever.
  if (sc.kind === 'wall') {
    const list = sc.photos.length ? sc.photos.slice(0, 6) : ['']
    const n = list.length, seg = dur / n
    const k = Math.min(n - 1, Math.floor(local / seg)), lt = local - k * seg
    const draw = (j: number, t0: number, alpha: number) => {
      const img = get(list[j]); if (!img) { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H); return }
      ctx.save(); ctx.globalAlpha *= alpha
      cover(ctx, img, 0, 0, W, H, 1.06 + 0.1 * clamp(t0 / seg), (j % 2 ? -0.3 : 0.3) * clamp(t0 / seg))
      ctx.restore()
    }
    if (k > 0 && lt < 0.22) { draw(k - 1, seg + lt, 1); draw(k, lt, ease(lt / 0.22)) } else draw(k, lt, 1)
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, `rgba(${C.tint},${TA(0)})`); g.addColorStop(1, `rgba(${C.tint},${TA(0.82)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    // a thin progress tick per photo, like a story
    for (let j = 0; j < n && n > 1; j++) {
      const tw = (W - pad * 2 - (n - 1) * 10 * u) / n, x = pad + j * (tw + 10 * u)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, 40 * u, tw, 4 * u)
      ctx.fillStyle = C.gold; ctx.fillRect(x, 40 * u, tw * (j < k ? 1 : j === k ? clamp(lt / seg) : 0), 4 * u)
    }
    if (head) {
      const size = fitSize(ctx, head, W - pad * 2, (portrait ? 108 : 112) * u, H * 0.4)
      const hh = linesH(ctx, head, W - pad * 2, size)
      const y = H - bottomSafe - hh - (sc.sub ? 70 * u : 10 * u)
      ctx.fillStyle = C.gold; ctx.fillRect(pad, y - 26 * u, 90 * u * appear(local, 0.2), 6 * u)
      rich(ctx, head, pad, y, W - pad * 2, size, { font: A.display, local, delay: 0.25 })
      if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 14 * u, W - pad * 2, 34 * u, A.body, C.ink, 500, 'left', appear(local, 0.6))
    }
    return
  }

  // THREE BEATS: three full-screen moments in a row, each with its own big title (was side-by-side cards).
  if (sc.kind === 'cards') {
    const it = sc.items.slice(0, 3).length ? sc.items.slice(0, 3) : [head || '']
    const n = it.length, seg = dur / n
    const k = Math.min(n - 1, Math.floor(local / seg)), lt = local - k * seg
    const img = get(sc.photos[k] || sc.photos[0] || '')
    if (img) cover(ctx, img, 0, 0, W, H, 1.12 - 0.08 * clamp(lt / seg), (k % 2 ? 0.25 : -0.25) * clamp(lt / seg)); else { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H) }
    const g = ctx.createLinearGradient(portrait ? 0 : W, 0, portrait ? 0 : 0, portrait ? H : 0)
    g.addColorStop(0, `rgba(${C.tint},${TA(0.1)})`); g.addColorStop(1, `rgba(${C.tint},${TA(0.85)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    if (lt < 0.25 && k > 0) { ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - lt / 0.25)})`; ctx.fillRect(0, 0, W, H) }
    const [t1r, t2] = split(it[k]); const t1 = CAPS ? t1r.toUpperCase() : t1r
    const tw = portrait ? W - pad * 2 : W * 0.55
    const y = portrait ? H * 0.5 : H * 0.3
    plain(ctx, '0' + (k + 1) + ' / 0' + n, pad, y - 70 * u, tw, 30 * u, A.mono, C.gold, 600, 'left', appear(lt, 0))
    const size = (portrait ? 128 : 132) * u
    const hh = rich(ctx, t1.replace(/^(?!.*\*\*)(.*)$/, '**$1**'), pad, y, tw, size, { font: A.display, local: lt, delay: 0.05, stagger: 0.18, maxH: portrait ? H * 0.3 : H * 0.42 })
    if (t2) plain(ctx, t2, pad, y + hh + 16 * u, tw, 38 * u, A.body, C.ink, 500, 'left', appear(lt, 0.35))
    if (head && k === 0 && n > 1) plain(ctx, head.replace(/\*\*/g, ''), pad, pad + 40 * u, tw, 30 * u, A.body, C.mut, 600, 'left', appear(lt, 0))
    return
  }

  // TEXT MASK: giant letters with the photo showing through them.
  if (sc.kind === 'mask') {
    ctx.fillStyle = C.light ? C.navy2 : C.deep; ctx.fillRect(0, 0, W, H)
    const img = im(0)
    if (img) { ctx.save(); ctx.globalAlpha = C.light ? 0.12 : 0.1; try { ctx.filter = `blur(${Math.round(10 * u)}px)` } catch { /* */ } const cm = camAt(local, dur); cover(ctx, img, 0, 0, W, H, cm.z * 1.1, cm.x, cm.y); ctx.restore() }
    if (typeof document !== 'undefined') {
      const off = document.createElement('canvas'); off.width = W; off.height = H
      const o = off.getContext('2d')
      if (o) {
        const txt = (head || 'Stay').replace(/\*\*/g, '')
        let size = (portrait ? 330 : 300) * u
        o.font = fnt(FONTW ? 400 : 900, size, A.display)
        let lines = layout(o, txt, W - pad * 1.2)
        while (lines.some(L => L.w > W - pad * 1.2) && size > 80 * u) { size *= 0.9; o.font = fnt(FONTW ? 400 : 900, size, A.display); lines = layout(o, txt, W - pad * 1.2) }
        const S = size * FS, lh2 = S * 0.92, total = lines.length * lh2
        const a = appear(local, 0.05, 0.9), z = 1.12 - 0.12 * a
        o.save(); o.translate(W / 2, H / 2); o.scale(z, z); o.translate(-W / 2, -H / 2)
        o.fillStyle = '#fff'; o.textBaseline = 'alphabetic'
        lines.forEach((L, k) => { const s2 = L.words.map(w => w.t.trim()).join(' '); const w2 = o.measureText(s2).width; o.fillText(s2, (W - w2) / 2, (H - total) / 2 + S * 0.82 + k * lh2) })
        o.restore()
        o.globalCompositeOperation = 'source-in'
        if (img) { const cm = camAt(local, dur); try { o.filter = 'saturate(1.3) contrast(1.15) brightness(1.08)' } catch { /* */ } cover(o, img, 0, 0, W, H, cm.z, cm.x, cm.y) } else { o.fillStyle = C.gold; o.fillRect(0, 0, W, H) }
        ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(off, 0, 0); ctx.restore()
        ctx.save(); ctx.globalAlpha *= a * 0.9; ctx.strokeStyle = C.gold; ctx.lineWidth = 4 * u; ctx.font = fnt(FONTW ? 400 : 900, size, A.display)
        ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2)
        lines.forEach((L, k) => { const s2 = L.words.map(w => w.t.trim()).join(' '); const w2 = ctx.measureText(s2).width; ctx.strokeText(s2, (W - w2) / 2, (H - total) / 2 + S * 0.82 + k * lh2) })
        ctx.restore()
        if (sc.sub) plain(ctx, sc.sub, pad, (H + total) / 2 + 40 * u, W - pad * 2, 38 * u, A.body, C.ink, 600, 'center', appear(local, 0.8))
      }
    }
    return
  }

  // SPLIT PANEL: one photo, one solid panel with the headline (photo top on vertical).
  if (sc.kind === 'panel') {
    const img = im(0)
    const a = appear(local, 0, 0.8)
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H)
    const side = (i % 2 === 0)
    const ph = portrait ? H * 0.56 : H, pw = portrait ? W : W * 0.55
    const px = portrait ? 0 : (side ? 0 : W - pw), py = 0
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip()
    if (img) { const cm = camAt(local, dur); ctx.translate(portrait ? 0 : (side ? -1 : 1) * (1 - a) * 80 * u, portrait ? -(1 - a) * 60 * u : 0); cover(ctx, img, px, py, pw, ph, cm.z, cm.x, cm.y) } else { ctx.fillStyle = C.navy2; ctx.fillRect(px, py, pw, ph) }
    ctx.restore()
    // the panel
    const qx = portrait ? 0 : (side ? pw : 0), qy = portrait ? ph : 0, qw = portrait ? W : W - pw, qh = portrait ? H - ph : H
    ctx.fillStyle = C.light ? C.navy2 : C.navy2; ctx.fillRect(qx, qy, qw, qh)
    ctx.fillStyle = C.gold; if (portrait) ctx.fillRect(0, ph - 6 * u, W * a, 12 * u); else ctx.fillRect(side ? pw - 6 * u : W - pw - 6 * u, 0, 12 * u, H * a)
    const tp = (portrait ? 70 : 90) * u
    const tw = qw - tp * 2
    const size = fitSize(ctx, head, tw, (portrait ? 100 : 92) * u, (portrait ? qh - tp * 1.6 - (sc.sub ? 110 * u : 0) : H * 0.62))
    const hh = linesH(ctx, head, tw, size)
    const ty = portrait ? qy + tp * 0.8 : (H - hh) / 2 - (sc.sub ? 40 * u : 0)
    if (sc.items[0]) plain(ctx, sc.items[0].replace(/\|.*/, '').toUpperCase(), qx + tp, ty - 54 * u, tw, 26 * u, A.body, C.gold, 700, 'left', appear(local, 0.2))
    rich(ctx, head, qx + tp, ty, tw, size, { font: A.display, local, delay: 0.3, shadow: false })
    if (sc.sub) plain(ctx, sc.sub, qx + tp, ty + hh + 20 * u, tw, 34 * u, A.body, C.mut, 500, 'left', appear(local, 0.7))
    return
  }

  // TICKER: the headline runs across a colour band like a marquee, over a full-screen photo.
  if (sc.kind === 'ticker') {
    background(ctx, W, H, im(0), local, dur, 0.55)
    const bandH = (portrait ? 190 : 170) * u, by = portrait ? H * 0.42 : H * 0.42
    const a = appear(local, 0, 0.5)
    ctx.save(); ctx.translate(W / 2, by + bandH / 2); ctx.rotate(-0.045); ctx.translate(-W / 2, -(by + bandH / 2))
    ctx.fillStyle = C.gold; ctx.fillRect(-W * 0.1, by + (1 - a) * bandH / 2, W * 1.2, bandH * a)
    const txt = ((head || 'Stay here').replace(/\*\*/g, '').replace(/\n/g, ' ') + '   ✦   ').toUpperCase()
    const size = bandH * 0.62
    ctx.font = fnt(FONTW ? 400 : 900, size, A.display)
    const tw = ctx.measureText(txt).width
    const off = -((local * 260 * u / PD) % tw)
    ctx.beginPath(); ctx.rect(-W * 0.1, by, W * 1.2, bandH); ctx.clip()
    ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.globalAlpha *= a
    for (let x = off - tw; x < W * 1.2; x += tw) ctx.fillText(txt, x, by + bandH / 2 + size * 0.04)
    ctx.restore()
    if (sc.sub) plain(ctx, sc.sub, pad, by + bandH + 70 * u, W - pad * 2, 40 * u, A.body, C.ink, 600, 'center', appear(local, 0.5))
    return
  }

  // CALLOUTS: one photo, labels pointing at what is in it.
  if (sc.kind === 'callouts') {
    background(ctx, W, H, im(0), local, dur, 0.35)
    const it = sc.items.slice(0, 4)
    const spots = portrait ? [[0.3, 0.3], [0.68, 0.45], [0.35, 0.62], [0.7, 0.75]] : [[0.25, 0.35], [0.7, 0.3], [0.4, 0.65], [0.78, 0.68]]
    // Labels stack as clean pills beside the headline — they name what the place has, never point at a
    // spot in the photo (a pin on the wrong thing reads as a mistake).
    const lab = it.map(r => split(r)[0])
    ctx.font = fnt(700, (portrait ? 40 : 36) * u, A.body)
    const bh = (portrait ? 78 : 70) * u, gap = 16 * u
    const stackH = lab.length * (bh + gap)
    const sx0 = pad, sy0 = portrait ? H * 0.2 : (H - stackH) / 2 - 40 * u
    lab.forEach((t1, k) => {
      const a = appear(local, 0.3 + k * 0.35, 0.5)
      if (a <= 0) return
      const tw = ctx.measureText(t1).width, bw = tw + 90 * u, y = sy0 + k * (bh + gap)
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(-(1 - a) * 60 * u, 0)
      rr(ctx, sx0, y, bw, bh, bh / 2); ctx.fillStyle = C.light ? 'rgba(255,255,255,0.92)' : 'rgba(10,14,20,0.72)'; ctx.fill()
      ctx.beginPath(); ctx.arc(sx0 + 36 * u, y + bh / 2, 9 * u, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill()
      ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.textBaseline = 'middle'; ctx.font = fnt(700, (portrait ? 40 : 36) * u, A.body); ctx.fillText(t1, sx0 + 62 * u, y + bh / 2 + 2 * u)
      ctx.restore()
    })
    if (head) { const size = fitSize(ctx, head, W - pad * 2, (portrait ? 88 : 80) * u, H * 0.25); rich(ctx, head, pad, H - bottomSafe - linesH(ctx, head, W - pad * 2, size) - 10 * u, W - pad * 2, size, { font: A.display, local, delay: 0.1 }) }
    return
  }

  // POLAROID: one photo in a white instant-photo frame that drops in, caption written on it.
  if (sc.kind === 'polaroid') {
    const img = im(0)
    if (img) { ctx.save(); try { ctx.filter = `blur(${Math.round(22 * u)}px)` } catch { /* */ } cover(ctx, img, -40 * u, -40 * u, W + 80 * u, H + 80 * u, 1.15); ctx.restore() } else { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H) }
    ctx.fillStyle = `rgba(${C.tint},${TA(0.45)})`; ctx.fillRect(0, 0, W, H)
    const a = appear(local, 0.05, 0.9)
    const fw = portrait ? W * 0.78 : H * 0.62, fh = fw * 1.18
    const cx = W / 2 + (portrait ? 0 : -W * 0.14), cy = portrait ? H * 0.44 : H / 2
    ctx.save(); ctx.globalAlpha *= Math.min(1, a * 1.5)
    ctx.translate(cx, cy - (1 - a) * H * 0.5); ctx.rotate((-6 + 10 * (1 - a)) * Math.PI / 180 + 0.01 * Math.sin(local))
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 18 * u
    ctx.fillStyle = '#FBFAF6'; ctx.fillRect(-fw / 2, -fh / 2, fw, fh)
    ctx.shadowColor = 'transparent'
    const m = fw * 0.06, iw = fw - m * 2, ih = iw
    if (img) { ctx.save(); ctx.beginPath(); ctx.rect(-fw / 2 + m, -fh / 2 + m, iw, ih); ctx.clip(); cover(ctx, img, -fw / 2 + m, -fh / 2 + m, iw, ih, 1.05 + 0.05 * clamp(local / dur)); ctx.restore() }
    const cap = (sc.sub || head).replace(/\*\*/g, '').replace(/\n/g, ' ')
    ctx.fillStyle = '#2A2A2A'; ctx.font = fnt(600, fw * 0.075, A.elegant || A.serif || A.display); ctx.textBaseline = 'middle'
    const cw = ctx.measureText(cap).width
    ctx.save(); ctx.beginPath(); ctx.rect(-fw / 2, fh / 2 - (fh - ih - m), fw * appear(local, 0.8, 1.0), fh); ctx.clip()
    ctx.fillText(cap, -cw / 2, -fh / 2 + m + ih + (fh - ih - m) / 2)
    ctx.restore()
    ctx.restore()
    if (!portrait && head) rich(ctx, head, W * 0.62, H * 0.3, W * 0.32, 84 * u, { font: A.display, local, delay: 0.6, maxH: H * 0.5 })
    else if (portrait && sc.sub && head) { const hy = Math.max(H * 0.78, cy + fh / 2 + 40 * u); rich(ctx, head, pad, hy, W - pad * 2, 76 * u, { font: A.display, local, delay: 0.6, align: 'center', maxH: H - hy - 24 * u }) }
    return
  }

  // EVENT: a big date block for an event or a season.
  if (sc.kind === 'event') {
    background(ctx, W, H, im(0), local, dur, 1.0)
    const date = (sc.items[0] || '').replace(/\|.*/, '').toUpperCase()
    const a = appear(local, 0.1, 0.6)
    const bw = (portrait ? W * 0.7 : W * 0.34), bh = bw * 0.62
    const bx = portrait ? (W - bw) / 2 : pad, by = portrait ? H * 0.22 : (H - bh) / 2 - 40 * u
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 40 * u)
    rr(ctx, bx, by, bw, bh, 26 * u); ctx.fillStyle = C.gold; ctx.fill()
    let ds = bh * 0.42; ctx.font = fnt(FONTW ? 400 : 900, ds, A.display)
    while (ctx.measureText(date).width > bw * 0.86 && ds > 20) { ds *= 0.92; ctx.font = fnt(FONTW ? 400 : 900, ds, A.display) }
    ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'
    const dw = ctx.measureText(date).width; ctx.fillText(date, bx + (bw - dw) / 2, by + bh / 2 + ds * 0.04)
    ctx.restore()
    const tx = portrait ? pad : bx + bw + 70 * u, tw = portrait ? W - pad * 2 : W - tx - pad
    const ty = portrait ? by + bh + 70 * u : H * 0.34
    const hh = rich(ctx, head, tx, ty, tw, (portrait ? 104 : 96) * u, { font: A.display, local, delay: 0.5, align: portrait ? 'center' : 'left', maxH: portrait ? H - ty - bottomSafe - (sc.sub ? 90 * u : 20 * u) : H * 0.4 })
    if (sc.sub) plain(ctx, sc.sub, tx, ty + hh + 20 * u, tw, 36 * u, A.body, C.ink, 500, portrait ? 'center' : 'left', appear(local, 0.9))
    return
  }

  // CINEMATIC: letterbox, slow dolly, an elegant headline, a tracked place line.
  if (sc.kind === 'cinema') {
    const img = im(0)
    const pr = clamp(local / Math.max(dur, 1))
    if (img) { if (CAM === 'auto') cover(ctx, img, 0, 0, W, H, 1.02 + 0.14 * pr, -0.35 + 0.7 * pr); else { const cm = camAt(local, dur); cover(ctx, img, 0, 0, W, H, cm.z, cm.x, cm.y) } } else { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H) }
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${C.tint},${TA(0.2)})`); g.addColorStop(0.5, `rgba(${C.tint},${TA(0.42)})`); g.addColorStop(1, `rgba(${C.tint},${TA(0.72)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const bar = (portrait ? H * 0.09 : H * 0.115) * ease(local / 0.8)
    ctx.fillStyle = C.light ? C.navy2 : '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar)
    const size = fitSize(ctx, head, W - pad * 2.4, (portrait ? 104 : 96) * u, H * (portrait ? 0.4 : 0.42), 700)
    const hh = linesH(ctx, head, W - pad * 2.4, size)
    const y = (H - hh) / 2 + (portrait ? 40 : 30) * u
    // A light look with no wash keeps the photo untouched and switches to white type on a shadow (no frosted band).
    const Csave = C
    if (C.light && WASH === 'none') C = { ...C, light: false, ink: '#FFFFFF', mut: '#F0F0F0' }
    if (C.light) {
      // a soft frosted band so dark type reads over the photo
      const a0 = appear(local, 0.3)
      const bg = ctx.createLinearGradient(0, y - 60 * u, 0, y + hh + 160 * u)
      bg.addColorStop(0, `rgba(${C.tint},0)`); bg.addColorStop(0.25, `rgba(${C.tint},${0.82 * a0})`); bg.addColorStop(0.8, `rgba(${C.tint},${0.82 * a0})`); bg.addColorStop(1, `rgba(${C.tint},0)`)
      ctx.fillStyle = bg; ctx.fillRect(0, y - 60 * u, W, hh + 220 * u)
    }
    rich(ctx, head, pad * 1.2, y, W - pad * 2.4, size, { font: A.display, weight: 700, local, delay: 0.5, stagger: 0.35, align: 'center', lh: 1.04 })
    const rw = 160 * u * appear(local, 1.0, 0.8)
    ctx.fillStyle = C.gold; ctx.fillRect((W - rw) / 2, y + hh + 34 * u, rw, 3 * u)
    if (sc.sub) {
      ctx.save(); try { (ctx as any).letterSpacing = 8 * u + 'px' } catch { /* older canvas */ }
      plain(ctx, sc.sub.toUpperCase(), pad, y + hh + 64 * u, W - pad * 2, 28 * u, A.body, C.ink, 600, 'center', appear(local, 1.2))
      ctx.restore()
    }
    C = Csave
    return
  }

  // KINETIC TYPE: the words punch in one at a time, huge, over a blurred and darkened photo.
  if (sc.kind === 'kinetic') {
    const img = im(0)
    if (img) {
      ctx.save(); try { ctx.filter = `blur(${Math.round(16 * u)}px) saturate(1.2)` } catch { /* no filter */ }
      cover(ctx, img, -40 * u, -40 * u, W + 80 * u, H + 80 * u, 1.1 + 0.05 * clamp(local / dur))
      ctx.restore()
    } else { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H) }
    ctx.fillStyle = `rgba(${C.tint},${TA(0.55)})`; ctx.fillRect(0, 0, W, H)
    const size = fitSize(ctx, head || 'Stay **here.**', W - pad * 2, (portrait ? 150 : 160) * u, H * 0.62, 800, A.display, 1.02)
    const lines = layout(ctx, head || 'Stay **here.**', W - pad * 2)
    const lh = size * FS * 1.02, sp = ctx.measureText(' ').width
    const total = lines.length * lh
    let wi = 0
    const step = Math.min(0.32, Math.max(0.16, (dur * 0.55) / Math.max(1, lines.reduce((a, L) => a + L.words.length, 0))))
    ctx.textBaseline = 'alphabetic'
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li]
      let x = (W - L.w) / 2
      const yb = (H - total) / 2 + size * 0.86 + li * lh
      for (const w of L.words) {
        const t0 = 0.15 + wi * step, a = clamp((local - t0) / 0.22)
        if (a > 0) {
          const sc2 = 1 + 0.45 * (1 - ease(a))
          const ww = w.w
          ctx.save(); ctx.globalAlpha *= a
          ctx.translate(x + ww / 2, yb - size * 0.35); ctx.scale(sc2, sc2); ctx.translate(-(x + ww / 2), -(yb - size * 0.35))
          ctx.shadowColor = C.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)'; ctx.shadowBlur = size * 0.25
          ctx.fillStyle = w.gold ? C.gold : C.ink; ctx.fillText(w.t.trim(), x, yb)
          ctx.restore()
        }
        x += w.w + (L.words[L.words.indexOf(w) + 1]?.g ? 0 : sp); wi++
      }
    }
    if (sc.sub) plain(ctx, sc.sub, pad, (H + total) / 2 + 40 * u, W - pad * 2, 36 * u, A.body, C.mut, 500, 'center', appear(local, 0.3 + wi * step))
    return
  }

  // REVEAL: the photo opens out of a circle with a ring of light.
  if (sc.kind === 'reveal') {
    ctx.fillStyle = C.navy2; ctx.fillRect(0, 0, W, H)
    const img = im(0)
    const a = ease(clamp((local - 0.1) / 1.1))
    const R = Math.hypot(W, H) * 0.55 * a + 1
    const cx = W / 2, cy = portrait ? H * 0.42 : H / 2
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip()
    if (img) cover(ctx, img, 0, 0, W, H, 1.25 - 0.17 * a - 0.04 * clamp(local / dur)); else { ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H) }
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, `rgba(${C.tint},${TA(0)})`); g.addColorStop(1, `rgba(${C.tint},${TA(0.8)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    ctx.restore()
    if (a < 1) { ctx.save(); ctx.globalAlpha = 1 - a * 0.9; ctx.lineWidth = 6 * u; ctx.strokeStyle = C.gold; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
    const size = fitSize(ctx, head, W * (portrait ? 0.86 : 0.7), (portrait ? 112 : 108) * u, H * 0.4)
    const hh = linesH(ctx, head, W * (portrait ? 0.86 : 0.7), size)
    const y = H - bottomSafe - hh - (sc.sub ? 70 * u : 10 * u)
    rich(ctx, head, pad, y, W * (portrait ? 0.86 : 0.7), size, { font: A.display, local, delay: 0.9 })
    if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 14 * u, W * 0.6, 34 * u, A.body, C.ink, 500, 'left', appear(local, 1.2))
    return
  }

  // Team cards: the photos are the people, so the backdrop is the look's mesh, never a face blown up behind the cards.
  background(ctx, W, H, sc.kind === 'team' ? null : im(0), local, dur, sc.kind === 'photo' ? 0.6 : 1.15)

  if (sc.kind === 'title' || sc.kind === 'photo') {
    const hw = sc.kind === 'title' ? W - pad * 2 : W * (portrait ? 0.86 : 0.7)
    const size = fitSize(ctx, head, hw, (sc.kind === 'title' ? 130 : 104) * u, sc.kind === 'title' ? H * 0.58 : H * 0.42)
    const hh = linesH(ctx, head, hw, size)
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
    const fsz = fitSize(ctx, head, lw, 92 * u, H * 0.5)
    const hh = linesH(ctx, head, lw, fsz)
    ctx.font = fnt(500, 32 * u, A.body)
    const sh = sc.sub ? layout(ctx, sc.sub, lw).length * 32 * u * 1.3 : 0
    const y = (H - bottomSafe * 0.6 - hh - sh - 20 * u) / 2
    if (head) rich(ctx, head, pad, y, lw, fsz, { font: A.display, local, delay: 0.1 })
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

  // POSTER — the flyer design (Jon, 2026-11-04: flyers, Christmas post, boat show, "real design"). Full-bleed
  // photo with a deep gradient from the bottom, a small kicker up top, a date pill, the headline anchored
  // bottom-left, a line under it, and a solid call-to-action bar along the bottom edge.
  if (sc.kind === 'poster') {
    const img = im(0)
    const variant = (sc.items[2] || '').trim() || (C.light ? 'gallery' : (p.look === 'festival' || p.look === 'miami') ? 'neon' : 'dark')
    // string lights along the top push the kicker down so the bulbs never sit on the words
    const lightsTop = (sc.fx || []).indexOf('lights') >= 0 && ['top', 'both', 'frame'].indexOf(fxOpts(sc, 'lights').pos) >= 0
    const kOff = lightsTop ? 78 * u : 0
    const treeR = (sc.fx || []).indexOf('tree') >= 0 && ['br', 'right'].indexOf(fxOpts(sc, 'tree').pos) >= 0
    if (variant === 'gallery') {
      // GALLERY — a white mat, the photo sitting inside it, type below: Art Basel, editorial, print.
      // The mat is always light and the type dark — a gallery wall whatever the look; the accent colour stays.
      const mat = C.light ? C.navy2 : '#F4EFE6', inkG = C.light ? C.ink : '#15130F', mutG = C.light ? C.mut : '#5B564E'
      // a pale accent (cream gold, white) vanishes on the mat — the marked words take a deep gold instead
      const goldWas = C.gold
      if (lumOf(C.gold) > 150) C.gold = p.look === 'house' ? '#0A175F' : '#8A6A2E'  // the house look keeps its navy, not gold
      ctx.fillStyle = mat; ctx.fillRect(0, 0, W, H)
      const m = (portrait ? 70 : 90) * u, top = m + 60 * u
      const ph = portrait ? H * 0.56 : H * 0.62
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 14 * u; ctx.fillStyle = '#fff'; ctx.fillRect(m, top, W - m * 2, ph); ctx.restore()
      ctx.save(); ctx.beginPath(); ctx.rect(m, top, W - m * 2, ph); ctx.clip()
      if (img) cover(ctx, img, m, top, W - m * 2, ph, 1.02 + 0.03 * clamp(local / Math.max(dur, 1))); else { ctx.fillStyle = C.deep; ctx.fillRect(m, top, W - m * 2, ph) }
      ctx.restore()
      const kicker = (sc.badge || 'Stay Hospitality · South Florida').toUpperCase()
      ctx.save(); ctx.globalAlpha *= appear(local, 0.05); ctx.font = fnt(700, 24 * u, A.body); ctx.fillStyle = C.gold; ctx.fillText(kicker.split('').join(String.fromCharCode(8202)), m, m + 30 * u + kOff); ctx.restore()
      const date = (sc.items[0] || '').replace(/\|.*/, '').toUpperCase().trim()
      if (date) {
        // the date as a pill inside the photo, bottom-right
        const a = appear(local, 0.2); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 30 * u, A.display)
        const dw = ctx.measureText(date).width + 50 * u, dh = 60 * u
        const px = treeR ? m + 24 * u : W - m - dw - 24 * u  // a tree in the right corner moves the date to the left
        rr(ctx, px, top + ph - dh - 24 * u, dw, dh, dh / 2); ctx.fillStyle = C.gold; ctx.fill()
        ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(date, px + 25 * u, top + ph - dh / 2 - 22 * u); ctx.restore()
      }
      const ty = top + ph + 54 * u, tw = W - m * 2
      const cta = (sc.items[1] || '').replace(/\|.*/, '').trim()
      ctx.font = fnt(500, 30 * u, A.body)
      const subH = sc.sub ? (layout(ctx, sc.sub, tw).length || 1) * 30 * u * 1.35 + 14 * u : 0
      const ctaH = cta ? 60 * u : 0
      const size = fitSize(ctx, head, tw, (portrait ? 96 : 88) * u, H - ty - subH - ctaH - m - 20 * u, 800)
      const hh = linesH(ctx, head, tw, size)
      rich(ctx, head, m, ty, tw, size, { font: A.display, local, delay: 0.3, stagger: 0.18, maxH: H - ty - subH - ctaH - m, color: inkG })
      if (sc.sub) plain(ctx, sc.sub, m, ty + hh + 14 * u, tw, 30 * u, A.body, mutG, 500, 'left', appear(local, 0.7))
      if (cta) { const a = appear(local, 0.9); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 26 * u, A.body); ctx.fillStyle = inkG; ctx.fillText(cta.toUpperCase().split('').join(String.fromCharCode(8202)), m, H - m - 10 * u); ctx.fillStyle = C.gold; ctx.fillRect(m, H - m + 6 * u, 90 * u, 5 * u); ctx.restore() }
      C.gold = goldWas
      return
    }
    if (img) cover(ctx, img, 0, 0, W, H, 1.02 + 0.03 * clamp(local / Math.max(dur, 1)))
    else meshBg(ctx, W, H, local)
    if (variant === 'band') {
      // BAND — photo on top, a solid band in the look's base colour below, the words in the band. Clean, print-ready.
      const bandH = portrait ? H * 0.4 : H * 0.42
      ctx.fillStyle = C.navy; ctx.fillRect(0, H - bandH, W, bandH)
      ctx.fillStyle = C.gold; ctx.fillRect(0, H - bandH, W, 8 * u)
      const kicker = (sc.badge || 'Stay Hospitality · South Florida').toUpperCase()
      ctx.save(); ctx.globalAlpha *= appear(local, 0.05); ctx.font = fnt(700, 24 * u, A.body); ctx.fillStyle = C.gold; ctx.fillText(kicker.split('').join(String.fromCharCode(8202)), pad, H - bandH + 60 * u); ctx.restore()
      const date = (sc.items[0] || '').replace(/\|.*/, '').toUpperCase().trim(), cta = (sc.items[1] || '').replace(/\|.*/, '').trim()
      if (date) { const a = appear(local, 0.15); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 32 * u, A.display); const dw = ctx.measureText(date).width + 50 * u; rr(ctx, pad, H - bandH - 44 * u - 34 * u, dw, 66 * u, 33 * u); ctx.fillStyle = C.gold; ctx.fill(); ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(date, pad + 25 * u, H - bandH - 44 * u); ctx.restore() }
      const tw = W - pad * 2, ty = H - bandH + 90 * u
      ctx.font = fnt(500, 30 * u, A.body)
      const subH = sc.sub ? (layout(ctx, sc.sub, tw).length || 1) * 30 * u * 1.35 + 14 * u : 0
      const ctaH = cta ? 56 * u : 0
      const size = fitSize(ctx, head, tw, (portrait ? 100 : 92) * u, bandH - 90 * u - subH - ctaH - 50 * u, 800)
      const hh = linesH(ctx, head, tw, size)
      rich(ctx, head, pad, ty, tw, size, { font: A.display, local, delay: 0.3, stagger: 0.18, maxH: bandH - 100 * u - subH - ctaH })
      if (sc.sub) plain(ctx, sc.sub, pad, ty + hh + 14 * u, tw, 30 * u, A.body, C.mut, 500, 'left', appear(local, 0.7))
      if (cta) { const a = appear(local, 0.9); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 26 * u, A.body); ctx.fillStyle = C.gold; ctx.fillText(cta.toUpperCase().split('').join(String.fromCharCode(8202)), pad, H - 44 * u); ctx.restore() }
      return
    }
    if (variant === 'neon') {
      // NEON — the photo cooled right down, a huge outlined headline in the middle, a glowing accent fill on the key word.
      ctx.fillStyle = `rgba(${C.tint},${TA(0.72)})`; ctx.fillRect(0, 0, W, H)
      const kicker = (sc.badge || 'Stay Hospitality · South Florida').toUpperCase()
      ctx.save(); ctx.globalAlpha *= appear(local, 0.05); ctx.font = fnt(700, 26 * u, A.body); ctx.fillStyle = C.gold; ctx.fillText(kicker.split('').join(String.fromCharCode(8202)), pad, pad + 26 * u + kOff); ctx.restore()
      const date = (sc.items[0] || '').replace(/\|.*/, '').toUpperCase().trim(), cta = (sc.items[1] || '').replace(/\|.*/, '').trim()
      const tw = W - pad * 2
      const size = fitSize(ctx, head, tw, (portrait ? 150 : 140) * u, H * 0.5, 800, A.display, 0.98)
      const hh = linesH(ctx, head, tw, size, A.display, 0.98)
      const y = (H - hh) / 2 - 20 * u
      ctx.save(); ctx.shadowColor = C.gold; ctx.shadowBlur = 40 * u
      rich(ctx, head, pad, y, tw, size, { font: A.display, local, delay: 0.3, stagger: 0.12, align: 'center', lh: 0.98, maxH: H * 0.55 })
      ctx.restore()
      if (date) { const a = appear(local, 0.15); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 40 * u, A.display); const dw = ctx.measureText(date).width + 60 * u; rr(ctx, (W - dw) / 2, y - 100 * u, dw, 70 * u, 35 * u); ctx.strokeStyle = C.gold; ctx.lineWidth = 4 * u; ctx.stroke(); ctx.fillStyle = C.gold; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(date, W / 2, y - 64 * u); ctx.textAlign = 'left'; ctx.restore() }
      if (sc.sub) plain(ctx, sc.sub, pad, y + hh + 24 * u, tw, 34 * u, A.body, C.ink, 500, 'center', appear(local, 0.8))
      if (cta) { const a = appear(local, 0.95); ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(800, 34 * u, A.body); const cw = ctx.measureText(cta.toUpperCase()).width + 90 * u, ch = 92 * u, cy = H - bottomSafe - ch; rr(ctx, (W - cw) / 2, cy, cw, ch, ch / 2); ctx.fillStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = 30 * u; ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = onAccent(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cta.toUpperCase(), W / 2, cy + ch / 2 + 2 * u); ctx.textAlign = 'left'; ctx.restore() }
      return
    }
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, `rgba(${C.tint},${TA(0.25)})`); g.addColorStop(0.45, `rgba(${C.tint},${TA(0.18)})`); g.addColorStop(0.72, `rgba(${C.tint},${TA(0.72)})`); g.addColorStop(1, `rgba(${C.tint},${TA(0.96)})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const date = (sc.items[0] || '').replace(/\|.*/, '').toUpperCase().trim()
    const cta = (sc.items[1] || '').replace(/\|.*/, '').trim()
    const kicker = (sc.badge || 'Stay Hospitality · South Florida').toUpperCase()
    // kicker, top-left, tracked
    ctx.save(); ctx.globalAlpha *= appear(local, 0.05)
    ctx.font = fnt(700, 26 * u, A.body); ctx.fillStyle = C.gold
    const kk = kicker.split('').join(String.fromCharCode(8202))
    ctx.fillText(kk, pad, pad + 26 * u + kOff)
    ctx.fillRect(pad, pad + 44 * u + kOff, 70 * u, 4 * u)
    ctx.restore()
    // bottom bar
    const barH = cta ? (portrait ? 118 : 104) * u : 0
    if (cta) {
      const a = appear(local, 0.9)
      ctx.save(); ctx.globalAlpha *= a
      const barC = C.btn || C.gold, barInk = C.btn ? (lumOf(C.btn) > 150 ? '#14110B' : '#FFFFFF') : onAccent()
      ctx.fillStyle = barC; ctx.fillRect(0, H - barH, W, barH)
      const fs = fitSize(ctx, cta, W - pad * 2 - 80 * u, 40 * u, barH * 0.6, 800, A.body)
      ctx.font = fnt(800, fs, A.body); ctx.fillStyle = barInk; ctx.textBaseline = 'middle'
      ctx.fillText(cta.toUpperCase().split('').join(String.fromCharCode(8202)), pad, H - barH / 2 + 2 * u)
      // arrow
      const ax = W - pad - 40 * u, ay = H - barH / 2
      ctx.strokeStyle = barInk; ctx.lineWidth = 5 * u; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ax - 40 * u, ay); ctx.lineTo(ax, ay); ctx.moveTo(ax - 16 * u, ay - 16 * u); ctx.lineTo(ax, ay); ctx.lineTo(ax - 16 * u, ay + 16 * u); ctx.stroke()
      ctx.restore()
    }
    // headline block, anchored to the bottom (above the bar); a corner tree gets its own column
    const treeOn = (sc.fx || []).indexOf('tree') >= 0, treeO = treeOn ? fxOpts(sc, 'tree') : null
    const treeSide = !treeO ? '' : treeO.variant === 'pair' ? 'both' : treeO.pos === 'bl' || treeO.pos === 'left' ? 'left' : treeO.pos === 'center' ? '' : 'right'
    const tw = (W - pad * 2) * (treeSide === 'both' ? (portrait ? 0.5 : 0.56) : treeSide ? (portrait ? 0.66 : 0.72) : 1)
    const tx = treeSide === 'left' ? W - pad - tw : treeSide === 'both' ? (W - tw) / 2 : pad
    ctx.font = fnt(500, 34 * u, A.body)
    const subH = sc.sub ? (layout(ctx, sc.sub, tw).length || 1) * 34 * u * 1.35 + 20 * u : 0
    const size = fitSize(ctx, head, tw, (portrait ? 118 : 108) * u, H * 0.34, 800)
    const hh = linesH(ctx, head, tw, size)
    const by = H - barH - (portrait ? 70 : 56) * u - subH - hh
    rich(ctx, head, tx, by, tw, size, { font: A.display, local, delay: 0.35, stagger: 0.18, maxH: H * 0.36 })
    if (sc.sub) plain(ctx, sc.sub, tx, by + hh + 16 * u, tw, 34 * u, A.body, C.ink, 500, 'left', appear(local, 0.8))
    // date pill above the headline
    if (date) {
      const a = appear(local, 0.2)
      ctx.save(); ctx.globalAlpha *= a
      ctx.font = fnt(800, 34 * u, A.display)
      const dw = ctx.measureText(date).width + 56 * u, dh = 66 * u
      const dy = by - dh - 30 * u
      rr(ctx, tx, dy, dw, dh, dh / 2); ctx.fillStyle = C.gold; ctx.fill()
      ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(date, tx + 28 * u, dy + dh / 2 + 2 * u)
      ctx.restore()
    }
    return
  }

  // QUOTE — one line we stand behind, big, with a quotation mark; the sub line is who said it.
  if (sc.kind === 'quote') {
    background(ctx, W, H, im(0), local, dur, 1.2)
    const qw = W - pad * 2
    ctx.save(); ctx.globalAlpha *= appear(local, 0.05) * 0.9
    ctx.font = fnt(800, (portrait ? 260 : 300) * u, A.display); ctx.fillStyle = C.gold; ctx.fillText('“', pad - 10 * u, (portrait ? H * 0.3 : H * 0.36) + 40 * u)
    ctx.restore()
    const size = fitSize(ctx, head, qw, (portrait ? 80 : 88) * u, H * 0.5, 700, A.display, 1.15)
    const hh = linesH(ctx, head, qw, size, A.display, 1.15)
    const y = portrait ? H * 0.3 : H * 0.34
    rich(ctx, head, pad, y, qw, size, { font: A.display, local, delay: 0.2, stagger: 0.2, weight: 700, lh: 1.15, maxH: H * 0.55 })
    if (sc.sub) {
      const a = appear(local, 0.9)
      ctx.save(); ctx.globalAlpha *= a
      ctx.fillStyle = C.gold; ctx.fillRect(pad, y + hh + 34 * u, 90 * u, 5 * u)
      plain(ctx, sc.sub, pad + 120 * u, y + hh + 18 * u, qw - 120 * u, 32 * u, A.body, C.ink, 600, 'left', a)
      ctx.restore()
    }
    return
  }

  // The rest share a headline at the top-left (or top on vertical) and a content area beneath.
  // The logo sits top-right (about 200u wide, ~95u tall): on vertical shapes the headline starts under it; on
  // landscape it stops short of it. Headlines no longer run into the mark (2026-11-04 design pass).
  let top = portrait ? Math.max(pad + 20 * u, Math.max(46 * u, H * PF.safe.top + 20 * u) + 95 * u + 30 * u) : pad + 20 * u
  const headW = portrait ? W - pad * 2 : W - pad * 2 - 250 * u
  if (head) top += rich(ctx, head, pad, top, headW, (portrait ? 84 : 80) * u, { font: A.display, local, delay: 0.1, maxH: H * 0.26 }) + 16 * u
  if (sc.sub) top += plain(ctx, sc.sub, pad, top, W - pad * 2, 32 * u, A.body, C.mut, 500, 'left', appear(local, 0.4)) + 10 * u
  const area = { x: pad, y: top + 30 * u, w: W - pad * 2, h: H - bottomSafe - top - 40 * u }

  // TIMELINE — milestones along a gold line. Landscape: left → right (the date above each dot, the milestone
  // below); portrait: top → bottom.
  if (sc.kind === 'timeline') {
    const it = sc.items.slice(0, 6)
    const n = Math.max(1, it.length)
    if (!portrait) {
      const colW = area.w / n - 12 * u
      const ly = area.y + 70 * u, x0 = area.x + colW / 2 + 6 * u, x1 = area.x + area.w - colW / 2 - 6 * u
      const prog = appear(local, 0.2, 0.5 + n * 0.45)
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x1, ly); ctx.stroke()
      ctx.strokeStyle = C.gold; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + (x1 - x0) * prog, ly); ctx.stroke(); ctx.restore()
      const step = n > 1 ? (x1 - x0) / (n - 1) : 0
      for (let k = 0; k < n; k++) {
        const a = appear(local, 0.35 + k * 0.45, 0.5)
        if (a <= 0) continue
        const [when, what] = split(it[k])
        const x = x0 + step * k
        const tx = x - colW / 2
        ctx.save(); ctx.globalAlpha *= a
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(x, ly, 18 * u * (0.6 + 0.4 * a), 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = onAccent(); ctx.lineWidth = 4 * u; ctx.stroke()
        ctx.font = fnt(800, 32 * u, A.display); ctx.fillStyle = C.gold; ctx.textAlign = 'center'; ctx.fillText(when.toUpperCase(), x, ly - 36 * u); ctx.textAlign = 'left'
        plain(ctx, what, tx, ly + 44 * u, colW, 29 * u, A.body, C.ink, 500, 'center')
        ctx.restore()
      }
      return
    }
    const lx = area.x + 30 * u, y0 = area.y + 20 * u, y1 = area.y + area.h - 20 * u
    const prog = appear(local, 0.2, 0.5 + n * 0.45)
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke()
    ctx.strokeStyle = C.gold; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y0 + (y1 - y0) * prog); ctx.stroke(); ctx.restore()
    const step = n > 1 ? (y1 - y0) / (n - 1) : 0
    for (let k = 0; k < n; k++) {
      const a = appear(local, 0.35 + k * 0.45, 0.5)
      if (a <= 0) continue
      const [when, what] = split(it[k])
      const y = y0 + step * k
      ctx.save(); ctx.globalAlpha *= a
      ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(lx, y, 16 * u, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = onAccent(); ctx.lineWidth = 4 * u; ctx.stroke()
      ctx.font = fnt(800, 32 * u, A.display); ctx.fillStyle = C.gold; ctx.fillText(when.toUpperCase(), lx + 50 * u, y - 10 * u)
      plain(ctx, what, lx + 50 * u, y + 6 * u, area.w - 90 * u, 28 * u, A.body, C.ink, 500)
      ctx.restore()
    }
    return
  }

  // TEAM — people cards: round photo (or gold initials), name, role.
  if (sc.kind === 'team') {
    const it = sc.items.slice(0, 6)
    const n = Math.max(1, it.length)
    const cols = portrait ? (n > 4 ? 3 : 2) : Math.min(n, n > 4 ? 3 : n)
    const rows = Math.ceil(n / cols)
    const cw = area.w / cols
    const r = Math.max(50 * u, Math.min(cw * 0.3, 130 * u, (area.h / rows - 150 * u) / 2))
    const ch = r * 2 + 150 * u
    const y0 = area.y + Math.max(0, (area.h - ch * rows) / 2)
    for (let k = 0; k < n; k++) {
      const a = appear(local, 0.2 + k * 0.22, 0.5)
      if (a <= 0) continue
      const [name, role] = split(it[k])
      const cx = area.x + (k % cols) * cw + cw / 2, cy = y0 + Math.floor(k / cols) * ch + r + 20 * u
      const img = get(sc.photos[k] || '')
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 30 * u)
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
      if (img) cover(ctx, img, cx - r, cy - r, r * 2, r * 2, 1.02)
      else { ctx.fillStyle = C.gold; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.fillStyle = onAccent(); ctx.font = fnt(800, r * 0.9, A.display); ctx.textAlign = 'center'; ctx.fillText(name.split(/\s+/).map(w => w.charAt(0)).join('').slice(0, 2).toUpperCase(), cx, cy + r * 0.32); ctx.textAlign = 'left' }
      ctx.restore()
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = 5 * u; ctx.strokeStyle = C.gold; ctx.stroke()
      const nsz = fitSize(ctx, name, cw - 30 * u, 40 * u, 0, 800, A.display)
      ctx.font = fnt(800, nsz, A.display); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(name, cx, cy + r + 62 * u)
      ctx.font = fnt(500, 27 * u, A.body); ctx.fillStyle = C.mut; ctx.fillText(role, cx, cy + r + 102 * u); ctx.textAlign = 'left'
      ctx.restore()
    }
    return
  }

  if (sc.kind === 'stats') {
    const it = sc.items.slice(0, 6)
    const cols = portrait ? 2 : it.length === 4 ? 4 : Math.min(3, Math.max(1, it.length))
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
      const prog = ease((local - 0.1 - k * 0.08) / 0.75)
      const shown = pn ? pn.pre + (pn.n * prog).toLocaleString('en-US', { minimumFractionDigits: pn.dec, maximumFractionDigits: pn.dec }) + pn.suf : val
      const nsz = fitSize(ctx, val, cw - 50 * u, 120 * u); ctx.font = fnt(800, nsz, A.display); ctx.fillStyle = C.ink; ctx.fillText(shown, x, y + 150 * u)
      plain(ctx, label, x, y + 170 * u, cw - 50 * u, 32 * u, A.body, C.mut, 500)
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
    // Vertical shapes: the list sits in the middle of the free space rather than hugging the headline.
    const y0 = ly + Math.max(0, (avail - it.length * (rowH + gap)) / (portrait ? 2.6 : 2))
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
        if (on) { ctx.fillStyle = C.gold; ctx.fill(); ctx.strokeStyle = onAccent(); ctx.lineWidth = 5 * u; ctx.beginPath(); ctx.moveTo(bx + 11 * u, by + 23 * u); ctx.lineTo(bx + 19 * u, by + 31 * u); ctx.lineTo(bx + 34 * u, by + 13 * u); ctx.stroke() }
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
      ctx.font = fnt(600, 30 * u, A.body)
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
    ctx.font = fnt(500, 26 * u, A.body); ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.fillText('Switch to Stay', sx - 14 * u, cy + 26 * u); ctx.textAlign = 'left'
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


// ── PRO DESIGNS (Jon, 2026-11-04: "two videos … I love the way those look … need to be able to edit").
// The two sales videos were hand-built in a separate HTML pipeline. These are those twelve designs, redrawn
// on the canvas so every word, number, photo and timing in them can be edited here. Proportions are taken
// from the originals at 1920×1080 (the HTML stage scaled 1.8×); vertical shapes get their own stacking.
export const PRO_KINDS: AdKind[] = ['beats', 'tiles', 'grid', 'calendar', 'dates', 'hub', 'beforeafter', 'tilegrid', 'livefeed', 'roles', 'curve', 'triad']
const PRO_DIM: Partial<Record<AdKind, number>> = { beats: 1, tiles: 0, calendar: 2, dates: 2, hub: 0, beforeafter: 2, tilegrid: 2, livefeed: 0, roles: 0, curve: 2, triad: 2 }
export const PRO_DIM_OF = (k: AdKind) => PRO_DIM[k] ?? 0
/** The sales videos' photo layer: a slow 9-second push-in and the navy gradient (light · normal · dark). */
function proBg(ctx: CanvasRenderingContext2D, W: number, H: number, img: HTMLImageElement | HTMLVideoElement | null, local: number, level: number) {
  if (!img) { meshBg(ctx, W, H, local); return }
  const k = ease(local / (9 * PD))
  const c = CAM && CAM !== 'auto' ? camAt(local, 9) : { z: 1.02 + 0.1 * k, x: 0.25 * k, y: 0.16 * k }
  cover(ctx, img, 0, 0, W, H, c.z, c.x, c.y)
  if (level >= 2) { ctx.fillStyle = `rgba(${C.tint},${TA(0.86)})`; ctx.fillRect(0, 0, W, H); return }
  const [a, b, d] = level === 1 ? [0.15, 0.35, 0.8] : [0.45, 0.62, 0.9]
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, `rgba(${C.tint},${TA(a)})`); g.addColorStop(0.55, `rgba(${C.tint},${TA(b)})`); g.addColorStop(1, `rgba(${C.tint},${TA(d)})`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
}
const rgbaOf = (hex: string, a: number) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})` }
/** Mono eyebrow in the accent, letter-spaced. */
function eyebrow(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, A: AdAssets, a = 1, color = C.gold, align: 'left' | 'center' | 'right' = 'left', upper = true) {
  if (!text || a <= 0) return
  ctx.save(); ctx.globalAlpha *= a; ctx.font = fnt(500, size, A.mono); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
  try { (ctx as any).letterSpacing = size * 0.14 + 'px' } catch { /* older canvas */ }
  const t = upper ? text.toUpperCase() : text, w = ctx.measureText(t).width
  ctx.fillText(t, align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y)
  ctx.restore()
}
/** A pill chip with a soft accent outline (mono). Returns its width. */
function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, A: AdAssets, a: number, fill = false): number {
  ctx.save(); ctx.font = fnt(500, size, A.mono)
  const w = ctx.measureText(text).width + size * 1.6, h = size * 2
  if (a > 0) {
    ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 14 * (size / 20))
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = fill ? C.gold : (C.light ? 'rgba(255,255,255,0.7)' : 'rgba(10,26,40,0.6)'); ctx.fill()
    ctx.lineWidth = Math.max(1, size * 0.08); ctx.strokeStyle = rgbaOf(C.gold, 0.55); ctx.stroke()
    ctx.fillStyle = fill ? onAccent() : C.ink; ctx.textBaseline = 'middle'; ctx.fillText(text, x + size * 0.8, y + h / 2 + 1)
  }
  ctx.restore()
  return w
}
/** A row of chips, wrapped and centred (or left-aligned) inside maxW. */
function chipRow(ctx: CanvasRenderingContext2D, list: string[], x: number, y: number, maxW: number, size: number, A: AdAssets, local: number, delay: number, align: 'left' | 'center') {
  ctx.font = fnt(500, size, A.mono)
  const ws = list.map(t => ctx.measureText(t).width + size * 1.6), gap = size * 0.6, h = size * 2
  const rows: number[][] = [[]]; let cw = 0
  ws.forEach((w, k) => { if (cw && cw + gap + w > maxW) { rows.push([]); cw = 0 } rows[rows.length - 1].push(k); cw += (cw ? gap : 0) + w })
  rows.forEach((row, ri) => {
    const rw = row.reduce((s, k) => s + ws[k], 0) + gap * (row.length - 1)
    let cx = align === 'center' ? x + (maxW - rw) / 2 : x
    row.forEach(k => { chip(ctx, list[k], cx, y + ri * (h + gap), size, A, appear(local, delay + k * 0.2, 0.7)); cx += ws[k] + gap })
  })
  return rows.length * (h + gap)
}
/** A glass card the way the sales videos draw them: frosted navy, hairline border, optional accent ring. */
function proGlass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, on = 0, glow = true) {
  rr(ctx, x, y, w, h, r); ctx.fillStyle = C.light ? 'rgba(255,255,255,0.78)' : 'rgba(10,26,40,0.58)'; ctx.fill()
  ctx.lineWidth = 1.5; ctx.strokeStyle = C.light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.16)'; ctx.stroke()
  if (on > 0 && !glow) { ctx.save(); ctx.globalAlpha *= on * 0.75; rr(ctx, x, y, w, h, r); ctx.lineWidth = 1.5; ctx.strokeStyle = C.gold; ctx.stroke(); ctx.restore(); return }
  if (on > 0) {
    ctx.save(); ctx.globalAlpha *= on; ctx.shadowColor = rgbaOf(C.gold, 0.5); ctx.shadowBlur = 30
    rr(ctx, x, y, w, h, r); ctx.lineWidth = 3; ctx.strokeStyle = C.gold; ctx.stroke(); ctx.restore()
  }
}
/** The size at which every hard line (\n) fits on ONE line — designed headlines keep their breaks. */
function fitHard(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800, font = DISPLAY): number {
  let sz = size
  for (let k = 0; k < 20; k++) {
    ctx.font = fnt(weight, sz, font)
    if (String(text).split('\n').every(l => ctx.measureText(l.replace(/\*\*/g, '')).width <= maxW)) break
    sz *= 0.94
  }
  return sz
}
/** The size at which a line fits on ONE line (down to 55 % of the design size). */
function fitLine(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number | string, font: string): number {
  let sz = size
  for (let k = 0; k < 14; k++) { ctx.font = fnt(weight, sz, font); if (ctx.measureText(String(text).replace(/\*\*/g, '')).width <= maxW || sz < size * 0.56) break; sz *= 0.95 }
  return sz
}
const rnd01 = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v) }
const cubicAt = (p0: number[], p1: number[], p2: number[], p3: number[], t: number) => { const m = 1 - t; return [m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]] }

function drawPro(ctx: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets, get: (u: string) => HTMLImageElement | HTMLVideoElement | null, bottomSafe: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const sc = p.scenes[i]
  const u = Math.min(W, H) / 1080
  const portrait = H > W * 1.1
  const square = !portrait && W < H * 1.25
  const PF = platformOf(p)
  const lvl = sc.dim == null ? (PRO_DIM[sc.kind] ?? 0) : sc.dim
  const head = CAPS ? (sc.head || '').toUpperCase() : sc.head || ''
  const eb = sc.eyebrow || ''
  // the stage: 7% each side, a little more at the bottom (as the HTML stage), clear of the logo and captions
  const padX = Math.max((portrait ? 70 : 0.07 * W / u) * u, 30 * u)
  const topY = portrait ? Math.max(H * PF.safe.top + 150 * u, 210 * u) : Math.max(0.1 * H, H * PF.safe.top + 40 * u)
  const box = { x: padX, y: topY, w: W - padX * 2, h: H - bottomSafe - topY - (portrait ? 30 : 10) * u }
  const ph = (k: number) => get(sc.photos[k] || '')
  ANIM = sc.anim && sc.anim !== 'auto' ? sc.anim : 'rise'

  // BEATS — the hook: two to four short lines, one per beat, centred over the photo.
  if (sc.kind === 'beats') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const text = head || 'More **revenue.**\nLower **fee.**\nOne complete **team.**'
    const size = fitSize(ctx, text, box.w, fitHard(ctx, text, box.w, (portrait ? 120 : square ? 108 : 116) * u), box.h * 0.8, 800, A.display, 1.08)
    const hh = linesH(ctx, text, box.w, size, A.display, 1.08)
    const y = box.y + (box.h - hh) / 2 - (sc.sub ? 30 * u : 0)
    rich(ctx, text, box.x, y, box.w, size, { font: A.display, local, delay: 0.1, stagger: 0.8, align: 'center', lh: 1.08 })
    if (sc.sub) plain(ctx, sc.sub, box.x, y + hh + 24 * u, box.w, 30 * u, A.body, C.mut, 500, 'center', appear(local, 0.4 + 0.8 * layout(ctx, text, box.w).length))
    return
  }

  // TILES — figures that count up (gold rule above each), then the markets as chips.
  if (sc.kind === 'tiles') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = sc.items.slice(0, 9)
    const cols = portrait ? 2 : it.length === 4 ? 2 : Math.min(3, Math.max(1, it.length))
    const rows = Math.ceil(it.length / cols) || 1
    const chips = (sc.sub || '').split('·').map(s => s.trim()).filter(Boolean)
    let y = box.y
    if (eb) { eyebrow(ctx, eb, box.x, y + 24 * u, 22 * u, A, appear(local, 0)); y += 56 * u }
    if (head) { y += rich(ctx, head, box.x, y, box.w, (portrait ? 84 : 72) * u, { font: A.display, local, delay: 0.05, maxH: box.h * 0.22 }) + 30 * u }
    const gapX = box.w * 0.045, cw = (box.w - gapX * (cols - 1)) / cols
    const nsz = (portrait ? 110 : 88) * u, rowH = nsz + 92 * u
    const gridH = rows * rowH + (rows - 1) * 40 * u
    const chipH = chips.length ? 100 * u : 0
    y = Math.max(y, box.y + (box.h - gridH - chipH) / 2)
    for (let k = 0; k < it.length; k++) {
      const [val, label] = split(it[k])
      const x = box.x + (k % cols) * (cw + gapX), ty = y + Math.floor(k / cols) * (rowH + 40 * u)
      const a = appear(local, k * 0.18, 0.7)
      if (a <= 0) continue
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 25 * u)
      ctx.fillStyle = C.gold; ctx.fillRect(x, ty, cw, 3.5 * u)
      const pn = parseNum(val), prog = ease((local - k * 0.18 * PD) / (1.4 * PD))
      const shown = pn ? pn.pre + (pn.n * prog).toLocaleString('en-US', { minimumFractionDigits: pn.dec, maximumFractionDigits: pn.dec }) + pn.suf : val
      const s2 = fitSize(ctx, val, cw - 10 * u, nsz, 0, 800, A.display, 1)
      ctx.font = fnt(800, s2, A.display); ctx.fillStyle = C.ink; ctx.textBaseline = 'alphabetic'
      ctx.fillText(shown, x, ty + 30 * u + s2 * 0.9)
      plain(ctx, label, x, ty + 42 * u + s2 * 0.9, cw, 24 * u, A.body, C.mut, 500)
      ctx.restore()
    }
    if (chips.length) chipRow(ctx, chips, box.x, y + gridH + 54 * u, box.w, 22 * u, A, local, 1.6, 'center')
    return
  }

  // GRID — the buildings wall (labelled tiles that pop in), or, with a headline, a full-bleed dimmed wall
  // with the question over it. Up to nine photos; row k labels photo k.
  if (sc.kind === 'grid') {
    const list = sc.photos.slice(0, 9).filter(Boolean)
    const n = Math.max(1, list.length)
    const cols = portrait ? (n > 6 ? 3 : 2) : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols)
    if (head) {
      ctx.fillStyle = C.deep; ctx.fillRect(0, 0, W, H)
      const g = 3 * u, cw = (W - g * (cols - 1)) / cols, ch = (H - g * (rows - 1)) / rows
      for (let k = 0; k < list.length; k++) {
        const a = appear(local, k * 0.07, 0.55); if (a <= 0) continue
        const x = (k % cols) * (cw + g), y = Math.floor(k / cols) * (ch + g), img = get(list[k])
        ctx.save(); ctx.globalAlpha *= a; const z = 0.92 + 0.08 * a
        ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(z, z); ctx.translate(-(x + cw / 2), -(y + ch / 2))
        ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip()
        if (img) cover(ctx, img, x, y, cw, ch, 1.02 + 0.1 * ease(local / (6 * PD))); ctx.restore()
      }
      const rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
      rg.addColorStop(0, `rgba(${C.tint},${TA(lvl >= 2 ? 0.7 : lvl === 1 ? 0.4 : 0.55)})`); rg.addColorStop(1, `rgba(${C.tint},${TA(lvl >= 2 ? 0.92 : lvl === 1 ? 0.65 : 0.8)})`)
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
      const size = fitSize(ctx, head, box.w, fitHard(ctx, head, box.w, (portrait ? 128 : 124) * u), box.h * 0.7, 800, A.display, 1.05)
      const hh = linesH(ctx, head, box.w, size, A.display, 1.05)
      const y = box.y + (box.h - hh) / 2
      rich(ctx, head, box.x, y, box.w, size, { font: A.display, local, delay: 0.6, stagger: 0.25, align: 'center', lh: 1.05 })
      if (sc.sub) plain(ctx, sc.sub, box.x, y + hh + 26 * u, box.w, 32 * u, A.body, C.mut, 500, 'center', appear(local, 1.1))
      return
    }
    proBg(ctx, W, H, null, local, 0)
    const g = box.w * 0.014, cw = (box.w - g * (cols - 1)) / cols
    const ch = Math.min((box.h - g * (rows - 1)) / rows, cw * (portrait ? 1.1 : 0.62))
    const y0 = box.y + (box.h - (ch * rows + g * (rows - 1))) / 2
    for (let k = 0; k < list.length; k++) {
      const a = appear(local, k * 0.1, 0.55); if (a <= 0) continue
      const x = box.x + (k % cols) * (cw + g), y = y0 + Math.floor(k / cols) * (ch + g), img = get(list[k])
      ctx.save(); ctx.globalAlpha *= a; const z = 0.92 + 0.08 * a
      ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(z, z); ctx.translate(-(x + cw / 2), -(y + ch / 2))
      rr(ctx, x, y, cw, ch, 10 * u); ctx.save(); ctx.clip()
      if (img) cover(ctx, img, x, y, cw, ch, 1.02 + 0.1 * ease(local / (6 * PD)))
      const lg = ctx.createLinearGradient(0, y + ch * 0.45, 0, y + ch); lg.addColorStop(0, 'rgba(6,18,30,0)'); lg.addColorStop(1, 'rgba(6,18,30,0.78)')
      ctx.fillStyle = lg; ctx.fillRect(x, y, cw, ch); ctx.restore()
      const label = (sc.items[k] || '').split('|')[0].trim()
      if (label) { ctx.font = fnt(700, Math.min(32 * u, ch * 0.14), A.display); ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, x + cw * 0.06, y + ch * 0.9) }
      ctx.restore()
    }
    return
  }

  // CALENDAR — nightly rates for the next five weeks; a couple of cells reprice every 0.38 s.
  if (sc.kind === 'calendar') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const base = ((sc.items[1] || '').match(/\d+/g) || []).map(Number).slice(0, 7)
    const B = base.length === 7 ? base : [189, 179, 185, 199, 259, 289, 229]
    const v: number[] = Array.from({ length: 35 }, (_, k) => B[k % 7] + (k > 27 ? 60 : 0))
    const ticks = Math.min(30, Math.max(0, Math.floor((local / PD - 0.6) / 0.38)))
    const flash: number[] = [], touched: number[] = []
    for (let n = 0; n < ticks; n++) for (let q = 0; q < 2; q++) {
      const c = Math.floor(rnd01(n + 1, q + 1) * 35)
      v[c] = Math.max(150, Math.min(420, v[c] + Math.round((rnd01(n + 7, q + 3) - 0.4) * 40)))
      if (touched.indexOf(c) < 0) touched.push(c)
      if (n === ticks - 1) flash.push(c)
    }
    const flashA = 1 - clamp(((local / PD - 0.6) - ticks * 0.38) / 0.38)
    let y = box.y
    eyebrow(ctx, eb || 'Nightly rate · next 5 weeks', box.x, y + 22 * u, 21 * u, A, appear(local, 0))
    if (sc.sub && !portrait) eyebrow(ctx, '● ' + sc.sub, box.x + box.w, y + 22 * u, 21 * u, A, appear(local, 0.6), '#9EE2B8', 'right', false)
    y += 44 * u
    if (sc.sub && portrait) { eyebrow(ctx, '● ' + sc.sub, box.x, y + 22 * u, 21 * u, A, appear(local, 0.6), '#9EE2B8', 'left', false); y += 44 * u }
    if (head) y += rich(ctx, head, box.x, y, box.w, (portrait ? 74 : 60) * u, { font: A.display, local, delay: 0.1, maxH: box.h * 0.2 }) + 20 * u
    const g = 7 * u, cw = (box.w - g * 6) / 7
    const foot = sc.items[0] || ''
    const avail = box.y + box.h - y - 34 * u - (foot ? 50 * u : 0)
    const ch = Math.min(cw * (portrait ? 1.25 : 0.62), (avail - 5 * g) / 5)
    ctx.font = fnt(500, 19 * u, A.mono); ctx.fillStyle = C.mut; ctx.textBaseline = 'alphabetic'
    days.forEach((d, k) => { const w = ctx.measureText(d).width; ctx.fillText(d, box.x + k * (cw + g) + (cw - w) / 2, y + 22 * u) })
    y += 36 * u
    for (let k = 0; k < 35; k++) {
      const a = appear(local, 0.05 + (k % 7) * 0.03 + Math.floor(k / 7) * 0.05, 0.5); if (a <= 0) continue
      const x = box.x + (k % 7) * (cw + g), cy = y + Math.floor(k / 7) * (ch + g)
      ctx.save(); ctx.globalAlpha *= a
      rr(ctx, x, cy, cw, ch, 9 * u); ctx.fillStyle = rgbaOf(C.gold, Math.min(0.85, Math.max(0.08, (v[k] - 160) / 220))); ctx.fill()
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke()
      if (touched.indexOf(k) >= 0) { rr(ctx, x + 1.5 * u, cy + 1.5 * u, cw - 3 * u, ch - 3 * u, 8 * u); ctx.lineWidth = 2.2 * u; ctx.strokeStyle = rgbaOf(C.gold, 0.85); ctx.stroke() }
      if (flash.indexOf(k) >= 0 && flashA > 0) { ctx.save(); ctx.globalAlpha *= flashA; rr(ctx, x + 2 * u, cy + 2 * u, cw - 4 * u, ch - 4 * u, 8 * u); ctx.lineWidth = 3.5 * u; ctx.strokeStyle = C.gold; ctx.stroke(); ctx.restore() }
      const dark = v[k] > 300
      ctx.font = fnt(500, 15 * u, A.mono); ctx.fillStyle = dark ? 'rgba(27,20,8,0.7)' : rgbaOf(C.light ? '#000000' : '#FFFFFF', 0.7); ctx.fillText(String((k % 31) + 1), x + cw * 0.08, cy + 22 * u)
      const ps = Math.min(30 * u, cw * 0.24, ch * 0.42)
      ctx.font = fnt(700, ps, A.display); ctx.fillStyle = dark ? '#1B1408' : C.ink; ctx.fillText('$' + v[k], x + cw * 0.08, cy + Math.min(ch - 12 * u, 22 * u + ps + 10 * u))
      ctx.restore()
    }
    if (foot) plain(ctx, foot, box.x, y + 5 * (ch + g) + 18 * u, box.w, 18 * u, A.mono, C.mut, 400, 'left', appear(local, 1))
    return
  }

  // DATES — event cards that flip from a standard rate to a premium one. Rows: Month|Event|$standard|$premium
  if (sc.kind === 'dates') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = sc.items.slice(0, 6).map(r => r.split('|').map(s => s.trim()))
    const n = Math.max(1, it.length)
    let y = box.y
    eyebrow(ctx, eb || 'High-demand dates · priced months ahead', box.x, y + 22 * u, 21 * u, A, appear(local, 0)); y += 50 * u
    if (head) y += rich(ctx, head, box.x, y, box.w, (portrait ? 74 : 60) * u, { font: A.display, local, delay: 0.1, maxH: box.h * 0.2 }) + 20 * u
    const cols = portrait ? 2 : Math.min(n, 5), rows = Math.ceil(n / cols)
    const g = box.w * 0.02, cw = (box.w - g * (cols - 1)) / cols
    const ch = Math.min(portrait ? 330 * u : 300 * u, (box.y + box.h - y - (sc.sub ? 70 * u : 20 * u) - g * (rows - 1)) / rows)
    const y0 = y + Math.max(0, (box.y + box.h - y - (sc.sub ? 70 * u : 0) - (ch * rows + g * (rows - 1))) / (portrait ? 2.4 : 3))
    for (let k = 0; k < it.length; k++) {
      const [mon, ev, r1, r2] = it[k]
      const a = appear(local, k * 0.15, 0.6); if (a <= 0) continue
      const x = box.x + (k % cols) * (cw + g), cy = y0 + Math.floor(k / cols) * (ch + g)
      const on = appear(local, 0.9 + k * 0.45, 0.4)
      const from = parseNum(r1 || ''), to = parseNum(r2 || '')
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 25 * u)
      proGlass(ctx, x, cy, cw, ch, 18 * u, on)
      const ip = cw * 0.09
      ctx.font = fnt(500, 20 * u, A.mono); ctx.fillStyle = C.gold; ctx.textBaseline = 'alphabetic'; ctx.fillText(mon || '', x + ip, cy + ip + 16 * u)
      const ts = fitSize(ctx, ev || '', cw - ip * 2, 30 * u, 80 * u, 700, A.display, 1.15)
      rich(ctx, ev || '', x + ip, cy + ip + 32 * u, cw - ip * 2, ts, { font: A.display, weight: 700, local: 99, lh: 1.15, shadow: false })
      const prog = ease((local / PD - 0.9 - k * 0.45) / 0.9)
      const val = from && to ? Math.round(from.n + (to.n - from.n) * prog) : 0
      const big = from && to ? (to.pre || '$') + val.toLocaleString('en-US') : (r2 || r1 || '')
      const rs = fitSize(ctx, big, cw - ip * 2, 62 * u, 0, 800, A.display, 1)
      if (on > 0 && r1) { ctx.save(); ctx.globalAlpha *= on; ctx.font = fnt(500, 20 * u, A.mono); ctx.fillStyle = C.mut; const sw = ctx.measureText(r1).width; ctx.fillText(r1, x + ip, cy + ch - ip - rs - 6 * u); ctx.fillRect(x + ip, cy + ch - ip - rs - 13 * u, sw, 2 * u); ctx.restore() }
      ctx.font = fnt(800, rs, A.display); ctx.fillStyle = on > 0.5 ? C.gold : C.ink; ctx.fillText(big, x + ip, cy + ch - ip)
      ctx.restore()
    }
    if (sc.sub) plain(ctx, sc.sub, box.x, y0 + rows * (ch + g) + 14 * u, box.w, 18 * u, A.mono, C.mut, 400, 'left', appear(local, 1.2))
    return
  }

  // HUB — the listing at the centre, a spoke out to every channel. Rows: the channels (the last one is gold).
  if (sc.kind === 'hub') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const ch = sc.items.length ? sc.items.slice(0, 10) : ['Airbnb', 'Vrbo', 'Booking.com', 'Expedia', 'Marriott', 'Blueground', 'stay-hospitality.com']
    const cx = W / 2, cy = box.y + box.h * (portrait ? 0.45 : 0.45)
    const rx = portrait ? box.w * 0.42 : box.w * 0.38, ry = portrait ? box.h * 0.32 : box.h * 0.4
    const R = (portrait ? 120 : 92) * u
    const pts = ch.map((_, k) => { const an = -Math.PI / 2 + k * 2 * Math.PI / ch.length; return [cx + rx * Math.cos(an), cy + ry * Math.sin(an)] })
    ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5 * u
    pts.forEach((q, k) => { const a = ease((local / PD - 0.3 - k * 0.18) / 0.6); if (a <= 0) return; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (q[0] - cx) * a, cy + (q[1] - cy) * a); ctx.stroke() })
    ctx.restore()
    const ha = appear(local, 0, 0.7)
    ctx.save(); ctx.globalAlpha *= ha; ctx.translate(0, (1 - ha) * 18 * u)
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = C.light ? 'rgba(255,255,255,0.85)' : 'rgba(10,26,40,0.72)'; ctx.fill(); ctx.lineWidth = 3 * u; ctx.strokeStyle = C.gold; ctx.stroke()
    ctx.restore()
    eyebrow(ctx, eb || 'Your home', cx, cy + 8 * u, 20 * u, A, ha, C.gold, 'center')
    pts.forEach((q, k) => {
      const a = appear(local, 0.5 + k * 0.18, 0.55); if (a <= 0) return
      const last = k === ch.length - 1 && /stay/i.test(ch[k])
      ctx.font = fnt(500, (portrait ? 24 : 21) * u, A.mono)
      const w = ctx.measureText(ch[k]).width + 36 * u, h = (portrait ? 50 : 44) * u
      ctx.save(); ctx.globalAlpha *= a
      const x = Math.max(box.x - padX * 0.5, Math.min(W - w - padX * 0.5, q[0] - w / 2)), y = q[1] - h / 2 + (1 - a) * 18 * u
      rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = last ? C.gold : (C.light ? 'rgba(255,255,255,0.88)' : 'rgba(10,26,40,0.8)'); ctx.fill(); ctx.lineWidth = 1.5 * u; ctx.strokeStyle = rgbaOf(C.gold, 0.6); ctx.stroke()
      ctx.fillStyle = last ? onAccent() : C.ink; ctx.textBaseline = 'middle'; ctx.fillText(ch[k], x + 18 * u, y + h / 2 + 1)
      ctx.restore()
    })
    const line = head || sc.sub
    if (line) {
      const yy = Math.min(box.y + box.h - 50 * u, cy + ry + (portrait ? 90 : 50) * u)
      rich(ctx, line, box.x, yy, box.w, (portrait ? 46 : 36) * u, { font: A.display, weight: 700, local, delay: 1.6, align: 'center' })
    }
    return
  }

  // BEFORE → AFTER — a real listing rebuilds: the hero photo and title swap, the checklist ticks off.
  // Photo 1 = background; photos 2–4 = before; photos 5–7 = after. Sub = the old title, headline = the new.
  if (sc.kind === 'beforeafter') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const before = [1, 2, 3].map(k => sc.photos[k] || ''), after = [4, 5, 6].map((k, j) => sc.photos[k] || before[j])
    const it = sc.items.slice(0, 5)
    const cardW = portrait ? box.w : box.w * 0.54, cardX = box.x
    const pad2 = 22 * u, mosW = cardW - pad2 * 2
    const titleH = 92 * u
    const listW = portrait ? box.w : box.w - cardW - box.w * 0.06
    const rowH = (portrait ? 70 : 64) * u
    // vertical: the card gives way so the checklist stays clear of the captions
    const mosH = portrait ? Math.min(mosW * 10 / 16, box.h - titleH - pad2 - 70 * u - it.length * rowH) : mosW * 10 / 16
    const cardH = pad2 + mosH + titleH
    const total = portrait ? cardH + 60 * u + it.length * rowH : Math.max(cardH, it.length * rowH)
    const cy = box.y + Math.max(20 * u, (box.h - total) / 2)
    const a = appear(local, 0, 0.7)
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 25 * u)
    proGlass(ctx, cardX, cy, cardW, cardH, 18 * u)
    const sw = (k: number) => { const t0 = (1.5 + k * 0.3) * PD; return local < t0 ? 0 : local < t0 + 0.28 ? -1 : 1 }
    const cell = (k: number): [number, number, number, number] => k === 0 ? [cardX + pad2, cy + pad2, mosW * 2 / 3 - 3 * u, mosH] : [cardX + pad2 + mosW * 2 / 3 + 3 * u, cy + pad2 + (k - 1) * (mosH / 2 + 3 * u), mosW / 3 - 3 * u, mosH / 2 - 3 * u]
    for (let k = 0; k < 3; k++) {
      const st = sw(k), [x, y, w, h] = cell(k)
      const src = st === 1 ? after[k] : before[k]
      const img = get(src)
      const fade = st === -1 ? 1 - (local - (1.5 + k * 0.3) * PD) / 0.28 : st === 1 ? clamp((local - (1.5 + k * 0.3) * PD - 0.28) / 0.28) : 1
      ctx.save(); rr(ctx, x, y, w, h, 7 * u); ctx.clip(); ctx.fillStyle = C.deep; ctx.fillRect(x, y, w, h)
      ctx.globalAlpha *= clamp(fade); if (img) cover(ctx, img, x, y, w, h, 1.02); ctx.restore()
    }
    const isAfter = local >= 1.5 * PD
    const t2 = local >= 2.3 * PD
    const tt = t2 ? (head || 'Rebuilt title') : (sc.sub || 'Condo w/ Pool')
    ctx.save(); ctx.globalAlpha *= t2 ? clamp((local - 2.3 * PD) / 0.3) : 1
    const ts = fitSize(ctx, tt.replace(/\*\*/g, ''), mosW, 28 * u, titleH - 24 * u, 700, A.display, 1.2)
    rich(ctx, tt, cardX + pad2, cy + pad2 + mosH + 16 * u, mosW, ts, { font: A.display, weight: 700, local: 99, lh: 1.2, shadow: false })
    ctx.restore()
    // the BEFORE / AFTER pill, top-left above the card
    ctx.font = fnt(600, 20 * u, A.mono)
    const lab = isAfter ? 'AFTER' : 'BEFORE', lw = ctx.measureText(lab).width + 36 * u, lh = 40 * u
    rr(ctx, cardX + cardW * 0.04, cy - lh * 0.45, lw, lh, lh / 2); ctx.fillStyle = isAfter ? C.gold : '#2E4459'; ctx.fill()
    ctx.fillStyle = isAfter ? onAccent() : C.ink; ctx.textBaseline = 'middle'; ctx.fillText(lab, cardX + cardW * 0.04 + 18 * u, cy - lh * 0.45 + lh / 2 + 1)
    ctx.restore()
    const lx = portrait ? box.x : cardX + cardW + box.w * 0.06
    const ly = portrait ? cy + cardH + 60 * u : cy + (cardH - it.length * rowH) / 2
    for (let k = 0; k < it.length; k++) {
      const ok = local >= (1.7 + k * 0.45) * PD
      const y = ly + k * rowH
      ctx.save(); ctx.globalAlpha *= appear(local, 0.2, 0.5) * (ok ? 1 : 0.35)
      const bs = 34 * u
      rr(ctx, lx, y + (rowH - bs) / 2, bs, bs, 7 * u); ctx.lineWidth = 3 * u; ctx.strokeStyle = C.gold; ctx.stroke()
      if (ok) { ctx.fillStyle = C.gold; ctx.fill(); ctx.strokeStyle = onAccent(); ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(lx + 8 * u, y + rowH / 2); ctx.lineTo(lx + 14 * u, y + rowH / 2 + 7 * u); ctx.lineTo(lx + 26 * u, y + rowH / 2 - 7 * u); ctx.stroke() }
      const rs = fitLine(ctx, it[k], listW - bs - 22 * u, 31 * u, 500, A.body)
      plain(ctx, it[k], lx + bs + 22 * u, y + (rowH - rs * 1.06) / 2 - rs * 0.26, listW - bs - 22 * u, rs, A.body, C.ink, 500)
      ctx.restore()
    }
    return
  }

  // TILE GRID — Lighthouse: the name, a mono tag, and capability tiles that light up one by one.
  if (sc.kind === 'tilegrid') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = sc.items.slice(0, 12)
    const cols = portrait ? 2 : it.length <= 6 ? 3 : 4, rows = Math.ceil(it.length / cols) || 1
    const hs = (portrait ? 110 : 94) * u
    const thD = (portrait ? 210 : 175) * u, gD = box.w * 0.018
    const blockH = hs * 1.15 + 40 * u + rows * thD + (rows - 1) * gD
    let y = box.y + Math.max(0, (box.h - blockH) / 2)
    const hw = head ? (() => { ctx.font = fnt(800, hs, A.display); return layout(ctx, head, box.w)[0]?.w || 0 })() : 0
    if (head) rich(ctx, head, box.x, y, box.w, hs, { font: A.display, local, delay: 0, maxH: hs * 1.2 })
    const tag = eb || sc.sub
    if (tag) {
      if (portrait || hw > box.w * 0.6) eyebrow(ctx, tag, box.x, y + hs * 1.25 + 30 * u, 20 * u, A, appear(local, 0.4))
      else eyebrow(ctx, tag, box.x + hw + 36 * u, y + hs * 0.86, 20 * u, A, appear(local, 0.4))
    }
    y += hs * 1.15 + (portrait && tag ? 70 * u : 40 * u)
    const g = box.w * 0.018, cw = (box.w - g * (cols - 1)) / cols
    const th = Math.min(thD, (box.y + box.h - y - g * (rows - 1)) / rows)
    for (let k = 0; k < it.length; k++) {
      const x = box.x + (k % cols) * (cw + g), ty = y + Math.floor(k / cols) * (th + g)
      const on = appear(local, 0.5 + k * 0.26, 0.4)
      ctx.save(); ctx.globalAlpha *= appear(local, 0.1, 0.4) * (0.35 + 0.65 * on)
      proGlass(ctx, x, ty, cw, th, 18 * u, on, false)
      ctx.fillStyle = on > 0.5 ? C.gold : C.mut; ctx.fillRect(x + cw * 0.08, ty + th * 0.22, 36 * u, 4 * u)
      plain(ctx, it[k], x + cw * 0.08, ty + th * 0.22 + 26 * u, cw * 0.84, (portrait ? 30 : 27) * u, A.body, C.ink, 600)
      ctx.restore()
    }
    return
  }

  // LIVE FEED — Lighthouse at work: the title on the left, events sliding in on the right.
  // Rows: Title|detail|#colour (colour optional).
  if (sc.kind === 'livefeed') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = sc.items.slice(0, 6).map(r => r.split('|').map(s => s.trim()))
    const dots = ['#E07B5F', C.gold, '#4CC488', '#E0B44C', '#6E9BE0', '#B48CF0']
    const leftW = portrait ? box.w : box.w * 0.38
    let rowH = (portrait ? 116 : 96) * u
    const gap = (portrait ? 18 : 14) * u
    if (portrait) rowH = Math.min(rowH, (box.h * 0.6 - gap * (it.length - 1)) / Math.max(1, it.length))
    const listH = it.length * (rowH + gap) - gap
    let ly = box.y + (portrait ? 0 : (box.h - 280 * u) / 2)
    if (eb) { eyebrow(ctx, eb, box.x, ly + 22 * u, 21 * u, A, appear(local, 0)); ly += 46 * u }
    const hsz = (portrait ? 96 : 80) * u
    if (head) ly += rich(ctx, head, box.x, ly, leftW, fitHard(ctx, head, leftW, hsz), { font: A.display, local, delay: 0.05, stagger: 0.25, maxH: portrait ? box.h * 0.26 : box.h * 0.5 }) + 18 * u
    if (sc.sub) ly += plain(ctx, sc.sub, box.x, ly, leftW, 27 * u, A.body, C.mut, 500, 'left', appear(local, 0.4)) + 10 * u
    const fx = portrait ? box.x : box.x + leftW + box.w * 0.05, fw = portrait ? box.w : box.w - leftW - box.w * 0.05
    const fy = portrait ? ly + 40 * u : box.y + (box.h - listH) / 2
    for (let k = 0; k < it.length; k++) {
      const [t1, t2, col] = it[k]
      const a = appear(local, 0.4 + k * 0.75, 0.55); if (a <= 0) continue
      const y = fy + k * (rowH + gap)
      ctx.save(); ctx.globalAlpha *= a; ctx.translate((1 - a) * 54 * u, 0)
      proGlass(ctx, fx, y, fw, rowH, 18 * u)
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(col || '') ? col : dots[k % dots.length]; ctx.beginPath(); ctx.arc(fx + 36 * u, y + rowH / 2, 8 * u, 0, Math.PI * 2); ctx.fill()
      plain(ctx, t1 || '', fx + 66 * u, y + rowH * 0.18, fw - 160 * u, fitLine(ctx, t1 || '', fw - 160 * u, (portrait ? 30 : 27) * u, 600, A.body), A.body, C.ink, 600)
      plain(ctx, t2 || '', fx + 66 * u, y + rowH * 0.52, fw - 160 * u, fitLine(ctx, t2 || '', fw - 160 * u, (portrait ? 24 : 21) * u, 400, A.body), A.body, C.mut, 400)
      ctx.font = fnt(500, 17 * u, A.mono); ctx.fillStyle = C.mut; ctx.textBaseline = 'middle'; ctx.fillText('now', fx + fw - 62 * u, y + rowH / 2)
      ctx.restore()
    }
    return
  }

  // ROLES — "One complete team": the headline, then role tiles that light up, then a line under them.
  if (sc.kind === 'roles') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = sc.items.slice(0, 6)
    const cols = portrait ? 2 : Math.min(4, Math.max(1, it.length)), rows = Math.ceil(it.length / cols) || 1
    const hsz = (portrait ? 110 : 92) * u
    const hh = head ? linesH(ctx, head, box.w, fitSize(ctx, head, box.w, hsz, box.h * 0.3), A.display) : 0
    const g = box.w * 0.03, cw = (box.w - g * (cols - 1)) / cols, th = (portrait ? 150 : 120) * u
    const total = hh + 60 * u + rows * th + (rows - 1) * g + (sc.sub ? 90 * u : 0)
    let y = box.y + (box.h - total) / 2
    if (head) { rich(ctx, head, box.x, y, box.w, hsz, { font: A.display, local, delay: 0, align: 'center', maxH: box.h * 0.3 }); y += hh + 60 * u }
    for (let k = 0; k < it.length; k++) {
      const x = box.x + (k % cols) * (cw + g), ty = y + Math.floor(k / cols) * (th + g)
      const on = appear(local, 0.5 + k * 0.45, 0.5)
      ctx.save(); ctx.globalAlpha *= 0.35 + 0.65 * on
      proGlass(ctx, x, ty, cw, th, 18 * u, on, false)
      const s = fitSize(ctx, it[k], cw * 0.82, (portrait ? 40 : 38) * u, th * 0.7, 700, A.display, 1.15)
      const lh2 = linesH(ctx, it[k], cw * 0.82, s, A.display, 1.15)
      rich(ctx, it[k], x + cw * 0.09, ty + (th - lh2) / 2, cw * 0.82, s, { font: A.display, weight: 700, local: 99, lh: 1.15, shadow: false })
      ctx.restore()
    }
    y += rows * th + (rows - 1) * g + 40 * u
    if (sc.sub) plain(ctx, sc.sub, box.x, y, box.w, 27 * u, A.body, C.mut, 500, 'center', appear(local, 0.5 + it.length * 0.45 + 0.4))
    return
  }

  // CURVE — the results scene: headline + chips on the left, the dashed "before" line and the rising gold
  // line after the switch on the right. Sub = the marker label (default "Switch to Stay").
  if (sc.kind === 'curve') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const leftW = portrait ? box.w : box.w * 0.47
    const hsz = (portrait ? 104 : 86) * u
    const text = head || 'Owners who switch\n**earn more.**'
    const hs = fitSize(ctx, text, leftW, fitHard(ctx, text, leftW, hsz), portrait ? box.h * 0.28 : box.h * 0.5)
    const hh = linesH(ctx, text, leftW, hs)
    const chipsH = sc.items.length ? 110 * u : 0
    const ly = portrait ? box.y : box.y + (box.h - hh - chipsH) / 2
    rich(ctx, text, box.x, ly, leftW, hs, { font: A.display, local, delay: 0, stagger: 0.3 })
    if (sc.items.length) chipRow(ctx, sc.items.slice(0, 5), box.x, ly + hh + 40 * u, leftW, 20 * u, A, local, 1.2, 'left')
    const gx = portrait ? box.x : box.x + leftW + box.w * 0.03, gw = portrait ? box.w : box.w - leftW - box.w * 0.03
    const gh = Math.min(gw * 0.6, portrait ? box.h * 0.5 : box.h * 0.85)
    const gy = portrait ? box.y + box.h - gh : box.y + (box.h - gh) / 2
    const M = (x: number, y: number) => [gx + x / 300 * gw, gy + y / 180 * gh]
    ctx.save()
    ctx.strokeStyle = rgbaOf(C.mut, 0.5); ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(...(M(10, 170) as [number, number])); ctx.lineTo(...(M(290, 170) as [number, number])); ctx.stroke()
    // before: a flat dashed line
    ctx.setLineDash([9 * u, 11 * u]); ctx.strokeStyle = C.mut; ctx.lineWidth = 5 * u; ctx.beginPath()
    const seg1: number[][][] = [[[10, 140], [60, 138], [90, 132], [120, 128]], [[120, 128], [150, 124], [150, 122], [160, 118]]]
    seg1.forEach((s, j) => { for (let q = 0; q <= 20; q++) { const pt = cubicAt(s[0], s[1], s[2], s[3], q / 20); const m = M(pt[0], pt[1]); if (j === 0 && q === 0) ctx.moveTo(m[0], m[1]); else ctx.lineTo(m[0], m[1]) } })
    ctx.stroke(); ctx.setLineDash([])
    // the marker
    ctx.setLineDash([5 * u, 7 * u]); ctx.strokeStyle = rgbaOf(C.ink, 0.5); ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(...(M(160, 20) as [number, number])); ctx.lineTo(...(M(160, 170) as [number, number])); ctx.stroke(); ctx.setLineDash([])
    const mk = M(152, 14); ctx.font = fnt(500, 22 * u, A.body); ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(sc.sub || 'Switch to Stay', mk[0], mk[1]); ctx.textAlign = 'left'
    // after: the gold line draws itself (0.5 s in, 3.2 s ease-out)
    const pr = ease((local / PD - 0.5) / 3.2)
    if (pr > 0) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 8 * u; ctx.lineCap = 'round'; ctx.beginPath()
      const N = Math.max(1, Math.round(60 * pr))
      for (let q = 0; q <= N; q++) { const pt = cubicAt([160, 118], [200, 100], [230, 70], [290, 24], (q / 60)); const m = M(pt[0], pt[1]); if (q === 0) ctx.moveTo(m[0], m[1]); else ctx.lineTo(m[0], m[1]) }
      ctx.stroke()
    }
    const da = appear(local, 2.4, 0.5)
    if (da > 0) { const e = M(290, 24); ctx.globalAlpha *= da; ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(e[0], e[1], 11 * u, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
    return
  }

  // TRIAD — three photo cards that land with the words (4 %, 36 % and 66 % of the scene).
  // Photo 1 = background; photos 2–4 = the cards. Rows: Title|line.
  if (sc.kind === 'triad') {
    proBg(ctx, W, H, ph(0), local, lvl)
    const it = (sc.items.length ? sc.items : ['Priced daily|Dedicated revenue managers', '40+ channels|Everywhere guests book', 'One complete team|Housekeeping to guest care']).slice(0, 3).map(r => r.split('|').map(s => s.trim()))
    const n = it.length, at = [0.04, 0.36, 0.66]
    if (portrait) {
      const g = 34 * u, cw = box.w, rowH = (box.h - g * (n - 1)) / n
      for (let k = 0; k < n; k++) {
        const t0 = dur * at[k], a = ease((local - t0) / (0.6 * PD)); if (a <= 0) continue
        const y = box.y + k * (rowH + g), pw = cw * 0.48, phh = Math.min(rowH, pw * 0.75)
        ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 24 * u)
        rr(ctx, box.x, y, pw, phh, 22 * u); ctx.save(); ctx.clip(); const img = ph(k + 1); if (img) cover(ctx, img, box.x, y, pw, phh, 1.08 - 0.08 * ease((local - t0) / (6 * PD))); ctx.restore()
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; rr(ctx, box.x, y, pw, phh, 22 * u); ctx.stroke()
        const tx = box.x + pw + 34 * u, tw = cw - pw - 34 * u
        const ts = fitSize(ctx, it[k][0] || '', tw, 60 * u, phh * 0.55)
        const th2 = rich(ctx, (k === 0 ? '**' + (it[k][0] || '') + '**' : it[k][0] || ''), tx, y + phh * 0.2, tw, ts, { font: A.display, local: 99 })
        if (it[k][1]) plain(ctx, it[k][1], tx, y + phh * 0.2 + th2 + 10 * u, tw, 28 * u, A.body, C.mut, 500)
        ctx.restore()
      }
      return
    }
    const g = box.w * 0.035, cw = (box.w - g * (n - 1)) / n, phh = cw * 0.75
    const y = box.y + (box.h - phh - 150 * u) / 2
    for (let k = 0; k < n; k++) {
      const t0 = dur * at[k], a = ease((local - t0) / (0.6 * PD)); if (a <= 0) continue
      const x = box.x + k * (cw + g), z = 0.97 + 0.03 * a
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(0, (1 - a) * 24 * u)
      ctx.translate(x + cw / 2, y + phh / 2); ctx.scale(z, z); ctx.translate(-(x + cw / 2), -(y + phh / 2))
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 18 * u; rr(ctx, x, y, cw, phh, 22 * u); ctx.fillStyle = C.deep; ctx.fill(); ctx.restore()
      rr(ctx, x, y, cw, phh, 22 * u); ctx.save(); ctx.clip(); const img = ph(k + 1); if (img) cover(ctx, img, x, y, cw, phh, 1.08 - 0.08 * ease((local - t0) / (6 * PD))); ctx.restore()
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; rr(ctx, x, y, cw, phh, 22 * u); ctx.stroke()
      const ts = fitLine(ctx, it[k][0] || '', cw, 58 * u, 800, A.display)
      rich(ctx, (k === 0 ? '**' + (it[k][0] || '') + '**' : it[k][0] || ''), x, y + phh + 28 * u, cw * 1.5, ts, { font: A.display, local: 99 })
      if (it[k][1]) plain(ctx, it[k][1], x, y + phh + 40 * u + ts * 1.05, cw, fitLine(ctx, it[k][1], cw, 27 * u, 500, A.body), A.body, C.mut, 500)
      ctx.restore()
    }
    return
  }
}

/** Find the scene playing at time t. */
export function sceneAt(tl: Timeline, t: number): number {
  let i = 0
  for (let k = 0; k < tl.starts.length; k++) if (t >= tl.starts[k]) i = k
  return i
}

/** How scene i arrives. 'auto' varies it so an ad never uses the same move twice in a row. */
/** Jon, 2026-11-03: "we need transitions but make sure they are not crazy … make sure it makes sense".
 *  Auto picks from ONE family per ad, chosen by the look and pace: calm ads dissolve, normal ads mix a
 *  soft zoom and a push, lively ads cut faster. Special moves (iris, glitch, spin …) only when chosen. */
export function motionFamily(p: Pick<AdProject, 'look' | 'style'>): 'calm' | 'normal' | 'lively' {
  const pace = p.style?.pace || 'normal'
  if (pace === 'calm' || ['linen', 'sand', 'editorial', 'mono', 'golden', 'fresh', 'holiday', 'champagne'].indexOf(p.look || '') >= 0) return pace === 'fast' ? 'normal' : 'calm'
  if (pace === 'fast' || ['miami', 'bold', 'tropic', 'noir', 'festival'].indexOf(p.look || '') >= 0) return 'lively'
  return 'normal'
}
// CLEAN TRANSITIONS (Jon, 2026-11-03: "we need transitions but make sure they are not crazy"; 2026-11-04: "quality vs
// quantity"). Auto uses two moves per family and keeps them in rhythm: calm = dissolve and a soft blur; normal = a
// slow zoom-dissolve and a plain dissolve; lively = push and zoom. Whips, spins, glitches and blinds are only ever
// chosen by hand on a scene. End cards and the designs that make their own entrance always dissolve in.
export function transitionOf(p: AdProject, i: number): AdTransition {
  const t = p.scenes[i]?.tr || 'auto'
  if (t !== 'auto') return t
  const k = p.scenes[i].kind, fam = motionFamily(p)
  if (k === 'cta' || k === 'contact' || k === 'reveal' || k === 'mask' || k === 'poster') return 'fade'
  if (fam === 'calm') return (['fade', 'blur'] as AdTransition[])[i % 2]
  if (fam === 'lively') return (['push', 'zoom'] as AdTransition[])[i % 2]
  return (['zoom', 'fade'] as AdTransition[])[i % 2]
}
/** Film finish: a soft vignette and a fine moving grain, so it reads as footage, not slides. */
let grain: HTMLCanvasElement | null = null
function finish(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, t: number, kind: string = 'film') {
  if (kind === 'clean') return
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, C.light ? 'rgba(60,40,20,0.14)' : 'rgba(0,0,0,0.38)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
  if (kind === 'glow') {
    // a warm light leak drifting across the frame
    const lx = W * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.35))), ly = H * (0.1 + 0.15 * Math.cos(t * 0.5))
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.6)
    lg.addColorStop(0, 'rgba(255,170,90,0.32)'); lg.addColorStop(0.5, 'rgba(255,110,80,0.10)'); lg.addColorStop(1, 'rgba(255,110,80,0)')
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H); ctx.restore()
  }
  if (kind !== 'film') return
  if (typeof document === 'undefined') return
  if (!grain) {
    grain = document.createElement('canvas'); grain.width = grain.height = 192
    const g = grain.getContext('2d'); if (!g) return
    const d = g.createImageData(192, 192)
    for (let k = 0; k < d.data.length; k += 4) { const n = Math.random() * 255; d.data[k] = d.data[k + 1] = d.data[k + 2] = n; d.data[k + 3] = 18 }
    g.putImageData(d, 0, 0)
  }
  const pat = ctx.createPattern(grain, 'repeat'); if (!pat) return
  ctx.save(); ctx.translate(-((t * 977) % 192), -((t * 613) % 192)); ctx.fillStyle = pat; ctx.fillRect(0, 0, W + 192, H + 192); ctx.restore()
}

// ───────────────────────── MOTION GRAPHICS (Jon, 2026-11-03: "we need cool graphics") ─────────────────────────
export type FxMeta = {
  key: string; label: string; hint: string
  /** Placements this graphic can take (first = default). */
  pos?: string[]
  /** Colour schemes it can take (first = default). */
  colors?: string[]
  /** Design variants (first = default). */
  variants?: { key: string; label: string }[]
  /** Which sliders it has. */
  has: ('size' | 'amt' | 'speed' | 'blink')[]
}
export const FX_POS_LABEL: Record<string, string> = { full: 'Everywhere', top: 'Top', bottom: 'Bottom', both: 'Top & bottom', left: 'Left', right: 'Right', center: 'Centre', tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right', frame: 'Around the edge', behind: 'Behind the words' }
export const FX_COLOR_LABEL: Record<string, string> = { accent: 'Accent', white: 'White', multi: 'Multi', warm: 'Warm', cool: 'Cool', red: 'Red', green: 'Green', fall: 'Fall', ink: 'Ink', gold: 'Golds', xmas: 'Red & green', pastel: 'Pastel', ice: 'Ice', sunset: 'Sunset', neon: 'Neon' }
export const FX: FxMeta[] = [
  { key: 'bokeh', label: 'Bokeh', hint: 'Soft drifting light circles', pos: ['full', 'top', 'bottom', 'left', 'right'], colors: ['accent', 'white', 'warm', 'cool', 'gold', 'xmas', 'pastel'], has: ['size', 'amt', 'speed'] },
  { key: 'rays', label: 'Light rays', hint: 'Sun rays sweeping from a corner', pos: ['tr', 'tl', 'br', 'bl'], colors: ['accent', 'white', 'warm'], has: ['amt', 'speed'] },
  { key: 'sparkle', label: 'Sparkle', hint: 'Twinkles that catch the light', pos: ['full', 'top', 'bottom', 'left', 'right'], colors: ['white', 'accent', 'gold', 'ice', 'warm', 'cool'], has: ['size', 'amt', 'speed'] },
  { key: 'confetti', label: 'Confetti', hint: 'Falling confetti — events, celebrations', pos: ['full', 'left', 'right', 'top'], colors: ['accent', 'multi', 'gold', 'pastel', 'neon', 'white', 'warm'], has: ['size', 'amt', 'speed'] },
  { key: 'waves', label: 'Waves', hint: 'Animated wave lines', pos: ['bottom', 'top', 'both'], colors: ['accent', 'white', 'cool'], has: ['size', 'amt', 'speed'] },
  { key: 'grid', label: 'Tech grid', hint: 'A faint moving grid — Lighthouse, data, owners', colors: ['accent', 'white', 'cool'], has: ['size', 'amt', 'speed'] },
  { key: 'stripes', label: 'Stripes', hint: 'Diagonal accent stripes that slide in', pos: ['tr', 'tl', 'br', 'bl'], colors: ['accent', 'white', 'multi'], has: ['size', 'amt'] },
  { key: 'orb', label: 'Accent orb', hint: 'A big soft circle in the accent colour', pos: ['behind', 'center', 'left', 'right', 'tl', 'tr', 'bl', 'br'], colors: ['accent', 'white', 'warm', 'cool', 'red'], has: ['size'] },
  { key: 'corners', label: 'Corners', hint: 'Corner brackets, like a viewfinder', colors: ['accent', 'white', 'ink'], variants: [{ key: 'thin', label: 'Thin' }, { key: 'bold', label: 'Bold' }, { key: 'dots', label: 'Dots' }], has: ['size'] },
  { key: 'stars', label: '4.6 stars', hint: 'The guest rating as stars filling up', pos: ['bl', 'br', 'tl', 'tr', 'center'], has: ['size'] },
  { key: 'pin', label: 'Map pin', hint: 'A pin drops with the place line', pos: ['tr', 'tl', 'center', 'br', 'bl'], colors: ['accent', 'white', 'red'], has: ['size'] },
  { key: 'swipe', label: 'Book arrow', hint: 'A bouncing arrow toward the button (end cards)', pos: ['bottom', 'center', 'right'], colors: ['accent', 'white'], has: ['size', 'speed'] },
  { key: 'scan', label: 'Scanlines', hint: 'Fine horizontal lines — retro, techy', has: ['amt', 'speed'] },
  { key: 'glowline', label: 'Glow line', hint: 'A travelling accent line across the frame', variants: [{ key: 'slant', label: 'Slanted' }, { key: 'vert', label: 'Vertical' }, { key: 'horiz', label: 'Horizontal' }], colors: ['accent', 'white', 'cool'], has: ['size', 'speed'] },
  // Themed visuals (Jon, 2026-11-04: "visuals that fit the theme", "multiple options, features and placement").
  { key: 'snow', label: 'Snow', hint: 'Soft snowfall — Christmas, winter sun', pos: ['full', 'top', 'left', 'right'], colors: ['white', 'accent', 'cool'], has: ['size', 'amt', 'speed'] },
  { key: 'lights', label: 'String lights', hint: 'A string of warm bulbs — holidays', pos: ['top', 'bottom', 'both', 'frame'], variants: [{ key: 'swag', label: 'Swag' }, { key: 'straight', label: 'Straight' }, { key: 'zigzag', label: 'Zigzag' }, { key: 'double', label: 'Double swag' }], colors: ['multi', 'warm', 'xmas', 'gold', 'ice', 'pastel', 'accent', 'white', 'cool'], has: ['size', 'amt', 'speed', 'blink'] },
  { key: 'fireworks', label: 'Fireworks', hint: 'Bursts in the sky — New Year, the Fourth', pos: ['top', 'full', 'left', 'right', 'tl', 'tr'], colors: ['accent', 'multi', 'gold', 'neon', 'sunset', 'white', 'warm', 'red'], has: ['size', 'amt', 'speed'] },
  { key: 'hearts', label: 'Hearts', hint: 'Drifting hearts — Valentine’s', pos: ['full', 'left', 'right', 'bottom'], colors: ['accent', 'red', 'white', 'warm'], has: ['size', 'amt', 'speed'] },
  { key: 'leaves', label: 'Falling leaves', hint: 'Autumn leaves — Thanksgiving', pos: ['full', 'left', 'right', 'top'], colors: ['fall', 'accent', 'green', 'warm'], has: ['size', 'amt', 'speed'] },
  { key: 'eq', label: 'Equalizer', hint: 'Sound bars — Ultra, music week', pos: ['bottom', 'top', 'both', 'left', 'right'], colors: ['accent', 'neon', 'white', 'multi', 'cool', 'sunset'], variants: [{ key: 'bars', label: 'Bars' }, { key: 'wave', label: 'Wave' }, { key: 'dots', label: 'Dots' }], has: ['size', 'amt', 'speed'] },
  { key: 'rope', label: 'Nautical rope', hint: 'A rope line and an anchor — boat shows', pos: ['top', 'bottom', 'both', 'frame'], variants: [{ key: 'dash', label: 'Rope' }, { key: 'solid', label: 'Solid line' }, { key: 'anchor', label: 'Anchor only' }], colors: ['accent', 'white', 'red', 'ink'], has: ['size'] },
  { key: 'frame', label: 'Gallery frame', hint: 'A thin inner frame, like a gallery wall — Art Basel, editorial', variants: [{ key: 'double', label: 'Double line' }, { key: 'single', label: 'Single line' }, { key: 'thick', label: 'Thick mat' }, { key: 'corners', label: 'Corner marks' }], colors: ['white', 'accent', 'ink'], has: ['size'] },
  { key: 'tree', label: 'Christmas tree', hint: 'A tree silhouette with lights that blink', pos: ['br', 'bl', 'right', 'left', 'center'], variants: [{ key: 'classic', label: 'Classic' }, { key: 'slim', label: 'Slim' }, { key: 'outline', label: 'Outline' }, { key: 'pair', label: 'A pair' }], colors: ['multi', 'warm', 'xmas', 'gold', 'ice', 'accent', 'white'], has: ['size', 'speed', 'blink'] },
  { key: 'garland', label: 'Garland', hint: 'A pine garland with berries along an edge — Christmas', pos: ['top', 'bottom', 'both', 'frame'], colors: ['green', 'accent', 'red'], has: ['size'] },
  { key: 'balloons', label: 'Balloons', hint: 'Balloons drifting up — birthdays, openings, celebrations', pos: ['full', 'left', 'right', 'bottom'], colors: ['multi', 'pastel', 'gold', 'sunset', 'accent', 'white', 'warm'], has: ['size', 'amt', 'speed'] },
  { key: 'palms', label: 'Palm fronds', hint: 'Palm leaf silhouettes in the corners — Miami, tropical', pos: ['tr', 'tl', 'br', 'bl', 'both'], colors: ['green', 'ink', 'accent'], has: ['size'] },
  { key: 'badge', label: 'Date badge', hint: 'A round stamp with the date line (uses the scene’s date or sub line)', pos: ['tr', 'tl', 'br', 'bl', 'center'], colors: ['accent', 'white', 'red', 'ink'], variants: [{ key: 'circle', label: 'Circle' }, { key: 'ribbon', label: 'Ribbon' }, { key: 'burst', label: 'Starburst' }], has: ['size'] },
]
export function fxMeta(k: string) { return FX.find(f => f.key === k) }
/** Resolve a graphic's options with the graphic's defaults filled in. */
export function fxOpts(sc: AdScene | undefined, k: string): Required<FxOpts> {
  const m = fxMeta(k), o = (sc && sc.fxo && sc.fxo[k]) || {}
  return {
    pos: o.pos && (!m?.pos || m.pos.indexOf(o.pos) >= 0) ? o.pos : (m?.pos?.[0] || 'full'),
    size: o.size || 'M', amt: o.amt || 'med', speed: o.speed || 'normal',
    color: o.color && (!m?.colors || m.colors.indexOf(o.color) >= 0) ? o.color : (m?.colors?.[0] || 'accent'),
    variant: o.variant && (!m?.variants || m.variants.some(v => v.key === o.variant)) ? o.variant : (m?.variants?.[0]?.key || ''),
    blink: o.blink || 'on',
  }
}
const pad = (W: number, H: number, u: number) => (H > W * 1.1 ? 80 : 120) * u
function hashN(n: number, k: number) { const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v) }
const SIZE_MUL = { S: 0.65, M: 1, L: 1.5 }, AMT_MUL = { low: 0.5, med: 1, high: 1.8 }, SPD_MUL = { slow: 0.5, normal: 1, fast: 1.8 }
/** Colour palette for an FX colour scheme. */
function fxPalette(scheme: string): string[] {
  switch (scheme) {
    case 'white': return ['#FFFFFF']
    case 'multi': return [C.gold, '#F26D6D', '#6FCF97', '#F2C94C', '#56CCF2']
    case 'warm': return ['#F2C94C', '#F26D6D', '#E08A3C', '#FFD9A0']
    case 'cool': return ['#56CCF2', '#7CF2E0', '#B9D4E6', '#8FA8FF']
    case 'red': return ['#D64545', '#F26D6D', '#B3202C']
    case 'green': return ['#2E6B45', '#3F8F5C', '#1E4D31']
    case 'fall': return ['#C9792E', '#B5562E', '#D9A441', '#8A4B2A']
    case 'gold': return ['#D2B077', '#F3D9A0', '#B08D57', '#FFF1C9']
    case 'xmas': return ['#D64545', '#2E8B57', '#F2C94C', '#FFFFFF']
    case 'pastel': return ['#FFC8DD', '#BDE0FE', '#CDB4DB', '#FFE5B4', '#C7F9CC']
    case 'ice': return ['#FFFFFF', '#CFEFFF', '#9FD8FF', '#E6F7FF']
    case 'sunset': return ['#FF7A59', '#FFB37A', '#FF5FA2', '#F2C94C']
    case 'neon': return ['#C8FF3D', '#FF5FA2', '#4FF0D0', '#7B61FF']
    case 'ink': return [C.light ? C.ink : '#FFFFFF']
    default: return [C.gold]
  }
}
/** The screen region a placement means, as a rect. */
function fxRegion(pos: string, W: number, H: number): { x: number; y: number; w: number; h: number } {
  switch (pos) {
    case 'top': return { x: 0, y: 0, w: W, h: H * 0.42 }
    case 'bottom': return { x: 0, y: H * 0.58, w: W, h: H * 0.42 }
    case 'left': return { x: 0, y: 0, w: W * 0.42, h: H }
    case 'right': return { x: W * 0.58, y: 0, w: W * 0.42, h: H }
    case 'center': return { x: W * 0.25, y: H * 0.25, w: W * 0.5, h: H * 0.5 }
    case 'tl': return { x: 0, y: 0, w: W * 0.5, h: H * 0.5 }
    case 'tr': return { x: W * 0.5, y: 0, w: W * 0.5, h: H * 0.5 }
    case 'bl': return { x: 0, y: H * 0.5, w: W * 0.5, h: H * 0.5 }
    case 'br': return { x: W * 0.5, y: H * 0.5, w: W * 0.5, h: H * 0.5 }
    default: return { x: 0, y: 0, w: W, h: H }
  }
}
/** Anchor point for a corner/edge placement, inset by m. */
function fxAnchor(pos: string, W: number, H: number, m: number): { x: number; y: number; sx: number; sy: number } {
  const sx = pos === 'tl' || pos === 'bl' || pos === 'left' ? 1 : pos === 'center' ? 0 : -1
  const sy = pos === 'tl' || pos === 'tr' || pos === 'top' ? 1 : pos === 'center' ? 0 : -1
  const x = sx > 0 ? m : sx < 0 ? W - m : W / 2, y = sy > 0 ? m : sy < 0 ? H - m : H / 2
  return { x, y, sx, sy }
}
let fxOff: HTMLCanvasElement | null = null
/** Graphics ease in over the first half-second of a scene and out over the last, so they never pop (Jon, 2026-11-04: "good transitions, better flows"). */
function fxEnvelope(local: number, dur: number) {
  const inA = Math.min(1, Math.max(0, local / 0.45)), outA = dur > 1.2 ? Math.min(1, Math.max(0, (dur - local) / 0.45)) : 1
  return ease(Math.min(inA, outA))
}
function drawFx(ctx0: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets) {
  const sc = p.scenes[i]
  const keys = Array.from(new Set([...(sc.fx || []), ...(sc.fx && sc.fx.length ? [] : FXS)]))
  if (!keys.length) return
  const W = ctx0.canvas.width, H = ctx0.canvas.height, u0 = Math.min(W, H) / 1080
  const env = fxEnvelope(local, dur)
  // Posters carry a CTA bar along the bottom — bottom-edge graphics sit above it.
  const barInset = sc.kind === 'poster' ? (H > W * 1.1 ? 118 : 104) * u0 + 24 * u0 : 0
  let ctx = ctx0
  if (env < 0.995 && typeof document !== 'undefined') {
    if (!fxOff || fxOff.width !== W || fxOff.height !== H) { fxOff = document.createElement('canvas'); fxOff.width = W; fxOff.height = H }
    const oc = fxOff.getContext('2d'); if (oc) { oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalAlpha = 1; oc.globalCompositeOperation = 'source-over'; oc.clearRect(0, 0, W, H); ctx = oc }
  }
  const portrait = H > W * 1.1
  const PF = platformOf(p)
  const safeB = H * PF.safe.bottom, safeT = H * PF.safe.top
  for (const k of keys) {
    const o = fxOpts(sc, k)
    const u = u0 * SIZE_MUL[o.size], amt = AMT_MUL[o.amt], t = local * SPD_MUL[o.speed]
    const pal = fxPalette(o.color), col = pal[0], crgb = hexRgb(col)
    const ca = (a: number, idx = 0) => { const r = hexRgb(pal[idx % pal.length]); return `rgba(${r[0]},${r[1]},${r[2]},${a})` }
    const R = fxRegion(o.pos, W, H)
    const inR = (hx: number, hy: number) => ({ x: R.x + hx * R.w, y: R.y + hy * R.h })
    ctx.save()
    if (k === 'bokeh') {
      ctx.globalCompositeOperation = C.light ? 'multiply' : 'screen'
      const N = Math.round(18 * amt)
      for (let n = 0; n < N; n++) {
        const r = (30 + 90 * hashN(n, 1)) * u, q = inR(hashN(n, 2) + 0.03 * Math.sin(t * 0.4 + n), ((hashN(n, 3) - t * 0.012 * (0.5 + hashN(n, 4))) % 1 + 1) % 1)
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r); g.addColorStop(0, C.light ? 'rgba(200,170,120,0.35)' : ca(0.26, n)); g.addColorStop(0.7, C.light ? 'rgba(200,170,120,0.12)' : ca(0.08, n)); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2)
      }
    } else if (k === 'rays') {
      ctx.globalCompositeOperation = 'screen'
      const an = fxAnchor(o.pos, W, H, 0); ctx.translate(an.x + (an.sx > 0 ? -W * 0.05 : W * 0.05) * -1 * an.sx, an.y - an.sy * H * 0.05)
      const base = an.sx > 0 ? (an.sy > 0 ? 0 : -Math.PI / 2) : (an.sy > 0 ? Math.PI / 2 : Math.PI)
      const N = Math.round(7 * amt)
      for (let n = 0; n < N; n++) {
        const ang = base + Math.PI * 0.05 + (n / Math.max(1, N - 1)) * Math.PI * 0.4 + 0.03 * Math.sin(t * 0.6 + n)
        const g = ctx.createLinearGradient(0, 0, Math.cos(ang) * W * 1.4, Math.sin(ang) * W * 1.4)
        g.addColorStop(0, ca(0.18 + 0.06 * Math.sin(t + n))); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang - 0.03) * W * 1.6, Math.sin(ang - 0.03) * W * 1.6); ctx.lineTo(Math.cos(ang + 0.03) * W * 1.6, Math.sin(ang + 0.03) * W * 1.6); ctx.closePath(); ctx.fill()
      }
    } else if (k === 'sparkle') {
      ctx.globalCompositeOperation = 'screen'
      const N = Math.round(26 * amt)
      for (let n = 0; n < N; n++) {
        const ph = (t * (0.6 + hashN(n, 5)) + hashN(n, 6) * 6) % 3, a = ph < 1 ? Math.sin(ph * Math.PI) : 0
        if (a <= 0) continue
        const q = inR(hashN(n, 7), hashN(n, 8)), r = (6 + 10 * hashN(n, 9)) * u * a
        ctx.fillStyle = C.light && o.color === 'white' ? `rgba(${hexRgb(C.gold).join(',')},${0.9 * a})` : ca(0.9 * a, n)
        ctx.beginPath(); ctx.moveTo(q.x, q.y - r * 2); ctx.quadraticCurveTo(q.x, q.y, q.x + r * 2, q.y); ctx.quadraticCurveTo(q.x, q.y, q.x, q.y + r * 2); ctx.quadraticCurveTo(q.x, q.y, q.x - r * 2, q.y); ctx.quadraticCurveTo(q.x, q.y, q.x, q.y - r * 2); ctx.fill()
      }
    } else if (k === 'confetti') {
      const N = Math.round(40 * amt)
      for (let n = 0; n < N; n++) {
        const sp = 0.08 + 0.1 * hashN(n, 10), y = R.y + ((hashN(n, 11) + t * sp) % 1.1) * R.h - R.h * 0.05, x = R.x + hashN(n, 12) * R.w + Math.sin(t * 2 + n) * 20 * u
        const w = (8 + 10 * hashN(n, 13)) * u, h = (14 + 10 * hashN(n, 14)) * u
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + hashN(n, 15)) + n); ctx.fillStyle = pal.length === 1 && n % 3 === 0 ? (C.light ? C.ink : '#fff') : pal[n % pal.length]; ctx.globalAlpha = 0.85; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore()
      }
    } else if (k === 'waves') {
      ctx.lineWidth = 3 * u
      const N = Math.max(1, Math.round(3 * amt))
      const edges = o.pos === 'both' ? ['bottom', 'top'] : [o.pos]
      for (const e of edges) for (let n = 0; n < N; n++) {
        ctx.strokeStyle = ca(Math.max(0.15, 0.55 - n * 0.12), n); ctx.beginPath()
        const base = e === 'top' ? safeT + (90 + n * 34) * u : H - (90 + n * 34) * u - safeB
        for (let x = 0; x <= W; x += 12 * u0) ctx.lineTo(x, base + Math.sin(x / (140 * u) + t * (1.2 + n * 0.3) + n) * 14 * u)
        ctx.stroke()
      }
    } else if (k === 'grid') {
      ctx.strokeStyle = C.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 * u0
      const step = 96 * u, off = (t * 18 * u0) % step
      ctx.beginPath()
      for (let x = -step + off; x < W + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = -step + off * 0.6; y < H + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
      ctx.stroke()
      ctx.fillStyle = ca(0.5)
      const N = Math.round(5 * amt)
      for (let n = 0; n < N; n++) { const x = ((hashN(n, 16) + t * 0.02) % 1) * W, y = hashN(n, 17) * H; ctx.beginPath(); ctx.arc(Math.round(x / step) * step + off, Math.round(y / step) * step + off * 0.6, 4 * u0, 0, Math.PI * 2); ctx.fill() }
    } else if (k === 'stripes') {
      const a = ease(Math.min(1, t / 0.8)), an = fxAnchor(o.pos, W, H, 0)
      ctx.translate(an.x, an.y); ctx.rotate(an.sx * an.sy > 0 ? -0.6 : 0.6)
      const N = Math.max(1, Math.round(3 * amt))
      for (let n = 0; n < N; n++) { ctx.fillStyle = pal.length === 1 && n === 1 ? (C.light ? C.ink : '#fff') : pal[n % pal.length]; ctx.globalAlpha = Math.max(0.3, 0.85 - n * 0.2); ctx.fillRect(-(60 + n * 70) * u * (an.sx < 0 ? 1 : -1) - (an.sx < 0 ? 0 : 26 * u), -H * 0.5 + (1 - a) * H * 1.5 * (an.sy > 0 ? -1 : 1), 26 * u, H * 2) }
    } else if (k === 'orb') {
      const a = ease(Math.min(1, t / 0.9)), r = (portrait ? W * 0.42 : H * 0.38) * (0.8 + 0.2 * a) * SIZE_MUL[o.size]
      let x = portrait ? W * 0.5 : W * 0.3, y = portrait ? H * 0.38 : H * 0.5
      if (o.pos !== 'behind') { const q = inR(0.5, 0.5); x = q.x; y = q.y }
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, ca(0.55 * a)); g.addColorStop(1, ca(0))
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
    } else if (k === 'corners') {
      const a = ease(Math.min(1, t / 0.7)), m = 60 * u0 + (1 - a) * 40 * u0, L = 70 * u * a
      ctx.strokeStyle = o.color === 'accent' && C.light ? C.ink : col; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = (o.variant === 'bold' ? 10 : 4) * u; ctx.globalAlpha = 0.9
      const top = safeT + m, bot = H - safeB - m, right = W - W * PF.safe.right - m
      for (const [x, y, sx, sy] of [[m, top, 1, 1], [right, top, -1, 1], [m, bot, 1, -1], [right, bot, -1, -1]] as number[][]) {
        if (o.variant === 'dots') { ctx.beginPath(); ctx.arc(x + sx * 10 * u, y + sy * 10 * u, 9 * u * a, 0, Math.PI * 2); ctx.fill() }
        else { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke() }
      }
    } else if (k === 'stars') {
      const a = ease(Math.min(1, (t - 0.3) / 1.2)), n = 4.6 * a, size = 44 * u
      const rowW = 5 * (size + 10 * u) + 10 * u + 300 * u
      const an = fxAnchor(o.pos, W, H, 56 * u0)
      const x0 = an.sx < 0 ? W - 56 * u0 - rowW : an.sx === 0 ? W / 2 - rowW / 2 : 56 * u0
      const y0 = an.sy > 0 ? safeT + 120 * u0 : an.sy === 0 ? H / 2 : H - safeB - (p.captions ? 250 : 140) * u0
      for (let s = 0; s < 5; s++) {
        const fill = Math.max(0, Math.min(1, n - s))
        const cx = x0 + s * (size + 10 * u) + size / 2, cy = y0
        const star = () => { ctx.beginPath(); for (let q = 0; q < 10; q++) { const r = q % 2 ? size * 0.22 : size * 0.5, an2 = -Math.PI / 2 + q * Math.PI / 5; ctx.lineTo(cx + Math.cos(an2) * r, cy + Math.sin(an2) * r) } ctx.closePath() }
        star(); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill()
        if (fill > 0) { ctx.save(); ctx.beginPath(); ctx.rect(cx - size / 2, cy - size / 2, size * fill, size); ctx.clip(); star(); ctx.fillStyle = C.gold; ctx.fill(); ctx.restore() }
      }
      if (a > 0.9) { ctx.font = fnt(700, 30 * u, A.body); ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText('4.6 / 5 from our guests', x0 + 5 * (size + 10 * u) + 10 * u, y0 + 2 * u) }
    } else if (k === 'pin') {
      const a = ease(Math.min(1, (t - 0.2) / 0.7))
      const an = fxAnchor(o.pos, W, H, 170 * u0)
      const x = an.sx === 0 ? W / 2 : an.sx > 0 ? 170 * u0 : W - W * PF.safe.right - 170 * u0
      const y = (an.sy === 0 ? H * 0.42 : an.sy > 0 ? safeT + 150 * u0 : H - safeB - 260 * u0) - (1 - a) * 200 * u0
      ctx.globalAlpha = a
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 22 * u, Math.PI, 0); ctx.lineTo(x, y + 38 * u); ctx.closePath(); ctx.fill()
      ctx.fillStyle = C.navy; ctx.beginPath(); ctx.arc(x, y, 9 * u, 0, Math.PI * 2); ctx.fill()
      const ring = ((t * 1.2) % 1); ctx.strokeStyle = ca(0.6 * (1 - ring)); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.ellipse(x, y + 42 * u, 30 * u * (0.4 + ring), 12 * u * (0.4 + ring), 0, 0, Math.PI * 2); ctx.stroke()
      const label = (sc.sub || '').replace(/\*\*/g, '').split('·')[0].trim()
      if (label) { ctx.font = fnt(700, 26 * u, A.body); const tw = ctx.measureText(label).width; rr(ctx, x - tw / 2 - 16 * u, y + 56 * u, tw + 32 * u, 44 * u, 22 * u); ctx.fillStyle = C.light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)'; ctx.fill(); ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, x - tw / 2, y + 78 * u) }
    } else if (k === 'swipe') {
      const b = Math.abs(Math.sin(t * 3)) * 16 * u
      const x = o.pos === 'right' ? W - W * PF.safe.right - 120 * u0 : W / 2, y = (o.pos === 'center' ? H * 0.55 : H - safeB - (p.captions ? 300 : 190) * u0) + b
      ctx.strokeStyle = col; ctx.lineWidth = 8 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(x, y - 70 * u); ctx.lineTo(x, y); ctx.moveTo(x - 28 * u, y - 30 * u); ctx.lineTo(x, y); ctx.lineTo(x + 28 * u, y - 30 * u); ctx.stroke()
    } else if (k === 'scan') {
      ctx.fillStyle = C.light ? 'rgba(0,0,0,0.06)' : `rgba(0,0,0,${0.1 + 0.1 * amt})`
      const step = (6 / Math.sqrt(amt)) * u0, off = (t * 40 * u0) % step
      for (let y = -step + off; y < H; y += step) ctx.fillRect(0, y, W, 2 * u0)
    } else if (k === 'glowline') {
      const ph = (t * 0.35) % 1
      ctx.globalCompositeOperation = 'screen'
      const wdt = 400 * u
      if (o.variant === 'horiz') {
        const y = ph * (H + wdt) - wdt / 2
        const g = ctx.createLinearGradient(0, y - wdt / 2, 0, y + wdt / 2); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, ca(0.35)); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(0, y - wdt / 2, W, wdt)
      } else {
        const x = ph * (W + wdt) - wdt / 2
        const g = ctx.createLinearGradient(x - wdt / 2, 0, x + wdt / 2, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, ca(0.35)); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.save(); if (o.variant !== 'vert') ctx.transform(1, 0, -0.3, 1, 0, 0); ctx.fillRect(x - wdt / 2, 0, wdt, H); ctx.restore()
      }
    } else if (k === 'snow') {
      ctx.globalCompositeOperation = C.light ? 'source-over' : 'screen'
      const N = Math.round(90 * amt)
      for (let n = 0; n < N; n++) {
        const sp = 0.03 + 0.05 * hashN(n, 11), r = (2 + 5 * hashN(n, 12)) * u
        const q = inR((hashN(n, 13) + 0.02 * Math.sin(t * 0.8 + n)) % 1, (((hashN(n, 14) + t * sp) % 1) + 1) % 1)
        ctx.fillStyle = C.light ? 'rgba(120,130,150,0.35)' : ca(0.5 + 0.4 * hashN(n, 15), n)
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill()
      }
    } else if (k === 'lights') {
      const blink = o.blink !== 'off'
      const drawString = (y0: number, flip: boolean) => {
        const n = Math.max(4, Math.round((portrait ? 9 : 14) * amt))
        const sag = o.variant === 'straight' ? 0 : 40 * u
        const yAt = (f: number) => {
          if (o.variant === 'zigzag') return y0 + (f * n % 2 < 1 ? 0 : sag * 0.8) * (flip ? -1 : 1)
          if (o.variant === 'double') return y0 + sag * Math.abs(Math.sin(f * Math.PI * 2)) * (flip ? -1 : 1)
          return y0 + sag * Math.sin(f * Math.PI) * (flip ? -1 : 1)
        }
        ctx.strokeStyle = C.light ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3 * u0; ctx.beginPath()
        for (let i2 = 0; i2 <= n * 4; i2++) { const f = i2 / (n * 4), x = f * W; if (i2 === 0) ctx.moveTo(x, yAt(f)); else ctx.lineTo(x, yAt(f)) }
        ctx.stroke()
        for (let i2 = 0; i2 <= n; i2++) {
          const f = i2 / n, x = f * W, y = yAt(f) + (flip ? -22 : 22) * u
          const on = blink ? 0.55 + 0.45 * Math.sin(t * 2 + i2 * 1.3) : 1
          const c2 = pal[i2 % pal.length]
          ctx.save(); ctx.globalCompositeOperation = 'screen'
          const g = ctx.createRadialGradient(x, y, 0, x, y, 46 * u); g.addColorStop(0, c2); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 * on; ctx.fillStyle = g; ctx.fillRect(x - 46 * u, y - 46 * u, 92 * u, 92 * u)
          ctx.restore()
          ctx.fillStyle = c2; ctx.globalAlpha = 0.7 + 0.3 * on; ctx.beginPath(); ctx.ellipse(x, y, 7 * u, 11 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
          ctx.fillStyle = 'rgba(40,40,40,0.9)'; ctx.fillRect(x - 4 * u, y + (flip ? 10 : -18) * u, 8 * u, 8 * u)
        }
      }
      const topY = Math.max(70 * u0, H * 0.06), botY = H - Math.max(70 * u0, H * 0.06) - safeB - barInset
      if (o.pos === 'top' || o.pos === 'both' || o.pos === 'frame') drawString(topY, false)
      if (o.pos === 'bottom' || o.pos === 'both' || o.pos === 'frame') drawString(botY, true)
      if (o.pos === 'frame') {
        // bulbs down the sides too
        const n = Math.max(3, Math.round((portrait ? 10 : 6) * amt))
        for (const side of [0, 1]) for (let i2 = 1; i2 < n; i2++) {
          const y = topY + (i2 / n) * (botY - topY), x = side ? W - Math.max(60 * u0, W * 0.05) : Math.max(60 * u0, W * 0.05)
          const on = blink ? 0.55 + 0.45 * Math.sin(t * 2 + i2 * 1.7 + side) : 1, c2 = pal[(i2 + side) % pal.length]
          ctx.save(); ctx.globalCompositeOperation = 'screen'; const g = ctx.createRadialGradient(x, y, 0, x, y, 46 * u); g.addColorStop(0, c2); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.5 * on; ctx.fillStyle = g; ctx.fillRect(x - 46 * u, y - 46 * u, 92 * u, 92 * u); ctx.restore()
          ctx.fillStyle = c2; ctx.globalAlpha = 0.7 + 0.3 * on; ctx.beginPath(); ctx.ellipse(x, y, 7 * u, 11 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
        }
      }
    } else if (k === 'fireworks') {
      ctx.globalCompositeOperation = 'screen'
      const N = Math.round(5 * amt)
      for (let n = 0; n < N; n++) {
        const period = 2.2 + hashN(n, 21), ph = ((t + hashN(n, 22) * period) % period) / period
        if (ph > 0.85) continue
        const q = inR(0.12 + 0.76 * hashN(n, 23), o.pos === 'full' ? 0.1 + 0.6 * hashN(n, 24) : 0.15 + 0.7 * hashN(n, 24))
        const Rr = (120 + 160 * hashN(n, 25)) * u * ease(ph / 0.8), fade = 1 - ph / 0.85
        const c2 = pal.length === 1 ? (n % 2 ? col : '#FFFFFF') : pal[n % pal.length]
        for (let k2 = 0; k2 < 26; k2++) {
          const ang = (k2 / 26) * Math.PI * 2, x = q.x + Math.cos(ang) * Rr, y = q.y + Math.sin(ang) * Rr + ph * 60 * u
          ctx.strokeStyle = c2; ctx.globalAlpha = 0.9 * fade; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(q.x + Math.cos(ang) * Rr * 0.7, q.y + Math.sin(ang) * Rr * 0.7 + ph * 40 * u); ctx.lineTo(x, y); ctx.stroke()
          ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(x, y, 4 * u, 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    } else if (k === 'hearts') {
      ctx.globalCompositeOperation = C.light ? 'multiply' : 'screen'
      const N = Math.round(16 * amt)
      for (let n = 0; n < N; n++) {
        const sz = (14 + 26 * hashN(n, 31)) * u, q = inR(hashN(n, 32) + 0.03 * Math.sin(t + n), (((hashN(n, 33) - t * (0.02 + 0.03 * hashN(n, 34))) % 1) + 1) % 1)
        ctx.fillStyle = ca(0.35 + 0.3 * hashN(n, 35), n)
        ctx.beginPath(); ctx.moveTo(q.x, q.y + sz * 0.9); ctx.bezierCurveTo(q.x - sz * 1.2, q.y, q.x - sz * 0.5, q.y - sz * 0.8, q.x, q.y - sz * 0.2); ctx.bezierCurveTo(q.x + sz * 0.5, q.y - sz * 0.8, q.x + sz * 1.2, q.y, q.x, q.y + sz * 0.9); ctx.fill()
      }
    } else if (k === 'leaves') {
      const N = Math.round(22 * amt)
      for (let n = 0; n < N; n++) {
        const sz = (12 + 18 * hashN(n, 41)) * u, q = inR((hashN(n, 42) + t * 0.015 + 0.03 * Math.sin(t * 0.9 + n)) % 1, (((hashN(n, 43) + t * (0.03 + 0.03 * hashN(n, 44))) % 1) + 1) % 1)
        ctx.fillStyle = pal[n % pal.length]; ctx.globalAlpha = 0.85
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(t * (0.8 + hashN(n, 45)) + n); ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1
      }
    } else if (k === 'eq') {
      ctx.globalCompositeOperation = 'screen'
      const vertical = o.pos === 'left' || o.pos === 'right'
      const n = Math.max(8, Math.round((vertical ? (portrait ? 40 : 24) : (portrait ? 28 : 48)) * amt))
      const edges = o.pos === 'both' ? ['bottom', 'top'] : [o.pos]
      for (const e of edges) {
        const L = vertical ? H : W, bw = L / n
        for (let i2 = 0; i2 < n; i2++) {
          const lv = 0.15 + 0.85 * Math.abs(Math.sin(t * 3.1 + i2 * 0.7) * Math.sin(t * 1.3 + i2 * 0.21))
          const h = lv * (vertical ? W : H) * (portrait ? 0.14 : 0.2) * SIZE_MUL[o.size]
          ctx.fillStyle = ca(0.55, i2)
          if (o.variant === 'dots') {
            const steps = Math.max(1, Math.round(h / (14 * u0)))
            for (let s = 0; s < steps; s++) {
              const d = s * 14 * u0 + 7 * u0
              if (vertical) ctx.fillRect(e === 'right' ? W - d - 5 * u0 : d, i2 * bw + bw * 0.25, 5 * u0, bw * 0.5)
              else ctx.fillRect(i2 * bw + bw * 0.25, e === 'top' ? safeT + d : H - safeB * 0 - Math.max(20 * u0, H * 0.02) - d - 5 * u0, bw * 0.5, 5 * u0)
            }
          } else if (o.variant === 'wave') {
            if (i2 === 0) { ctx.strokeStyle = ca(0.7); ctx.lineWidth = 4 * u0; ctx.beginPath() }
            const a = i2 * bw + bw / 2
            if (vertical) { const x = e === 'right' ? W - h - 10 * u0 : h + 10 * u0; if (i2 === 0) ctx.moveTo(x, a); else ctx.lineTo(x, a) }
            else { const y = e === 'top' ? safeT + h + 10 * u0 : H - Math.max(20 * u0, H * 0.02) - h; if (i2 === 0) ctx.moveTo(a, y); else ctx.lineTo(a, y) }
            if (i2 === n - 1) ctx.stroke()
          } else {
            if (vertical) ctx.fillRect(e === 'right' ? W - h : 0, i2 * bw + bw * 0.2, h, bw * 0.6)
            else ctx.fillRect(i2 * bw + bw * 0.2, e === 'top' ? safeT : H - Math.max(20 * u0, H * 0.02) - h, bw * 0.6, h)
          }
        }
      }
    } else if (k === 'rope') {
      const P = pad(W, H, u0), lw = 4 * u
      ctx.strokeStyle = col; ctx.lineWidth = lw
      const line = (y: number, x0: number, x1: number) => { if (o.variant === 'dash') { ctx.setLineDash([18 * u, 10 * u]); ctx.lineDashOffset = -t * 40 * u } ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]) }
      const anchor = (ax: number, ay: number) => {
        const r = 22 * u
        ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.arc(ax, ay - r * 0.9, r * 0.35, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(ax, ay - r * 0.55); ctx.lineTo(ax, ay + r); ctx.moveTo(ax - r * 0.7, ay - r * 0.1); ctx.lineTo(ax + r * 0.7, ay - r * 0.1); ctx.stroke()
        ctx.beginPath(); ctx.arc(ax, ay + r * 0.1, r * 0.95, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke()
      }
      const yT = P + 38 * u0, yB = H - P - 38 * u0 - safeB - barInset
      if (o.variant !== 'anchor') {
        if (o.pos === 'top' || o.pos === 'both' || o.pos === 'frame') line(yT, P, W - P - (o.pos === 'top' ? 230 * u0 : 0))
        if (o.pos === 'bottom' || o.pos === 'both' || o.pos === 'frame') line(yB, P, W - P)
        if (o.pos === 'frame') { ctx.save(); ctx.translate(P, 0); ctx.rotate(Math.PI / 2); line(0, yT, yB); ctx.restore(); ctx.save(); ctx.translate(W - P, 0); ctx.rotate(Math.PI / 2); line(0, yT, yB); ctx.restore() }
      }
      if (o.pos === 'top' || o.variant === 'anchor') anchor(W - P - 40 * u0, yT + 150 * u)
      else if (o.pos === 'bottom') anchor(P + 40 * u0, yB - 150 * u)
    } else if (k === 'tree') {
      const blink = o.blink !== 'off'
      const drawTree = (bx: number, by: number, th: number) => {
        const slim = o.variant === 'slim' ? 0.72 : 1
        ctx.save(); ctx.translate(bx, by)
        const fill = C.light ? 'rgba(20,60,40,0.9)' : 'rgba(6,28,18,0.95)'
        for (let tier = 0; tier < 3; tier++) {
          const w = th * (0.62 - tier * 0.15) * slim, y = -th * (0.18 + tier * 0.3)
          ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.lineTo(0, y - th * 0.34); ctx.closePath()
          if (o.variant === 'outline') { ctx.strokeStyle = pal.length === 1 ? col : C.gold; ctx.lineWidth = 3 * u0; ctx.stroke() } else { ctx.fillStyle = fill; ctx.fill() }
        }
        ctx.fillStyle = '#5A3A1E'; ctx.fillRect(-th * 0.05, -th * 0.18, th * 0.1, th * 0.18)
        for (let n = 0; n < 22; n++) {
          const tier = n % 3, w = th * (0.6 - tier * 0.15) * slim, fy = -th * (0.2 + tier * 0.3) - hashN(n, 51) * th * 0.28
          const fx2 = (hashN(n, 52) - 0.5) * w * (1 - (fy + th * (0.2 + tier * 0.3)) / (-th * 0.3) * 0.9)
          const on = blink ? (Math.sin(t * 3 + n * 2.1) > 0.1 ? 1 : 0.25) : 1
          const c2 = pal[n % pal.length]
          ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.6 * on
          const g = ctx.createRadialGradient(fx2, fy, 0, fx2, fy, 22 * u0); g.addColorStop(0, c2); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(fx2 - 22 * u0, fy - 22 * u0, 44 * u0, 44 * u0); ctx.restore()
          ctx.fillStyle = c2; ctx.globalAlpha = 0.6 + 0.4 * on; ctx.beginPath(); ctx.arc(fx2, fy, 5 * u0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
        }
        ctx.fillStyle = C.gold; ctx.save(); ctx.translate(0, -th * 1.14); ctx.beginPath(); for (let i2 = 0; i2 < 10; i2++) { const r = i2 % 2 ? 9 * u0 : 20 * u0, a = -Math.PI / 2 + i2 * Math.PI / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) } ctx.closePath(); ctx.fill(); ctx.restore()
        ctx.restore()
      }
      const th = (portrait ? H * 0.26 : H * 0.42) * SIZE_MUL[o.size]
      const by = H - Math.max(40 * u0, H * 0.04) - (sc.kind === 'poster' ? (portrait ? 118 : 104) * u0 : 0) - safeB
      const P = pad(W, H, u0)
      const xr = W - P - th * 0.4, xl = P + th * 0.4
      if (o.variant === 'pair') { drawTree(xl, by, th * 0.9); drawTree(xr, by, th) }
      else if (o.pos === 'bl' || o.pos === 'left') drawTree(xl, by, th)
      else if (o.pos === 'center') drawTree(W / 2, by, th)
      else drawTree(xr, by, th)
    } else if (k === 'frame') {
      const m = Math.max(40 * u0, Math.min(W, H) * 0.045) * SIZE_MUL[o.size]
      const main = o.color === 'white' ? (C.light ? 'rgba(20,20,20,0.7)' : 'rgba(255,255,255,0.75)') : col
      if (o.variant === 'thick') {
        ctx.fillStyle = o.color === 'white' ? (C.light ? '#FFFFFF' : 'rgba(255,255,255,0.92)') : col
        ctx.fillRect(0, 0, W, m); ctx.fillRect(0, H - m, W, m); ctx.fillRect(0, 0, m, H); ctx.fillRect(W - m, 0, m, H)
        ctx.strokeStyle = ca(0.9); ctx.lineWidth = 1.5 * u0; ctx.strokeRect(m + 8 * u0, m + 8 * u0, W - m * 2 - 16 * u0, H - m * 2 - 16 * u0)
      } else if (o.variant === 'corners') {
        ctx.strokeStyle = main; ctx.lineWidth = 3 * u0; const L = Math.min(W, H) * 0.08
        for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as number[][]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke() }
      } else {
        ctx.strokeStyle = main; ctx.lineWidth = 3 * u0
        ctx.strokeRect(m, m, W - m * 2, H - m * 2)
        if (o.variant !== 'single') { ctx.strokeStyle = o.color === 'white' ? `rgba(${hexRgb(C.gold).join(',')},0.9)` : ca(0.9); ctx.lineWidth = 1.5 * u0; ctx.strokeRect(m + 10 * u0, m + 10 * u0, W - m * 2 - 20 * u0, H - m * 2 - 20 * u0) }
      }
    } else if (k === 'garland') {
      const green = o.color === 'green' ? ['#1E4D31', '#2E6B45', '#3F8F5C'] : pal
      const berry = o.color === 'red' ? C.gold : '#D64545'
      const strand = (y0: number, flip: boolean) => {
        const n = Math.round(W / (26 * u))
        for (let i2 = 0; i2 <= n; i2++) {
          const f = i2 / n, x = f * W, y = y0 + 26 * u * Math.sin(f * Math.PI) * (flip ? -1 : 1)
          for (let s = 0; s < 5; s++) {
            const a = (s / 5) * Math.PI * 2 + hashN(i2, 61) * 2, L = (14 + 10 * hashN(i2 + s, 62)) * u
            ctx.strokeStyle = green[(i2 + s) % green.length]; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke()
          }
          if (i2 % 4 === 0) { ctx.fillStyle = berry; ctx.beginPath(); ctx.arc(x + 4 * u, y + 2 * u, 5 * u, 0, Math.PI * 2); ctx.fill() }
        }
      }
      const topY = Math.max(50 * u0, H * 0.045), botY = H - Math.max(50 * u0, H * 0.045) - safeB - barInset
      if (o.pos === 'top' || o.pos === 'both' || o.pos === 'frame') strand(topY, false)
      if (o.pos === 'bottom' || o.pos === 'both' || o.pos === 'frame') strand(botY, true)
      if (o.pos === 'frame') { ctx.save(); ctx.translate(Math.max(50 * u0, W * 0.045), 0); ctx.rotate(Math.PI / 2); strand(0, true); ctx.restore(); ctx.save(); ctx.translate(W - Math.max(50 * u0, W * 0.045), 0); ctx.rotate(Math.PI / 2); strand(0, false); ctx.restore() }
    } else if (k === 'balloons') {
      const N = Math.round(10 * amt)
      for (let n = 0; n < N; n++) {
        const sz = (26 + 22 * hashN(n, 71)) * u, q = inR(hashN(n, 72) + 0.02 * Math.sin(t * 0.7 + n), (((hashN(n, 73) - t * (0.03 + 0.03 * hashN(n, 74))) % 1) + 1) % 1)
        const c2 = pal[n % pal.length]
        ctx.strokeStyle = C.light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5 * u0; ctx.beginPath(); ctx.moveTo(q.x, q.y + sz * 1.15); ctx.quadraticCurveTo(q.x + 8 * u, q.y + sz * 1.9, q.x - 4 * u, q.y + sz * 2.6); ctx.stroke()
        ctx.fillStyle = c2; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(q.x, q.y, sz * 0.85, sz, 0, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.moveTo(q.x - 5 * u, q.y + sz * 1.15); ctx.lineTo(q.x + 5 * u, q.y + sz * 1.15); ctx.lineTo(q.x, q.y + sz * 0.98); ctx.closePath(); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(q.x - sz * 0.3, q.y - sz * 0.35, sz * 0.18, sz * 0.3, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
      }
    } else if (k === 'palms') {
      // A palm crown: five fronds fanning from the corner, each a rib with tapered leaflets, swaying gently.
      const frond = (ax: number, ay: number, dir: number, up: number) => {
        const L = Math.min(W, H) * 0.48 * SIZE_MUL[o.size]
        ctx.strokeStyle = o.color === 'green' ? (C.light ? 'rgba(30,77,49,0.85)' : 'rgba(16,52,34,0.92)') : o.color === 'ink' ? (C.light ? 'rgba(11,31,58,0.85)' : 'rgba(0,0,0,0.75)') : ca(0.85)
        ctx.lineCap = 'round'
        for (let f = 0; f < 5; f++) {
          const base = 0.1 + f * 0.33 + 0.025 * Math.sin(t * 0.8 + f * 1.3)
          // dir>0 = left corner, up>0 = top corner; fronds fan into the frame
          const ang = dir > 0 ? (up > 0 ? base : -base) : (up > 0 ? Math.PI - base : Math.PI + base)
          ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang)
          ctx.fillStyle = ctx.strokeStyle
          // rib
          ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.55, -L * 0.05, L, L * 0.1); ctx.stroke()
          // leaflets: filled blades sweeping back toward the tip, on both sides of the rib
          const n = 13
          for (let s2 = 1; s2 <= n; s2++) {
            const g = s2 / n, px = g * L, py = -L * 0.05 * 4 * g * (1 - g) + L * 0.1 * g * g
            const len = L * 0.26 * Math.sin(Math.min(1, g * 1.1) * Math.PI) + L * 0.04, wdt = len * 0.16
            for (const side of [-1, 1]) {
              const tipX = px + len * 0.55, tipY = py + side * len * 0.85
              ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + len * 0.1 - wdt * 0.6, py + side * len * 0.45, tipX, tipY); ctx.quadraticCurveTo(px + len * 0.35 + wdt * 0.6, py + side * len * 0.35, px + wdt * 0.5, py); ctx.closePath(); ctx.fill()
            }
          }
          ctx.restore()
        }
      }
      const corners = o.pos === 'both' ? ['tl', 'tr'] : [o.pos]
      for (const c of corners) {
        const an = fxAnchor(c, W, H, -Math.min(W, H) * 0.04)
        // fronds point in toward the frame from the corner
        frond(an.x, an.y, an.sx > 0 ? 1 : -1, an.sy > 0 ? 1 : -1)
      }
    } else if (k === 'badge') {
      const text = ((sc.kind === 'poster' ? sc.items[0] : '') || (sc.sub || '')).replace(/\*\*/g, '').split('·')[0].trim().slice(0, 28)
      if (text) {
        const r = Math.min(W, H) * 0.11 * SIZE_MUL[o.size]
        const an = fxAnchor(o.pos, W, H, r + Math.max(40 * u0, Math.min(W, H) * 0.05))
        const y = an.sy > 0 ? an.y + safeT : an.sy < 0 ? an.y - safeB : an.y
        const a = ease(Math.min(1, (local - 0.1) / 0.5)), x = an.x
        const bg = o.color === 'white' ? '#FFFFFF' : o.color === 'ink' ? (C.light ? C.ink : '#111') : col
        const fg = o.color === 'white' || (o.color === 'accent' && lumOf(col) > 150) ? C.navy : '#FFFFFF'
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.12); ctx.scale(a, a)
        ctx.fillStyle = bg
        if (o.variant === 'burst') { ctx.beginPath(); for (let i2 = 0; i2 < 32; i2++) { const rr2 = i2 % 2 ? r * 0.86 : r, ang = i2 * Math.PI / 16; ctx.lineTo(Math.cos(ang) * rr2, Math.sin(ang) * rr2) } ctx.closePath(); ctx.fill() }
        else if (o.variant === 'ribbon') { rr(ctx, -r * 1.4, -r * 0.42, r * 2.8, r * 0.84, r * 0.12); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-r * 1.4, r * 0.3, r * 2.8, r * 0.12) }
        else { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = fg; ctx.globalAlpha = 0.5; ctx.lineWidth = 2 * u0; ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1 }
        ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const words = text.split(/\s+/), lines: string[] = []
        for (const w2 of words) { const last = lines[lines.length - 1]; if (last && (last + ' ' + w2).length <= 11) lines[lines.length - 1] = last + ' ' + w2; else lines.push(w2) }
        const maxW = o.variant === 'ribbon' ? r * 2.5 : r * 1.5
        let fs = Math.min(r * 0.42, (maxW / Math.max(...lines.map(l => l.length))) * 1.9); if (o.variant === 'ribbon') fs = Math.min(r * 0.5, fs * 1.4)
        if (o.variant === 'ribbon') { ctx.font = fnt(800, fs, A.display); ctx.fillText(lines.join(' '), 0, 0, maxW) }
        else { ctx.font = fnt(800, fs, A.display); lines.slice(0, 3).forEach((l, li, arr) => ctx.fillText(l, 0, (li - (arr.length - 1) / 2) * fs * 1.1, maxW)) }
        ctx.restore()
      }
    }
    ctx.restore()
  }
  if (ctx !== ctx0) { ctx0.save(); ctx0.globalAlpha = env; ctx0.drawImage(fxOff as HTMLCanvasElement, 0, 0); ctx0.restore() }
}
function drawSceneFx(ctx: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets) {
  const cu = p.scenes[i]?.cu
  if (!cu || !hasCustom(p.scenes[i])) { drawScene(ctx, p, i, local, dur, A); drawFx(ctx, p, i, local, dur, A); return }
  // THIS SCENE'S OWN STYLING: the look's settings are swapped for the scene and put back after it.
  const keep = { C, FS, FONTW, DISPLAY, GRADE, DUO, WASH }
  try {
    if (isHex(cu.accent)) C = { ...C, gold: cu.accent! }
    if (isHex(cu.text)) C = { ...C, ink: cu.text!, mut: cu.text! }
    if (cu.font) {
      const fam = cu.font === 'serif' ? A.serif : cu.font === 'condensed' ? A.condensed : cu.font === 'elegant' ? A.elegant : (BASE_SANS || A.display)
      if (fam) { A = { ...A, display: fam }; DISPLAY = fam; FONTW = cu.font === 'condensed' ? 400 : 0; FS = cu.font === 'elegant' ? 1.2 : 1 }
    }
    if (cu.size) FS *= (CU_SIZE.find(x => x.key === cu.size)?.k || 1)
    if (cu.shade === 'none') { WASH = 'none'; C = { ...C, tint: C.light ? '255,255,255' : '0,0,0' } }
    else if (cu.shade === 'light') SHADE = 0.5
    else if (cu.shade === 'dark') SHADE = 1.5
    if (cu.grade) { GRADE = GRADES[cu.grade] || ''; DUO = null }
    FOCX = cu.fx || 0; FOCY = cu.fy || 0; PZOOM = cu.zoom && cu.zoom > 1 ? cu.zoom : 1
    drawScene(ctx, p, i, local, dur, A)
    drawFx(ctx, p, i, local, dur, A)
  } finally {
    C = keep.C; FS = keep.FS; FONTW = keep.FONTW; DISPLAY = keep.DISPLAY; GRADE = keep.GRADE; DUO = keep.DUO; WASH = keep.WASH
    SHADE = 1; FOCX = 0; FOCY = 0; PZOOM = 1
  }
}

/** The whole frame at time t: scene (with a crossfade from the previous one), the mark, captions. */
const _qr = new Map<string, boolean[][]>()
/** A QR code's modules as a grid of booleans (cached per link). */
export function qrModules(text: string): boolean[][] {
  const hit = _qr.get(text); if (hit) return hit
  const q = qrcode(0, 'M'); q.addData(text); q.make()
  const n = q.getModuleCount(), g: boolean[][] = []
  for (let r = 0; r < n; r++) { const row: boolean[] = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); g.push(row) }
  if (_qr.size > 50) _qr.clear()
  _qr.set(text, g); return g
}
function drawQrCode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const g = qrModules(text), n = g.length, m = size / n
  ctx.fillStyle = '#14110B'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (g[r][c]) ctx.fillRect(Math.floor(x + c * m), Math.floor(y + r * m), Math.ceil(m), Math.ceil(m))
}

export function drawFrame(ctx: CanvasRenderingContext2D, p: AdProject, tl: Timeline, t: number, A: AdAssets) {
  // SIGNATURE (2026-11-12): the premium look has its own layouts, motion and finish (lib/ad-signature).
  if (p.look === 'signature') return drawSignatureFrame(ctx, p, tl, t, A)
  const W = ctx.canvas.width, H = ctx.canvas.height
  const u = Math.min(W, H) / 1080
  C = (LOOKS.find(l => l.key === p.look) || LOOKS[0]).c
  const R = resolveStyle(p)
  const fam = R.font === 'serif' ? A.serif : R.font === 'condensed' ? A.condensed : R.font === 'elegant' ? A.elegant : A.display
  BASE_SANS = A.display
  // A gallery-mat poster is a light page whatever the look: the mark goes black on it (unless the logo is off).
  const sc0 = p.scenes[sceneAt(tl, t)]
  const galleryPage = !!sc0 && sc0.kind === 'poster' && !C.light && ((sc0.items[2] || '').trim() === 'gallery')
  const logoKey = R.logo === 'off' ? 'off' : galleryPage ? 'black' : R.logo
  const logoImgKey = logoKey === 'accent' || (R.logoTint && logoKey !== 'off') ? 'white' : logoKey
  A = { ...A, display: fam || A.display, logo: logoKey === 'off' ? null : (A.logos && A.logos[logoImgKey as 'gold' | 'black' | 'white']) || (logoImgKey === 'gold' ? A.logo : null) }
  // CUSTOM COLOURS on top of the look (Jon, 2026-11-03: "colour options, not just theme changes").
  if (isHex(R.accent)) C = { ...C, gold: R.accent! }
  if (isHex(R.base)) {
    const b = R.base!, lt = lumOf(b) > 150, [r, g, bb] = hexRgb(b)
    C = { ...C, light: lt, navy: b, navy2: shade(b, lt ? 8 : 18), deep: shade(b, lt ? -14 : -12), tint: `${r},${g},${bb}`, glass: `rgba(${r},${g},${bb},${lt ? 0.86 : 0.62})`, line: lt ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.2)', ink: lt ? '#151515' : '#F5F2EC', mut: lt ? '#555049' : '#B8BEC6' }
    if ((p.style?.logo || 'auto') === 'auto') A = { ...A, logo: A.logos ? (lt ? A.logos.black : (A.logos.white || A.logo)) : A.logo }
  }
  // the mark's colour and its seasonal dress (a gallery-mat page keeps a plain black mark)
  LOGO_TINT = galleryPage ? '' : logoKey === 'accent' ? C.gold : (R.logoTint && !(isHex(R.base) && (p.style?.logo || 'auto') === 'auto') ? R.logoTint : '')
  DRESS = R.dress
  if (isHex(R.text)) C = { ...C, ink: R.text!, mut: R.text! }
  DISPLAY = A.display; FONTW = R.font === 'condensed' && fam ? 400 : 0; FS = R.font === 'elegant' && fam ? 1.2 : 1
  GRADE = GRADES[R.grade] || ''
  WASH = R.wash
  if (WASH !== 'look') C = { ...C, tint: C.light ? '255,255,255' : '0,0,0' }
  DUO = R.grade === 'duotone' ? [shade(C.navy, -10), C.gold] : R.grade === 'golden' ? ['#2A1A08', '#F2C879'] : R.grade === 'noir' ? ['#050505', '#E8E2D6'] : null
  FXS = (LOOKS.find(l => l.key === p.look) || LOOKS[0]).c.def?.fx || []
  PD = R.pace === 'calm' ? 1.35 : R.pace === 'fast' ? 0.72 : 1; CAPS = R.caps
  ctx.save()
  ctx.imageSmoothingEnabled = true; try { (ctx as any).imageSmoothingQuality = 'high' } catch { /* */ }
  ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H)
  if (!p.scenes.length) { ctx.restore(); return }
  const i = sceneAt(tl, t)
  const local = t - tl.starts[i]
  const tr = transitionOf(p, i)
  const scIn = p.scenes[i]
  // How long the hand-over runs: the transition's own pace, the ad's pace, the length picked for it — and never
  // more than 60% of either scene, so a short scene is never all transition.
  const XB = tr === 'push' || tr === 'slide' || tr === 'wipe' || tr === 'iris' || tr === 'doors' || tr === 'diamond' || tr === 'blinds' || tr === 'split' ? 0.65
    : tr === 'dip' || tr === 'dipwhite' ? 0.8 : tr === 'leak' ? 0.9 : tr === 'crosszoom' ? 0.6 : tr === 'whip' || tr === 'glitch' ? 0.4 : tr === 'cut' ? 0 : XFADE
  const XF = i > 0 ? Math.min(XB * PD * TR_LEN[scIn?.trs || 'normal'], tl.durs[i] * 0.6, tl.durs[i - 1] * 0.6) : 0
  if (i > 0 && XF > 0 && local < XF) {
    const q = local / XF, a = ease(q)
    // Movements ease in AND out, the way an editor's push does — not a slam that slows down.
    const m = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2
    // Where the new scene comes FROM (push / slide / whip / wipe).
    const from: TrDir = scIn?.trd || (tr === 'slide' ? 'down' : tr === 'wipe' ? 'left' : 'right')
    const fx = from === 'right' ? 1 : from === 'left' ? -1 : 0, fy = from === 'down' ? 1 : from === 'up' ? -1 : 0
    const blurF = (px: number) => { if (px > 0.5) try { ctx.filter = `blur(${Math.round(px * u)}px)` } catch { /* */ } }
    const zoomAt = (z: number) => { ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2) }
    const outgoing = () => drawSceneFx(ctx, p, i - 1, tl.durs[i - 1] + local, tl.durs[i - 1], A)
    const incoming = () => drawSceneFx(ctx, p, i, local, tl.durs[i], A)
    if (tr === 'split') {
      // the new scene underneath, the old one parting top and bottom
      incoming()
      for (const half of [0, 1]) {
        ctx.save(); ctx.translate(0, (half ? 1 : -1) * (H / 2) * m)
        ctx.beginPath(); ctx.rect(0, half ? H / 2 : 0, W, H / 2); ctx.clip()
        outgoing(); ctx.restore()
      }
      ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.35 * (1 - m)})`; ctx.fillRect(0, H / 2 - (H / 2) * m, W, H * m); ctx.restore()
    } else {
      // the outgoing scene: it moves, zooms or blurs for the transitions that carry it off
      ctx.save()
      if (tr === 'push' || tr === 'whip') { ctx.translate(-fx * W * m, -fy * H * m); if (tr === 'whip') blurF(m * 40) }
      else if (tr === 'crosszoom') { zoomAt(1 + 1.1 * q); blurF(q * 34) }
      else if (tr === 'blur') blurF(a * 24)
      outgoing()
      ctx.restore()
      if (tr === 'slide') { ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.4 * m})`; ctx.fillRect(0, 0, W, H); ctx.restore() }
      ctx.save()
      if (tr === 'fade' || tr === 'leak') ctx.globalAlpha = a
      else if (tr === 'zoom') { ctx.globalAlpha = Math.min(1, a * 1.4); zoomAt(1.08 - 0.08 * a) }
      else if (tr === 'crosszoom') { const k = clamp((q - 0.3) / 0.4); ctx.globalAlpha = k * k * (3 - 2 * k); zoomAt(1 + 1.1 * (1 - q)); blurF((1 - q) * 34) }
      else if (tr === 'push' || tr === 'slide' || tr === 'whip') { ctx.translate(fx * W * (1 - m), fy * H * (1 - m)); if (tr === 'whip') blurF((1 - m) * 40) }
      else if (tr === 'wipe') {
        const SX = H * 0.6, SY = W * 0.4
        ctx.beginPath()
        if (fy === 0) { const e = a * (W + SX), X = (x: number) => (fx < 0 ? x : W - x); ctx.moveTo(X(0), 0); ctx.lineTo(X(e), 0); ctx.lineTo(X(e - SX), H); ctx.lineTo(X(0), H) }
        else { const e = a * (H + SY), Y = (y: number) => (fy < 0 ? y : H - y); ctx.moveTo(0, Y(0)); ctx.lineTo(0, Y(e)); ctx.lineTo(W, Y(e - SY)); ctx.lineTo(W, Y(0)) }
        ctx.closePath(); ctx.clip()
      }
      else if (tr === 'flash' || tr === 'glitch' || tr === 'dip' || tr === 'dipwhite') ctx.globalAlpha = q > 0.5 ? 1 : 0
      else if (tr === 'iris') { ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.52 * a + 1, 0, Math.PI * 2); ctx.clip() }
      else if (tr === 'diamond') { const r = (W + H) * 0.55 * a; ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - r); ctx.lineTo(W / 2 + r, H / 2); ctx.lineTo(W / 2, H / 2 + r); ctx.lineTo(W / 2 - r, H / 2); ctx.closePath(); ctx.clip() }
      else if (tr === 'doors') { ctx.beginPath(); ctx.rect(W / 2 - W / 2 * a, 0, W * a, H); ctx.clip() }
      else if (tr === 'blinds') { const n = 9, bh = H / n; ctx.beginPath(); for (let k = 0; k < n; k++) ctx.rect(0, k * bh, W, bh * clamp(a * 1.4 - k * 0.04)); ctx.clip() }
      else if (tr === 'spin') { ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.rotate((1 - a) * -0.35); const z = 0.55 + 0.45 * a; ctx.scale(z, z); ctx.translate(-W / 2, -H / 2) }
      else if (tr === 'blur') { ctx.globalAlpha = a; blurF((1 - a) * 24) }
      if (tr === 'slide') { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 50 * u }
      incoming()
      ctx.restore()
    }
    // overlays on the cut: no accent-coloured edges — a clean edit reads as film, not a slideshow
    if (tr === 'dip' || tr === 'dipwhite') { const k = 1 - Math.abs(2 * q - 1); ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.15); ctx.fillStyle = tr === 'dip' ? '#000000' : '#FFFFFF'; ctx.fillRect(0, 0, W, H); ctx.restore() }
    if (tr === 'leak') {
      const pk = Math.sin(Math.PI * q), cx = W * (-0.25 + 1.5 * q), cy = H * (0.25 + 0.2 * q), R0 = Math.max(W, H) * 0.85
      ctx.save(); ctx.globalCompositeOperation = 'screen'
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0)
      g.addColorStop(0, `rgba(255,214,150,${0.9 * pk})`); g.addColorStop(0.35, `rgba(255,140,70,${0.55 * pk})`); g.addColorStop(0.7, `rgba(220,60,40,${0.18 * pk})`); g.addColorStop(1, 'rgba(200,40,30,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore()
    }
    if (tr === 'glitch') {
      if (q > 0.1 && q < 0.9) {
        const seed = Math.floor(t * 30)
        for (let k = 0; k < 9; k++) {
          const rnd = (n: number) => { const v = Math.sin((seed + 1) * 12.9898 + (k + 1) * 78.233 + n * 37.719) * 43758.5453; return v - Math.floor(v) }
          const sy = rnd(1) * H, sh = (0.02 + rnd(2) * 0.06) * H, dx = (rnd(3) - 0.5) * W * 0.12
          ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh)
        }
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.16; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, H * ((seed % 7) / 7), W, H * 0.05); ctx.restore()
      }
    }
    if (tr === 'flash') { ctx.fillStyle = `rgba(255,255,255,${1 - Math.abs(2 * q - 1)})`; ctx.fillRect(0, 0, W, H) }
  } else drawSceneFx(ctx, p, i, local, tl.durs[i], A)
  ctx.globalAlpha = 1
  // FRAME: a thin inset border in the accent, or letterbox bars on every scene.
  if (R.frame === 'border') { ctx.save(); ctx.strokeStyle = C.light ? C.ink : C.gold; ctx.globalAlpha = 0.85; ctx.lineWidth = 3 * u; ctx.strokeRect(28 * u, 28 * u, W - 56 * u, H - 56 * u); ctx.restore() }
  if (R.frame === 'letterbox' && p.scenes[i].kind !== 'cinema') { const bar = (H > W ? H * 0.07 : H * 0.09); ctx.fillStyle = C.light ? C.navy2 : '#000'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar) }
  finish(ctx, W, H, u, t, R.finish)
  const sc = p.scenes[i]
  // BADGE: an optional sticker on the scene (e.g. "Oceanfront", "Book direct").
  if (sc.badge && sc.badge.trim() && sc.kind !== 'contact') {
    const ba = appear(local, 0.5, 0.45)
    if (ba > 0) {
      const txt = sc.badge.trim().toUpperCase().slice(0, 22)
      ctx.save(); ctx.font = fnt(800, 30 * u, A.body)
      const tw = ctx.measureText(txt).width, bw = tw + 56 * u, bh = 64 * u
      const bx = 56 * u, by = Math.max((H > W * 1.1 ? 130 : 56) * u, H * platformOf(p).safe.top + 24 * u)
      ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(-0.07); const z = 0.6 + 0.4 * ba + 0.08 * Math.sin(ba * Math.PI); ctx.scale(z, z); ctx.globalAlpha *= ba
      rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fillStyle = C.gold; ctx.fill()
      ctx.setLineDash([6 * u, 6 * u]); ctx.lineWidth = 2 * u; ctx.strokeStyle = onAccent(); rr(ctx, -bw / 2 + 7 * u, -bh / 2 + 7 * u, bw - 14 * u, bh - 14 * u, (bh - 14 * u) / 2); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(txt, -tw / 2, 2 * u)
      ctx.restore()
    }
  }
  // QR: a white tile with the code and a line under it. On an end card it sits centred low; anywhere
  // else in the corner opposite the badge, clear of the platform's safe zones and the captions.
  if (sc.qr && sc.qr.trim()) {
    const qa = appear(local, 0.6, 0.45)
    if (qa > 0) {
      const portrait = H > W * 1.1, PFq = platformOf(p)
      const end = sc.kind === 'cta' || sc.kind === 'contact'
      const S = Math.min(W, H) * (end && portrait ? 0.34 : 0.22)
      const label = (sc.qrLabel || 'Scan to try it free').toUpperCase().slice(0, 34)
      // A quiet zone of about four modules round the code, so phone cameras read it.
      const padT = S * 0.13, lh = 54 * u, tw = S + padT * 2, th = S + padT * 2 + lh
      const capH = p.captions ? (portrait ? 250 : 150) * u : 0
      const x = end && portrait ? (W - tw) / 2 : W - tw - Math.max(56 * u, W * PFq.safe.right + 24 * u)
      const y = H - th - Math.max(56 * u, H * PFq.safe.bottom + 24 * u) - (end && portrait ? 0 : capH)
      ctx.save(); ctx.globalAlpha *= qa
      ctx.translate(x + tw / 2, y + th / 2); const z = 0.85 + 0.15 * qa; ctx.scale(z, z); ctx.translate(-(x + tw / 2), -(y + th / 2))
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30 * u
      rr(ctx, x, y, tw, th, 22 * u); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.shadowBlur = 0
      drawQrCode(ctx, sc.qr.trim(), x + padT, y + padT, S)
      ctx.font = fnt(800, 24 * u, A.body); ctx.fillStyle = '#14110B'; ctx.textBaseline = 'middle'
      const lw0 = ctx.measureText(label).width
      ctx.fillText(label, x + (tw - Math.min(lw0, tw - 20 * u)) / 2, y + padT + S + lh / 2, tw - 20 * u)
      ctx.restore()
    }
  }
  if (A.logo && sc.kind !== 'contact' && sc.kind !== 'cta') {
    const lw = 150 * u, lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
    const PF2 = platformOf(p)
    drawMark(ctx, A.logo, W - lw - Math.max(56 * u, W * PF2.safe.right + 20 * u), Math.max(46 * u, H * PF2.safe.top + 20 * u) + (DRESS === 'lights' || DRESS === 'xmas' ? 10 * u : 0), lw, lh, t)
  }
  // CAPTIONS: the line being spoken (most viewers watch muted). Shown while the line plays.
  // Captions — unless the screen already says the same words (a kinetic hook, a title that IS the line).
  const bare = (x: string) => x.replace(/\*\*/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
  const endCardV = H > W * 1.1 && (sc.kind === 'contact' || sc.kind === 'cta')
  if (p.captions && !endCardV && sc.vo.trim() && bare(sc.vo) !== bare(sc.head)) {
    const a = clamp(local / 0.3) * clamp((tl.durs[i] - local) / 0.3)
    if (a > 0) {
      const capBase = H - 60 * u - H * platformOf(p).safe.bottom
      const g = ctx.createLinearGradient(0, capBase - 170 * u, 0, H)
      g.addColorStop(0, C.light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)'); g.addColorStop(1, C.light ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.6)')
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, H - 230 * u, W, 230 * u)
      const size = (H > W * 1.1 ? 40 : 34) * u
      ctx.font = fnt(500, size, A.body)
      const lines = layout(ctx, captionText(sc.vo), W * 0.76)
      const shown = lines.slice(0, 3)
      for (let k = 0; k < shown.length; k++) {
        const s = shown[k].words.map(w => w.t.trim()).join(' ')
        const w = ctx.measureText(s).width
        ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.shadowColor = C.light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u
        ctx.fillText(s, (W - w) / 2, capBase - (shown.length - 1 - k) * size * 1.3)
      }
      ctx.restore()
    }
  }
  ctx.restore()
}

/** Ask the AI to write: what we send it about the house, so every script starts from the same facts. */
export const HOUSE_FACTS = `Stay Hospitality: short-term rental management across South Florida — 4 markets (Miami, Fort Lauderdale, Pompano, Palm Beach). Listings are rebuilt and refreshed every 3 months.
450+ listings across 140+ properties (hotels are part of the listings — say "listings", never "homes" for the count). 10 years in business. 1,000,000+ guests hosted. 4.6/5 guest rating.
Revenue: dedicated revenue managers price every listing every day against the competitive set; high-demand dates (Art Basel, New Year's Eve, the boat shows, Formula 1 Miami) are priced months ahead. We price to convert: higher conversion ranks listings higher, which books more and earns more.
Distribution: 40+ channels (Airbnb, Vrbo, Booking.com, Expedia, Marriott, Blueground, our direct site stay-hospitality.com).
Listings: built to convert (best photos first, copy that sells), refreshed every three months; underperformers are caught and fixed.
Technology: Guesty (reservations and channels), PriceLabs (pricing data), Breezeway (every task, photo-checked) and Lighthouse — our own AI platform built in-house. Lighthouse optimizes listings, builds guest guidebooks, spots recurring issues before guests do, turns problems into tasks automatically, monitors reviews and messages, checks guest ID and deposits, translates Spanish and English for the team, and schedules turnovers. Lighthouse does NOT produce the owner report.
Operations: one complete in-house team — housekeeping, maintenance, inspections and guest care (the Customer Care Team).
Season: demand is strongest December through March, and March is the peak month (say "peak season", never promise a result).
This year's work for owners (use for year-in-review and what's-next stories): Lighthouse built in-house and now running across the portfolio; every listing rebuilt and refreshed on a three-month cycle (photos first, copy, amenities audited on every channel); guest ID and deposit checks before arrival; every clean photo-checked; big dates priced months ahead.
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
/** The public address of a free tool ('' = the list of tools), for the QR codes on the tool ads. */
export const TOOL_LINK = (k: string) => (process.env.NEXT_PUBLIC_SITE_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '') + '/tools' + (k ? '/' + k : '')
export type AdStory = AdTemplate & { length: string; who: string }
/** Longer owner-facing stories (Jon, 2026-11-03: "full Stay Hospitality story, what we can share with owners as we onboard,
 *  welcome video, what the first 90 days looks like, team intro, our story"). Every fact is from HOUSE_FACTS / the house
 *  onboarding copy; photos come from the library; every word is editable after it is built. */
export const STORIES: AdStory[] = [
  { key: 'our-story', label: 'Our story · Stay Hospitality', length: '≈ 60 s', who: 'Owners, partners, the website', blurb: 'Who we are in a minute: ten years, 450+ listings, how we run revenue, tools and team — ends on Nick.', audience: 'owners', format: '16:9', name: 'Our story', scenes: [
    { kind: 'cinema', vo: 'Ten years. Four hundred and fifty listings. One standard.', head: 'Ten **years.**\n450+ **listings.**\nOne **standard.**', sub: 'Stay Hospitality · South Florida', items: [], q: 'exterior', n: 1 },
    { kind: 'stats', vo: 'Stay Hospitality manages short-term rentals across Miami, Fort Lauderdale, Pompano and Palm Beach.', head: 'South Florida, **by the numbers**', sub: '', items: ['10|years in business', '450+|listings', '140+|properties', '1M+|guests hosted', '4.6|guest rating', '40+|booking channels'], q: 'pool', n: 1 },
    { kind: 'wall', vo: 'From downtown high-rises to beachfront buildings, we run whole buildings and the units inside them.', head: 'Buildings, **not just units.**', sub: '', items: [], q: 'exterior', n: 4 },
    { kind: 'cards', vo: 'Three things decide what a property earns: how the rate is managed, the tools it runs on, and the team that shows up.', head: '', sub: '', items: ['Revenue|Priced every day against the competitive set', 'Tools|Guesty, PriceLabs, Breezeway and Lighthouse', 'Team|Housekeeping, maintenance, inspections and guest care — in-house'], q: 'living room', n: 3 },
    { kind: 'feed', vo: 'Lighthouse is our own AI platform. It optimizes listings, builds guidebooks, catches recurring issues and turns problems into tasks before a guest notices.', head: '**Lighthouse**, built in-house', sub: 'Our own AI platform', items: ['Listings optimized|Best photos first, copy that sells, refreshed every three months', 'Issues caught early|Recurring problems become tasks automatically', 'Guests looked after|Guidebooks, ID checks, reviews and messages monitored'], q: 'kitchen', n: 1 },
    { kind: 'quote', vo: 'We price to convert. Higher conversion ranks a listing higher, which books more and earns more.', head: 'We price to **convert.** Higher conversion ranks higher, books more, earns more.', sub: 'How we manage revenue', items: [], q: 'balcony view', n: 1 },
    { kind: 'contact', vo: 'Talk to Nick about your property. 651-200-8283.', head: 'Talk to **Nick.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'welcome', label: 'Welcome aboard', length: '≈ 45 s', who: 'A new owner, the day they sign', blurb: 'Thank you, what happens now, who you will hear from, what you see every month.', audience: 'owners', format: '16:9', name: 'Welcome to Stay', scenes: [
    { kind: 'title', vo: 'Welcome to Stay Hospitality. Thank you for trusting us with your property.', head: 'Welcome to **Stay.**', sub: 'Thank you for trusting us with your property', items: [], q: 'exterior', n: 1 },
    { kind: 'checks', vo: 'Here is what happens now. We walk the property, photograph it, build the listing, publish it across forty-plus channels, and set the pricing.', head: 'What happens **now**', sub: 'Most of it is on us', items: ['The walk-through', 'Professional photography', 'Listing built from scratch', 'Live on 40+ channels', 'Pricing set and reviewed daily'], q: 'living room', n: 1 },
    { kind: 'team', vo: 'These are the people behind your property: management, maintenance, housekeeping and the Customer Care Team.', head: 'Who you will **hear from**', sub: '', items: ['Nick Carline|Business Development', 'Jon McGill|General Manager', 'Roberto Chirboga|Manager', 'Ronnie Regis|Maintenance Supervisor', 'Karla Valle|Customer Care'] },
    { kind: 'feed', vo: 'Every month you get a statement, your owner portal, and a report that shows the work behind the numbers.', head: 'What you **see** every month', sub: '', items: ['Your statement|Every booking, every fee, every payout', 'Your owner portal|Calendar, bookings and documents, any time', 'The owner report|The month, explained'], q: 'kitchen', n: 1 },
    { kind: 'quote', vo: 'Your part is the agreement, access and approving what gets bought. Everything else is work we do and show you.', head: 'Your part is the agreement, access and approvals. **Everything else is work we do and show you.**', sub: 'Stay Hospitality', items: [], q: 'balcony view', n: 1 },
    { kind: 'contact', vo: 'Questions any time. Nick is at 651-200-8283.', head: 'Questions? **Any time.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'first-90', label: 'Your first 90 days', length: '≈ 60 s', who: 'A new owner', blurb: 'Signature to first booking in about four weeks, then what the next two months look like.', audience: 'owners', format: '16:9', name: 'Your first 90 days', scenes: [
    { kind: 'kinetic', vo: 'From signature to first booking, usually inside four weeks. Here is your first ninety days.', head: 'Your first **90 days**', sub: '', items: [], q: 'exterior', n: 1 },
    { kind: 'timeline', vo: 'Week one: the agreement, your owner profile, and the walk-through. Weeks one and two: anything the property needs is specified and ordered. Week two: photography and the listing. Week three: live everywhere, pricing set, operations live. Week four: the kickoff call.', head: 'The first **four weeks**', sub: '', items: ['Week 1|Agreement, owner profile, the walk-through', 'Weeks 1–2|Furnishing and supplies ordered', 'Week 2|Photography and the listing', 'Week 3|Live on 40+ channels, pricing set, operations live', 'Week 4|The kickoff call'], q: 'living room', n: 1 },
    { kind: 'cards', vo: 'Then the calendar fills. Days thirty to ninety are about conversion: the rate reviewed every day, reviews earned, and the listing refined from what the data says.', head: '', sub: '', items: ['Days 30–60|Priced every day; the first reviews come in', 'Days 60–90|Ranking climbs with conversion; the listing is refined', 'Every month|Your statement, your portal, your report'], q: 'pool', n: 3 },
    { kind: 'quote', vo: 'A new listing converts worse at the same price until it has reviews and rank. We price to the demand that is there, take every night that clears it, and earn the reviews from nights that would otherwise have gone empty.', head: 'We price to the demand that is there and **earn the reviews from nights that would otherwise have gone empty.**', sub: 'How a new listing ramps', items: [], q: 'balcony view', n: 1 },
    { kind: 'checks', vo: 'What we need from you: the agreement, the keys, and about two hours of decisions.', head: 'What we need **from you**', sub: 'Everything else is on us', items: ['The management agreement', 'Keys and access', 'About two hours of decisions', 'Approvals on what gets bought'], q: 'kitchen', n: 1 },
    { kind: 'contact', vo: 'Questions on the way? Nick is at 651-200-8283.', head: 'Here the **whole way.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'team', label: 'Meet the team', length: '≈ 40 s', who: 'Owners and partners', blurb: 'The people, then the four crews that make up one in-house team.', audience: 'owners', format: '16:9', name: 'Meet the team', scenes: [
    { kind: 'title', vo: 'One complete team. Here is who runs your property.', head: 'One complete **team.**', sub: 'Stay Hospitality', items: [], q: 'lobby', n: 1 },
    { kind: 'team', vo: 'Nick in business development. Jon, our general manager. Roberto managing operations. Ronnie on maintenance. Karla leading customer care.', head: 'The **people**', sub: '', items: ['Nick Carline|Business Development', 'Jon McGill|General Manager', 'Roberto Chirboga|Manager', 'Ronnie Regis|Maintenance Supervisor', 'Karla Valle|Customer Care'] },
    { kind: 'checks', vo: 'Behind them, four crews, all in-house: housekeeping, maintenance, inspections, and the Customer Care Team for every guest.', head: 'Four crews, **in-house**', sub: '', items: ['Housekeeping', 'Maintenance', 'Inspections', 'Customer Care Team'], q: 'living room', n: 1 },
    { kind: 'stats', vo: 'Across Miami, Fort Lauderdale, Pompano and Palm Beach.', head: '', sub: '', items: ['450+|listings', '140+|properties', '4.6|guest rating', '1M+|guests hosted'], q: 'pool', n: 1 },
    { kind: 'contact', vo: 'Meet us in person. Nick is at 651-200-8283.', head: 'Meet us **in person.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'stay-run', label: 'How a stay is run', length: '≈ 40 s', who: 'Owners', blurb: 'The guest journey from booking to review, and the record behind it.', audience: 'owners', format: '16:9', name: 'How a stay is run', scenes: [
    { kind: 'cinema', vo: 'Every stay follows the same path, and every step is on the record.', head: 'Every stay, **on the record.**', sub: 'How a stay is run', items: [], q: 'bedroom', n: 1 },
    { kind: 'feed', vo: 'A booking lands on one of forty-plus channels. The guest is checked, welcomed, and given a guidebook. The turnover is cleaned and inspected with photos. The Customer Care Team is there throughout.', head: 'Booking to **review**', sub: '', items: ['The booking|One calendar across 40+ channels', 'The guest|ID checked, welcomed, a digital guidebook', 'The turnover|Cleaned and inspected, photo-checked in Breezeway', 'The stay|Customer Care Team on every guest', 'The review|Monitored and answered'], q: 'living room', n: 1 },
    { kind: 'stats', vo: 'Guests rate their stays four point six out of five.', head: '', sub: '', items: ['4.6|guest rating', '1M+|guests hosted'], q: 'pool', n: 1 },
    { kind: 'contact', vo: 'See how it would run for your property. Nick, 651-200-8283.', head: 'See it for **your property.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
  { key: 'partner', label: 'Partner intro', length: '≈ 30 s', who: 'Realtors, lenders, CPAs', blurb: 'Who we are, what we run, and what their client gets — for referral partners.', audience: 'partners', format: '16:9', name: 'For our partners', scenes: [
    { kind: 'kinetic', vo: 'When your client buys a rental, here is who runs it.', head: 'Who runs **your client\'s** rental', sub: '', items: [], q: 'exterior', n: 1 },
    { kind: 'stats', vo: 'Ten years, four hundred and fifty listings, over a million guests.', head: '', sub: '', items: ['10|years', '450+|listings', '1M+|guests', '4.6|rating'], q: 'pool', n: 1 },
    { kind: 'cards', vo: 'Revenue managed every day, one in-house team, and a statement every month your client can read.', head: '', sub: '', items: ['Revenue|Priced every day, big dates months ahead', 'Operations|One in-house team, every task photo-checked', 'Transparency|A statement every month, an owner portal any time'], q: 'living room', n: 3 },
    { kind: 'contact', vo: 'Introduce us. Nick, 651-200-8283.', head: 'Introduce **us.**', sub: '', items: [], q: 'ocean view', n: 1 },
  ] },
]

/** Ready-made ads: pick one and it fills itself with photos from the library — no AI needed. */
export const TEMPLATES: AdTemplate[] = [
  // THE FREE OWNER TOOLS (Jon, 2026-11-12: "add the QR codes and create video content for the free linen and
  // inventory estimator, also the revenue estimator"). Each ends on a card with the tool's QR code; the
  // tools are free for any owner, whether or not they work with Stay, so the ads say so and promise nothing more.
  { key: 'tool-projection', label: 'Free tool · Projections calculator', blurb: '9:16 reel: what could your rental earn, how it works, scan the QR', audience: 'owners', format: '9:16', name: 'Free projections calculator', scenes: [
    { kind: 'kinetic', vo: 'What could your South Florida rental earn? Find out, free.', eyebrow: 'Free for owners', head: 'What could your\nrental **earn?**', sub: '', items: [], q: 'living room', n: 1 },
    { kind: 'checks', vo: 'Search your building, then add the bedrooms, the size, the view and the amenities.', head: 'Tell it about **your home**', sub: '', items: ['Search your building|The address fills itself in', 'Bedrooms, size and view|Kitchen, balcony and amenities', 'Where it is|How far to the beach, what is nearby'], q: 'balcony', n: 1 },
    { kind: 'cards', vo: 'You get a yearly range, the month-by-month pattern, and the comparable homes behind it.', head: '', sub: '', items: ['A yearly range|Gross, once the listing is established', 'Month by month|The South Florida season', 'Real comparables|From the projections we build'], q: 'ocean view', n: 3 },
    { kind: 'cta', vo: 'Scan the code. It is free, with no account needed.', head: 'Scan for your\n**projection.**', sub: 'Free for any owner · no account needed', items: ['Try the free calculator'], q: 'pool', n: 1, qr: TOOL_LINK('income'), qrLabel: 'Scan for a free projection' },
  ] },
  { key: 'tool-supplies', label: 'Free tool · Supply and linen checklist', blurb: '9:16 reel: everything a rental needs, linen at par, a PDF checklist, scan the QR', audience: 'owners', format: '9:16', name: 'Free rental supply checklist', scenes: [
    { kind: 'kinetic', vo: 'Setting up a rental? Here is everything it needs, counted for you.', eyebrow: 'Free for owners', head: 'Everything your\nrental **needs.**', sub: '', items: [], q: 'kitchen', n: 1 },
    { kind: 'checks', vo: 'Add the bedrooms, the beds by size, the baths, and what is in the kitchen.', head: 'Describe **your home**', sub: '', items: ['Beds by size|King, queen, full, twin, sofa bed', 'The kitchen|Only the appliances it has', 'Every bathroom|Towels, mats and dispensers'], q: 'bedroom', n: 1 },
    { kind: 'cards', vo: 'Every item counted, the linen at par, and a checklist to keep.', head: '', sub: '', items: ['Every item counted|Must-have, recommended, optional', 'Linen at par|Three sets in rotation', 'A checklist to keep|Download it as a PDF'], q: 'bathroom', n: 3 },
    { kind: 'cta', vo: 'Scan the code. It is free, for any owner.', head: 'Scan for your\n**checklist.**', sub: 'Free for any owner · download the PDF', items: ['Get the free checklist'], q: 'living room', n: 1, qr: TOOL_LINK('inventory'), qrLabel: 'Scan for the free checklist' },
  ] },
  { key: 'tool-both', label: 'Free tool · Both owner tools', blurb: '4:5 feed ad: the projection calculator and the supply checklist, one QR to both', audience: 'owners', format: '4:5', name: 'Free tools for rental owners', scenes: [
    { kind: 'title', vo: 'Two free tools for South Florida rental owners.', eyebrow: 'Free for owners', head: 'Free tools for\n**rental owners.**', sub: 'From Stay Hospitality', items: [], q: 'exterior', n: 1 },
    { kind: 'cards', vo: 'See what your home could earn, and get everything it needs, counted, with the linen at par.', head: '', sub: '', items: ['Projections calculator|What your home could earn', 'Supply checklist|Every item and the linen, counted'], q: 'view', n: 2 },
    { kind: 'cta', vo: 'Scan the code to try both. Free, no account needed.', head: 'Try them\n**free.**', sub: 'For any owner, whether or not you work with us', items: ['Scan to try both tools'], q: 'pool', n: 1, qr: TOOL_LINK(''), qrLabel: 'Scan for the free tools' },
  ] },
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
