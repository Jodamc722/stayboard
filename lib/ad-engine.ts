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

export type AdKind = 'title' | 'cinema' | 'kinetic' | 'reveal' | 'mask' | 'panel' | 'ticker' | 'callouts' | 'polaroid' | 'event' | 'photo' | 'stats' | 'wall' | 'cards' | 'feed' | 'checks' | 'rise' | 'timeline' | 'team' | 'quote' | 'contact' | 'cta'
/** Jon, 2026-11-02: "need more style … a wide range of edits, range of styles and looks". */
export type AdStyle = {
  font: 'auto' | 'sans' | 'serif' | 'condensed' | 'elegant'
  caps: 'auto' | 'on' | 'off'
  grade: 'auto' | 'natural' | 'warm' | 'cool' | 'mono' | 'vivid' | 'faded' | 'duotone' | 'golden' | 'noir'
  pace: 'calm' | 'normal' | 'fast'
  finish: 'auto' | 'film' | 'soft' | 'glow' | 'clean'
  frame: 'none' | 'border' | 'letterbox'
  logo: 'auto' | 'gold' | 'black' | 'white' | 'off'
  /** Custom colours on top of the look ('' = the look's own). */
  accent?: string
  base?: string
  text?: string
}
export const STYLE_DEFAULT: AdStyle = { font: 'auto', caps: 'auto', grade: 'auto', pace: 'normal', finish: 'auto', frame: 'none', logo: 'auto' }
export const STYLE_OPTIONS: { [K in keyof AdStyle]: { key: AdStyle[K]; label: string }[] } = {
  font: [{ key: 'auto', label: 'Look’s own' }, { key: 'sans', label: 'Bold sans' }, { key: 'serif', label: 'Serif' }, { key: 'condensed', label: 'Condensed' }, { key: 'elegant', label: 'Elegant' }],
  caps: [{ key: 'auto', label: 'Look’s own' }, { key: 'on', label: 'ALL CAPS' }, { key: 'off', label: 'Normal case' }],
  grade: [{ key: 'auto', label: 'Look’s own' }, { key: 'natural', label: 'Natural' }, { key: 'warm', label: 'Warm' }, { key: 'cool', label: 'Cool' }, { key: 'vivid', label: 'Vivid' }, { key: 'faded', label: 'Faded film' }, { key: 'mono', label: 'Black & white' }, { key: 'duotone', label: 'Duotone' }, { key: 'golden', label: 'Gold tone' }, { key: 'noir', label: 'Noir' }],
  pace: [{ key: 'calm', label: 'Calm' }, { key: 'normal', label: 'Normal' }, { key: 'fast', label: 'Fast' }],
  finish: [{ key: 'auto', label: 'Look’s own' }, { key: 'film', label: 'Film grain' }, { key: 'soft', label: 'Soft' }, { key: 'glow', label: 'Light leak' }, { key: 'clean', label: 'Clean' }],
  frame: [{ key: 'none', label: 'Full bleed' }, { key: 'border', label: 'Border' }, { key: 'letterbox', label: 'Letterbox' }],
  logo: [{ key: 'auto', label: 'Look’s own' }, { key: 'gold', label: 'Gold' }, { key: 'black', label: 'Black' }, { key: 'white', label: 'White' }, { key: 'off', label: 'Off' }],
}

/** How a scene arrives from the one before it. 'auto' varies them across the ad. */
export type AdTransition = 'auto' | 'fade' | 'zoom' | 'push' | 'wipe' | 'flash' | 'cut' | 'slide' | 'iris' | 'blinds' | 'spin' | 'blur' | 'doors' | 'glitch' | 'whip' | 'dip' | 'diamond'
export const TRANSITIONS: AdTransition[] = ['auto', 'fade', 'zoom', 'push', 'slide', 'whip', 'wipe', 'iris', 'diamond', 'doors', 'blinds', 'spin', 'blur', 'glitch', 'dip', 'flash', 'cut']
/** How a scene's headline arrives (Jon, 2026-11-03: "more everything"). */
export type AdTextAnim = 'auto' | 'rise' | 'pop' | 'type' | 'wipe' | 'blur' | 'words' | 'drop'
export const TEXT_ANIMS: { key: AdTextAnim; label: string }[] = [{ key: 'auto', label: 'Auto' }, { key: 'rise', label: 'Rise' }, { key: 'pop', label: 'Pop' }, { key: 'words', label: 'Word by word' }, { key: 'type', label: 'Typewriter' }, { key: 'wipe', label: 'Wipe' }, { key: 'blur', label: 'Focus' }, { key: 'drop', label: 'Drop' }]
/** The camera move on a scene's photo. */
export type AdCam = 'auto' | 'in' | 'out' | 'left' | 'right' | 'up' | 'still' | 'drift'
export const CAMS: { key: AdCam; label: string }[] = [{ key: 'auto', label: 'Auto' }, { key: 'in', label: 'Push in' }, { key: 'out', label: 'Pull out' }, { key: 'left', label: 'Pan left' }, { key: 'right', label: 'Pan right' }, { key: 'up', label: 'Tilt up' }, { key: 'drift', label: 'Drift' }, { key: 'still', label: 'Still' }]
/** Colour presets for the custom-colour controls (beyond the looks). */
export const SWATCHES = ['#D2B077', '#0D2131', '#FFFFFF', '#111111', '#F4EEE4', '#E2412B', '#FF5FA2', '#FF8A5B', '#F2B544', '#5FE0D2', '#2F7DF6', '#4CC488', '#7B5CF0', '#1D3A31', '#B5562E', '#E9D8B4']
export type AdAudience = 'owners' | 'partners' | 'guests'
export type AdFormat = '16:9' | '9:16' | '1:1' | '4:5'
export type AdScene = {
  id: string
  kind: AdKind
  /** How this scene comes in (default auto). */
  tr?: AdTransition
  /** Headline animation, camera move and an optional badge/sticker. */
  anim?: AdTextAnim
  cam?: AdCam
  badge?: string
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
  /** Motion graphics layered on the scene (FX keys). */
  fx?: string[]
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
  /** The visual style (LOOKS): accent colour, base and photo tint. */
  look?: string
  /** What the ad is for (GOALS), set when it was started. */
  goal?: string
  /** Where it will run (PLATFORMS key) — sets the shape, the safe zones and the length rules. */
  platform?: string
  /** Team workflow: draft → review → approved, with notes for whoever picks it up next. */
  status?: 'draft' | 'review' | 'approved'
  notes?: string
  /** Fine-grained style on top of the look (each 'auto' falls back to the look's own choice). */
  style?: AdStyle
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
  // capital at the start of every line (also inside a leading **)
  return s.split('\n').map(line => line.replace(/^(\s*(?:\*\*)?\s*)([a-z])/, (_m, a: string, b: string) => a + b.toUpperCase())).join('\n')
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
  const hw = (first.head || '').replace(/\*\*/g, '').trim().split(/\s+/).filter(Boolean).length
  if (hw > 6) out.push({ sev: 'high', scene: 0, code: 'hook-long', msg: `The hook is ${hw} words — people decide in 1.5 s. Cut it to 2–5.` })
  if (!first.head.trim()) out.push({ sev: 'high', scene: 0, code: 'hook-missing', msg: 'The first scene has no headline — most people watch muted, so the hook must be on screen.' })
  if (/^(welcome|introducing|stay hospitality)/i.test(first.head.replace(/\*\*/g, '').trim())) out.push({ sev: 'med', scene: 0, code: 'hook-weak', msg: 'Opening on "Welcome" or the company name wastes the hook. Lead with a feeling, a benefit or the place.' })
  if (/^(welcome to|introducing|this is stay)/i.test(first.vo.trim())) out.push({ sev: 'low', scene: 0, code: 'hook-vo', msg: 'The first line opens with "Welcome to" - lead with the place or the feeling instead.' })
  if (!first.photos.length && ['stats', 'contact'].indexOf(first.kind) < 0) out.push({ sev: 'high', scene: 0, code: 'hook-photo', msg: 'The first scene has no photo — the strongest image belongs here.' })
  const last = sc[n - 1]
  if (guests && last.kind !== 'cta') out.push({ sev: 'high', scene: n - 1, code: 'cta', msg: 'A guest ad must end on the Book now card.', fix: { label: 'Make it the Book now card', scene: { kind: 'cta', items: ['Book at stay-hospitality.com'] } } })
  if (!guests && last.kind !== 'contact') out.push({ sev: 'high', scene: n - 1, code: 'contact', msg: 'An owner or partner ad must end on Nick’s contact card.', fix: { label: 'Make it the contact card', scene: { kind: 'contact' } } })
  if (tl.durs[n - 1] < 3.2) out.push({ sev: 'med', scene: n - 1, code: 'end-short', msg: `The end card holds ${tl.durs[n - 1].toFixed(1)} s — too short to read the call to action.`, fix: tl.voiced ? undefined : { label: 'Hold it 4.5 s', scene: { dur: 4.5 } } })
  if (!p.captions) out.push({ sev: 'med', code: 'captions', msg: 'Captions are off — most feed viewers watch muted.', fix: { label: 'Turn captions on', project: { captions: true } } })
  if (p.music === 'none') out.push({ sev: 'low', code: 'music', msg: 'No music. Even a quiet bed lifts watch time.', fix: { label: 'Use Werq', project: { music: 'werq' } } })
  if (tl.total > PF.max) out.push({ sev: 'med', code: 'length', msg: `${tl.total.toFixed(0)} s is over the ${PF.max} s limit for a ${PF.label}. Cut scenes or lines.` })
  else if (tl.total > 35 && (PF.key === 'reel' || PF.key === 'tiktok')) out.push({ sev: 'low', code: 'length-soft', msg: `${tl.total.toFixed(0)} s on a ${PF.label}: 15–30 s keeps more viewers to the end.` })
  if (n > Math.max(4, tl.total / 2.4)) out.push({ sev: 'med', code: 'too-many', msg: `${n} scenes in ${tl.total.toFixed(0)} s is a flicker — aim for one scene every 3–4 s.` })
  // photos
  const seen = new Map<string, number>()
  sc.forEach((x, i) => x.photos.forEach(u => { if (seen.has(u)) out.push({ sev: 'med', scene: i, code: 'dup-photo', msg: `Same photo as scene ${seen.get(u)! + 1}. Give each scene its own.` }); else seen.set(u, i) }))
  sc.forEach((x, i) => { if (!x.photos.length && ['stats', 'contact', 'checks', 'feed', 'rise'].indexOf(x.kind) < 0) out.push({ sev: 'high', scene: i, code: 'no-photo', msg: 'No photo on a photo-led scene.' }) })
  // words per second, voice risks, numbers
  const allowed = new Set(numbersIn(facts + ' ' + (p.prompt || '') + ' 1M 1000000 651 200 8283'))
  sc.forEach((x, i) => {
    const w = x.vo.trim().split(/\s+/).filter(Boolean).length
    if (w && !tl.voiced && w / Math.max(1, tl.durs[i]) > 3.1) out.push({ sev: 'med', scene: i, code: 'fast', msg: `${w} words in ${tl.durs[i].toFixed(1)} s — too fast to land. Cut the line or let it hold longer.` })
    const risky = riskyWords(x.vo); if (risky.length) out.push({ sev: 'med', scene: i, code: 'voice-risk', msg: `The voice says ${risky.join(' and ')} wrong — keep it on screen only.` })
    const bad = numbersIn([x.vo, x.head, x.sub, x.items.join(' ')].join(' ')).filter(v => !allowed.has(v))
    if (bad.length) out.push({ sev: 'high', scene: i, code: 'number', msg: `Check ${Array.from(new Set(bad)).join(', ')} — not in our facts.` })
    if (guests && /\$|\bcall us\b|\btext us\b|\d{3}[-.]\d{3}[-.]\d{4}/i.test(x.vo + ' ' + x.head + ' ' + x.items.join(' '))) out.push({ sev: 'high', scene: i, code: 'guest-rule', msg: 'Guest ads never show a price or "call us" — the only ask is to book at stay-hospitality.com.' })
    if (!x.head.trim() && !x.vo.trim() && ['wall', 'photo'].indexOf(x.kind) < 0) out.push({ sev: 'low', scene: i, code: 'blank', msg: 'Nothing said and nothing on screen.' })
    if (i > 0 && x.kind === sc[i - 1].kind && ['photo', 'wall'].indexOf(x.kind) < 0) out.push({ sev: 'low', scene: i, code: 'same-kind', msg: `Two ${x.kind} scenes in a row — vary the design.` })
  })
  if (!sc.some(x => /\*\*/.test(x.head))) out.push({ sev: 'low', code: 'no-gold', msg: 'No highlighted word anywhere — mark the key word in a headline with **…** for the brand accent.' })
  const named = sc.some(x => /stay hospitality|17 ?west|amrit|elser|botanica|garden hotel|arya|aria|salato|capri|eden|nomad|lucerne|hendricks|boynton|park towers/i.test(x.vo + ' ' + x.head + ' ' + x.sub))
  if (!named) out.push({ sev: 'med', code: 'no-name', msg: guests ? 'The property is never named — people cannot search for it.' : 'Stay Hospitality is never named.' })
  return out.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.sev] - { high: 0, med: 1, low: 2 }[b.sev]))
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
type LookDef = { font?: 'sans' | 'serif' | 'condensed' | 'elegant'; caps?: boolean; grade?: AdStyle['grade']; finish?: AdStyle['finish']; logo?: 'gold' | 'black' | 'white'; fx?: string[]; mesh?: [string, string, string] }
type Palette = { serif?: boolean; light?: boolean; def?: LookDef; gold: string; ink: string; mut: string; navy: string; navy2: string; deep: string; tint: string; glass: string; line: string; green: string }
/** Visual styles (Jon, 2026-11-02: "create new visual … revamp … vibe"). `gold` is the accent the
 *  headline's **marked** words, rings and buttons take; `tint` darkens photos so text reads. */
export const LOOKS: { key: string; label: string; blurb: string; c: Palette }[] = [
  { key: 'stay', label: 'Stay navy & gold', blurb: 'The house look', c: { gold: '#D2B077', ink: '#F2EEE6', mut: '#A9B8C6', navy: '#0D2131', navy2: '#132E44', deep: '#091827', tint: '6,18,30', glass: 'rgba(10,26,40,0.62)', line: 'rgba(255,255,255,0.18)', green: '#4CC488' } },
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
  { key: 'champagne', label: 'Champagne', blurb: 'Gold gradient, elegant serif, sparkle', c: { def: { font: 'elegant', grade: 'golden', finish: 'glow', logo: 'white', fx: ['sparkle'], mesh: ['#8A6A2E', '#3A2A12', '#1A1208'] }, gold: '#F3D9A0', ink: '#FFF8EC', mut: '#D9C7A6', navy: '#2A1E0E', navy2: '#4A3617', deep: '#160F06', tint: '34,24,10', glass: 'rgba(50,36,16,0.6)', line: 'rgba(255,230,180,0.25)', green: '#CDE3A0' } },
  { key: 'midnight', label: 'Midnight', blurb: 'Deep blue, light rays, cinematic', c: { def: { font: 'sans', grade: 'cool', finish: 'film', logo: 'gold', fx: ['rays'], mesh: ['#0A2A5A', '#071530', '#03091A'] }, gold: '#D2B077', ink: '#EAF0FF', mut: '#A8B6D0', navy: '#071530', navy2: '#0E2250', deep: '#030A1C', tint: '5,16,40', glass: 'rgba(8,22,60,0.6)', line: 'rgba(200,220,255,0.2)', green: '#5FE0A0' } },
  { key: 'golden', label: 'Golden hour', blurb: 'Warm amber, elegant serif, light leak', c: { def: { font: 'elegant', grade: 'warm', finish: 'glow', logo: 'gold' }, gold: '#F2B544', ink: '#FFF6E8', mut: '#E3CDB0', navy: '#24170C', navy2: '#3D2814', deep: '#140C05', tint: '36,22,10', glass: 'rgba(40,24,10,0.6)', line: 'rgba(255,220,170,0.22)', green: '#B9D98A' } },
]
let C: Palette = LOOKS[0].c
// Per-frame style state, set by drawFrame from the look + the ad's style.
let GRADE = ''          // canvas filter for photos
let DUO: [string, string] | null = null  // duotone shadows/highlights
let FXS: string[] = []  // the look's default graphics
let PD = 1              // pace: >1 slower, <1 faster
let CAPS = false
let FONTW = 0           // a single-weight display face (condensed) draws at its own weight
let DISPLAY = ''
let FS = 1             // the elegant serif runs small; scale it up
let ANIM: AdTextAnim = 'rise'
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
    pace: st.pace,
    finish: st.finish === 'auto' ? (d.finish || 'film') : st.finish,
    frame: st.frame,
    logo: st.logo === 'auto' ? (d.logo || (L.light ? 'black' : 'gold')) : st.logo,
    accent: st.accent || '', base: st.base || '', text: st.text || '',
  }
}
/** Overlay strength: light looks wash photos harder so dark type reads. */
const TA = (a: number) => (C.light ? Math.min(0.92, a * 1.25 + 0.12) : a)
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
  const s = Math.max(w / iw, h / ih) * zoom
  const dw = iw * s, dh = ih * s
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
    if (opts.shadow !== false) { ctx.shadowColor = C.light ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'; ctx.shadowBlur = size * 0.35 }
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
  const bottomSafe = Math.max((p.captions ? 190 : 110) * u, H * PF.safe.bottom + (p.captions ? 150 : 40) * u)
  const get = (u: string) => (!u ? null : A.media ? A.media(u, local) : A.img(u))
  const im = (k: number) => get(sc.photos[k] || '')
  const head = CAPS ? (sc.head || '').toUpperCase() : sc.head || ''
  const fam = motionFamily(p)
  ANIM = sc.anim && sc.anim !== 'auto' ? sc.anim : (sc.kind === 'cinema' || sc.kind === 'panel' ? (fam === 'lively' ? 'rise' : 'blur') : fam === 'lively' ? (sc.kind === 'title' || sc.kind === 'photo' ? 'words' : 'rise') : 'rise')
  CAM = sc.cam || 'auto'

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
    y += rich(ctx, head || 'Your South Florida **stay.**', pad, y, W - pad * 2, size, { font: A.display, local, delay: 0.25, stagger: 0.3, align: 'center', maxH: H * 0.3 }) + 26 * u
    if (sc.sub) y += plain(ctx, sc.sub, pad, y, W - pad * 2, 38 * u, A.body, C.ink, 500, 'center', appear(local, 0.7)) + 40 * u
    const label = (sc.items[0] || 'Book at stay-hospitality.com').replace(/\|.*/, '')
    ctx.font = fnt(700, 40 * u, A.body)
    const bw = ctx.measureText(label).width + 110 * u, bh = 104 * u
    const a = appear(local, 1.0)
    // a soft pulse so a still post still reads as "tap me"
    const pulse = 1 + 0.03 * Math.sin(Math.max(0, local - 1.6) * 4)
    ctx.save(); ctx.globalAlpha *= a
    ctx.translate(W / 2, y + bh / 2); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -(y + bh / 2))
    rr(ctx, (W - bw) / 2, y + (1 - a) * 30 * u, bw, bh, bh / 2); ctx.fillStyle = C.gold; ctx.fill()
    ctx.fillStyle = onAccent(); ctx.textBaseline = 'middle'; ctx.fillText(label, (W - bw) / 2 + 55 * u, y + bh / 2 + (1 - a) * 30 * u)
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
    ty += rich(ctx, head || 'Book a **call.**', tx, ty, tw, 104 * u, { font: A.display, local, delay: 0.4, align: al, maxH: H * 0.22 }) + 30 * u
    const fade = (d: number) => appear(local, d)
    if (c.name) { ty += plain(ctx, c.name, tx, ty, tw, 54 * u, A.display, C.ink, 700, al, fade(0.7)) }
    if (c.role) { ty += plain(ctx, c.role, tx, ty, tw, 30 * u, A.body, C.mut, 500, al, fade(0.8)) + 26 * u }
    if (c.phone) { ty += plain(ctx, c.phone, tx, ty, tw, 92 * u, A.display, C.gold, 800, al, fade(1.1)) + 6 * u }
    if (c.email) { plain(ctx, c.email, tx, ty, tw, 30 * u, A.mono, C.ink, 500, al, fade(1.3)) }
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
  let top = pad + 20 * u
  if (head) top += rich(ctx, head, pad, top, W - pad * 2, (portrait ? 84 : 80) * u, { font: A.display, local, delay: 0.1, maxH: H * 0.26 }) + 16 * u
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
  if (pace === 'calm' || ['linen', 'sand', 'editorial', 'mono', 'golden', 'fresh'].indexOf(p.look || '') >= 0) return pace === 'fast' ? 'normal' : 'calm'
  if (pace === 'fast' || ['miami', 'bold', 'tropic', 'noir'].indexOf(p.look || '') >= 0) return 'lively'
  return 'normal'
}
export function transitionOf(p: AdProject, i: number): AdTransition {
  const t = p.scenes[i]?.tr || 'auto'
  if (t !== 'auto') return t
  const k = p.scenes[i].kind, fam = motionFamily(p)
  if (k === 'cta' || k === 'contact' || k === 'reveal' || k === 'mask') return 'fade' // they make their own entrance
  if (fam === 'calm') return (['fade', 'blur', 'fade', 'zoom'] as AdTransition[])[i % 4]
  if (fam === 'lively') return (['push', 'zoom', 'slide', 'whip'] as AdTransition[])[i % 4]
  return (['zoom', 'fade', 'push', 'fade'] as AdTransition[])[i % 4]
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
export const FX: { key: string; label: string; hint: string }[] = [
  { key: 'bokeh', label: 'Bokeh', hint: 'Soft drifting light circles' },
  { key: 'rays', label: 'Light rays', hint: 'Sun rays sweeping from the corner' },
  { key: 'sparkle', label: 'Sparkle', hint: 'Twinkles that catch the light' },
  { key: 'confetti', label: 'Confetti', hint: 'Falling gold confetti — events, celebrations' },
  { key: 'waves', label: 'Waves', hint: 'Animated wave lines along the bottom' },
  { key: 'grid', label: 'Tech grid', hint: 'A faint moving grid — Lighthouse, data, owners' },
  { key: 'stripes', label: 'Stripes', hint: 'Diagonal accent stripes that slide in' },
  { key: 'orb', label: 'Accent orb', hint: 'A big soft circle in the accent colour behind the words' },
  { key: 'corners', label: 'Corners', hint: 'Animated corner brackets, like a viewfinder' },
  { key: 'stars', label: '4.6 stars', hint: 'The guest rating as stars filling up' },
  { key: 'pin', label: 'Map pin', hint: 'A pin drops with the place line' },
  { key: 'swipe', label: 'Book arrow', hint: 'A bouncing arrow toward the button (end cards)' },
  { key: 'scan', label: 'Scanlines', hint: 'Fine horizontal lines — retro, techy' },
  { key: 'glowline', label: 'Glow line', hint: 'A travelling accent line across the frame' },
]
function hashN(n: number, k: number) { const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v) }
function drawFx(ctx: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets) {
  const sc = p.scenes[i]
  const keys = Array.from(new Set([...(sc.fx || []), ...(sc.fx && sc.fx.length ? [] : FXS)]))
  if (!keys.length) return
  const W = ctx.canvas.width, H = ctx.canvas.height, u = Math.min(W, H) / 1080, t = local
  const portrait = H > W * 1.1
  const gold = hexRgb(C.gold)
  const ga = (a: number) => `rgba(${gold[0]},${gold[1]},${gold[2]},${a})`
  for (const k of keys) {
    ctx.save()
    if (k === 'bokeh') {
      ctx.globalCompositeOperation = C.light ? 'multiply' : 'screen'
      for (let n = 0; n < 18; n++) {
        const r = (30 + 90 * hashN(n, 1)) * u, x = (hashN(n, 2) + 0.03 * Math.sin(t * 0.4 + n)) * W, y = ((hashN(n, 3) - t * 0.012 * (0.5 + hashN(n, 4))) % 1 + 1) % 1 * H
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, C.light ? 'rgba(200,170,120,0.35)' : 'rgba(255,255,255,0.22)'); g.addColorStop(0.7, C.light ? 'rgba(200,170,120,0.12)' : ga(0.08)); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
      }
    } else if (k === 'rays') {
      ctx.globalCompositeOperation = 'screen'; ctx.translate(W * 0.95, -H * 0.05)
      for (let n = 0; n < 7; n++) {
        const ang = Math.PI * 0.55 + n * 0.11 + 0.03 * Math.sin(t * 0.6 + n)
        const g = ctx.createLinearGradient(0, 0, Math.cos(ang) * W * 1.4, Math.sin(ang) * W * 1.4)
        g.addColorStop(0, ga(0.18 + 0.06 * Math.sin(t + n))); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang - 0.03) * W * 1.6, Math.sin(ang - 0.03) * W * 1.6); ctx.lineTo(Math.cos(ang + 0.03) * W * 1.6, Math.sin(ang + 0.03) * W * 1.6); ctx.closePath(); ctx.fill()
      }
    } else if (k === 'sparkle') {
      ctx.globalCompositeOperation = 'screen'
      for (let n = 0; n < 26; n++) {
        const ph = (t * (0.6 + hashN(n, 5)) + hashN(n, 6) * 6) % 3, a = ph < 1 ? Math.sin(ph * Math.PI) : 0
        if (a <= 0) continue
        const x = hashN(n, 7) * W, y = hashN(n, 8) * H, r = (6 + 10 * hashN(n, 9)) * u * a
        ctx.fillStyle = C.light ? ga(0.9 * a) : `rgba(255,255,255,${0.9 * a})`
        ctx.beginPath(); ctx.moveTo(x, y - r * 2); ctx.quadraticCurveTo(x, y, x + r * 2, y); ctx.quadraticCurveTo(x, y, x, y + r * 2); ctx.quadraticCurveTo(x, y, x - r * 2, y); ctx.quadraticCurveTo(x, y, x, y - r * 2); ctx.fill()
      }
    } else if (k === 'confetti') {
      for (let n = 0; n < 40; n++) {
        const sp = 0.08 + 0.1 * hashN(n, 10), y = ((hashN(n, 11) + t * sp) % 1.1) * H - H * 0.05, x = hashN(n, 12) * W + Math.sin(t * 2 + n) * 20 * u
        const w = (8 + 10 * hashN(n, 13)) * u, h = (14 + 10 * hashN(n, 14)) * u
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + hashN(n, 15)) + n); ctx.fillStyle = n % 3 === 0 ? '#fff' : ga(0.95); ctx.globalAlpha = 0.85; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore()
      }
    } else if (k === 'waves') {
      ctx.lineWidth = 3 * u
      for (let n = 0; n < 3; n++) {
        ctx.strokeStyle = ga(0.55 - n * 0.15); ctx.beginPath()
        const base = H - (90 + n * 34) * u - H * platformOf(p).safe.bottom
        for (let x = 0; x <= W; x += 12 * u) ctx.lineTo(x, base + Math.sin(x / (140 * u) + t * (1.2 + n * 0.3) + n) * 14 * u)
        ctx.stroke()
      }
    } else if (k === 'grid') {
      ctx.strokeStyle = C.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 * u
      const step = 96 * u, off = (t * 18 * u) % step
      ctx.beginPath()
      for (let x = -step + off; x < W + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
      for (let y = -step + off * 0.6; y < H + step; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
      ctx.stroke()
      ctx.fillStyle = ga(0.5)
      for (let n = 0; n < 5; n++) { const x = ((hashN(n, 16) + t * 0.02) % 1) * W, y = hashN(n, 17) * H; ctx.beginPath(); ctx.arc(Math.round(x / step) * step + off, Math.round(y / step) * step + off * 0.6, 4 * u, 0, Math.PI * 2); ctx.fill() }
    } else if (k === 'stripes') {
      const a = ease(Math.min(1, t / 0.8))
      ctx.translate(W, 0); ctx.rotate(0.6)
      for (let n = 0; n < 3; n++) { ctx.fillStyle = n === 1 ? (C.light ? C.ink : '#fff') : C.gold; ctx.globalAlpha = 0.85 - n * 0.2; ctx.fillRect(-(60 + n * 70) * u, -H * 0.5 + (1 - a) * H * 1.5, 26 * u, H * 2) }
    } else if (k === 'orb') {
      const a = ease(Math.min(1, t / 0.9)), r = (portrait ? W * 0.42 : H * 0.38) * (0.8 + 0.2 * a)
      const x = portrait ? W * 0.5 : W * 0.3, y = portrait ? H * 0.38 : H * 0.5
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, ga(0.55 * a)); g.addColorStop(1, ga(0))
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
    } else if (k === 'corners') {
      const a = ease(Math.min(1, t / 0.7)), m = 60 * u + (1 - a) * 40 * u, L = 70 * u * a
      ctx.strokeStyle = C.light ? C.ink : C.gold; ctx.lineWidth = 4 * u; ctx.globalAlpha = 0.9
      const PF = platformOf(p), top = H * PF.safe.top + m, bot = H - H * PF.safe.bottom - m, right = W - W * PF.safe.right - m
      for (const [x, y, sx, sy] of [[m, top, 1, 1], [right, top, -1, 1], [m, bot, 1, -1], [right, bot, -1, -1]] as number[][]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke() }
    } else if (k === 'stars') {
      const a = ease(Math.min(1, (t - 0.3) / 1.2)), n = 4.6 * a, size = 44 * u
      const PF = platformOf(p), x0 = 56 * u, y0 = H - H * PF.safe.bottom - (p.captions ? 250 : 140) * u
      for (let s = 0; s < 5; s++) {
        const fill = Math.max(0, Math.min(1, n - s))
        const cx = x0 + s * (size + 10 * u) + size / 2, cy = y0
        const star = () => { ctx.beginPath(); for (let q = 0; q < 10; q++) { const r = q % 2 ? size * 0.22 : size * 0.5, an = -Math.PI / 2 + q * Math.PI / 5; ctx.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r) } ctx.closePath() }
        star(); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill()
        if (fill > 0) { ctx.save(); ctx.beginPath(); ctx.rect(cx - size / 2, cy - size / 2, size * fill, size); ctx.clip(); star(); ctx.fillStyle = C.gold; ctx.fill(); ctx.restore() }
      }
      if (a > 0.9) { ctx.font = fnt(700, 30 * u, A.body); ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText('4.6 / 5 from our guests', x0 + 5 * (size + 10 * u) + 10 * u, y0 + 2 * u) }
    } else if (k === 'pin') {
      const a = ease(Math.min(1, (t - 0.2) / 0.7)), PF = platformOf(p)
      const x = W - W * PF.safe.right - 170 * u, y = H * PF.safe.top + 150 * u - (1 - a) * 200 * u
      ctx.globalAlpha = a
      ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(x, y, 22 * u, Math.PI, 0); ctx.lineTo(x, y + 38 * u); ctx.closePath(); ctx.fill()
      ctx.fillStyle = C.navy; ctx.beginPath(); ctx.arc(x, y, 9 * u, 0, Math.PI * 2); ctx.fill()
      const ring = ((t * 1.2) % 1); ctx.strokeStyle = ga(0.6 * (1 - ring)); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.ellipse(x, y + 42 * u, 30 * u * (0.4 + ring), 12 * u * (0.4 + ring), 0, 0, Math.PI * 2); ctx.stroke()
      const label = (sc.sub || '').replace(/\*\*/g, '').split('·')[0].trim()
      if (label) { ctx.font = fnt(700, 26 * u, A.body); const tw = ctx.measureText(label).width; rr(ctx, x - tw / 2 - 16 * u, y + 56 * u, tw + 32 * u, 44 * u, 22 * u); ctx.fillStyle = C.light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)'; ctx.fill(); ctx.fillStyle = C.light ? C.ink : '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, x - tw / 2, y + 78 * u) }
    } else if (k === 'swipe') {
      const b = Math.abs(Math.sin(t * 3)) * 16 * u, PF = platformOf(p)
      const x = W / 2, y = H - H * PF.safe.bottom - (p.captions ? 300 : 190) * u + b
      ctx.strokeStyle = C.gold; ctx.lineWidth = 8 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(x, y - 70 * u); ctx.lineTo(x, y); ctx.moveTo(x - 28 * u, y - 30 * u); ctx.lineTo(x, y); ctx.lineTo(x + 28 * u, y - 30 * u); ctx.stroke()
    } else if (k === 'scan') {
      ctx.fillStyle = C.light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.18)'
      const off = (t * 40 * u) % (6 * u)
      for (let y = -6 * u + off; y < H; y += 6 * u) ctx.fillRect(0, y, W, 2 * u)
    } else if (k === 'glowline') {
      const ph = (t * 0.35) % 1, x = ph * (W + 400 * u) - 200 * u
      ctx.globalCompositeOperation = 'screen'
      const g = ctx.createLinearGradient(x - 200 * u, 0, x + 200 * u, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, ga(0.35)); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.save(); ctx.transform(1, 0, -0.3, 1, 0, 0); ctx.fillRect(x - 200 * u, 0, 400 * u, H); ctx.restore()
    }
    ctx.restore()
  }
}
function drawSceneFx(ctx: CanvasRenderingContext2D, p: AdProject, i: number, local: number, dur: number, A: AdAssets) {
  drawScene(ctx, p, i, local, dur, A)
  drawFx(ctx, p, i, local, dur, A)
}

/** The whole frame at time t: scene (with a crossfade from the previous one), the mark, captions. */
export function drawFrame(ctx: CanvasRenderingContext2D, p: AdProject, tl: Timeline, t: number, A: AdAssets) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const u = Math.min(W, H) / 1080
  C = (LOOKS.find(l => l.key === p.look) || LOOKS[0]).c
  const R = resolveStyle(p)
  const fam = R.font === 'serif' ? A.serif : R.font === 'condensed' ? A.condensed : R.font === 'elegant' ? A.elegant : A.display
  A = { ...A, display: fam || A.display, logo: R.logo === 'off' ? null : (A.logos && A.logos[R.logo as 'gold' | 'black' | 'white']) || (R.logo === 'gold' ? A.logo : null) }
  // CUSTOM COLOURS on top of the look (Jon, 2026-11-03: "colour options, not just theme changes").
  if (isHex(R.accent)) C = { ...C, gold: R.accent! }
  if (isHex(R.base)) {
    const b = R.base!, lt = lumOf(b) > 150, [r, g, bb] = hexRgb(b)
    C = { ...C, light: lt, navy: b, navy2: shade(b, lt ? 8 : 18), deep: shade(b, lt ? -14 : -12), tint: `${r},${g},${bb}`, glass: `rgba(${r},${g},${bb},${lt ? 0.86 : 0.62})`, line: lt ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.2)', ink: lt ? '#151515' : '#F5F2EC', mut: lt ? '#555049' : '#B8BEC6' }
    if ((p.style?.logo || 'auto') === 'auto') A = { ...A, logo: A.logos ? (lt ? A.logos.black : (A.logos.gold || A.logo)) : A.logo }
  }
  if (isHex(R.text)) C = { ...C, ink: R.text!, mut: R.text! }
  DISPLAY = A.display; FONTW = R.font === 'condensed' && fam ? 400 : 0; FS = R.font === 'elegant' && fam ? 1.2 : 1
  GRADE = GRADES[R.grade] || ''
  DUO = R.grade === 'duotone' ? [shade(C.navy, -10), C.gold] : R.grade === 'golden' ? ['#2A1A08', '#F2C879'] : R.grade === 'noir' ? ['#050505', '#E8E2D6'] : null
  FXS = (LOOKS.find(l => l.key === p.look) || LOOKS[0]).c.def?.fx || []
  PD = R.pace === 'calm' ? 1.35 : R.pace === 'fast' ? 0.72 : 1; CAPS = R.caps
  ctx.save()
  ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H)
  if (!p.scenes.length) { ctx.restore(); return }
  const i = sceneAt(tl, t)
  const local = t - tl.starts[i]
  const tr = transitionOf(p, i)
  const XF = (tr === 'push' || tr === 'wipe' || tr === 'iris' || tr === 'doors' || tr === 'diamond' || tr === 'blinds' ? 0.65 : tr === 'dip' ? 0.8 : tr === 'whip' || tr === 'glitch' ? 0.4 : tr === 'cut' ? 0 : XFADE) * PD
  if (i > 0 && local < XF) {
    const a = ease(local / XF)
    drawSceneFx(ctx, p, i - 1, tl.durs[i - 1] + local, tl.durs[i - 1], A)
    ctx.save()
    if (tr === 'fade') ctx.globalAlpha = a
    else if (tr === 'zoom') { ctx.globalAlpha = Math.min(1, a * 1.4); const z = 1.08 - 0.08 * a; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2) }
    else if (tr === 'push') ctx.translate(W * (1 - a), 0)
    else if (tr === 'wipe') { const e = a * (W + H * 0.6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(e, 0); ctx.lineTo(e - H * 0.6, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip() }
    else if (tr === 'flash' || tr === 'glitch') ctx.globalAlpha = local / XF > 0.5 ? 1 : 0
    else if (tr === 'slide') ctx.translate(0, H * (1 - a))
    else if (tr === 'whip') { ctx.translate(W * (1 - a), 0); try { ctx.filter = `blur(${Math.round((1 - a) * 40 * u)}px)` } catch { /* */ } }
    else if (tr === 'iris') { ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.52 * a + 1, 0, Math.PI * 2); ctx.clip() }
    else if (tr === 'diamond') { const r = (W + H) * 0.55 * a; ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - r); ctx.lineTo(W / 2 + r, H / 2); ctx.lineTo(W / 2, H / 2 + r); ctx.lineTo(W / 2 - r, H / 2); ctx.closePath(); ctx.clip() }
    else if (tr === 'doors') { ctx.beginPath(); ctx.rect(W / 2 - W / 2 * a, 0, W * a, H); ctx.clip() }
    else if (tr === 'blinds') { const n = 9, bh = H / n; ctx.beginPath(); for (let k = 0; k < n; k++) ctx.rect(0, k * bh, W, bh * clamp(a * 1.4 - k * 0.04)); ctx.clip() }
    else if (tr === 'spin') { ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.rotate((1 - a) * -0.35); const z = 0.55 + 0.45 * a; ctx.scale(z, z); ctx.translate(-W / 2, -H / 2) }
    else if (tr === 'blur') { ctx.globalAlpha = a; try { ctx.filter = `blur(${Math.round((1 - a) * 30 * u)}px)` } catch { /* */ } }
    else if (tr === 'dip') ctx.globalAlpha = local / XF > 0.5 ? 1 : 0
    drawSceneFx(ctx, p, i, local, tl.durs[i], A)
    ctx.restore()
    if ((tr === 'iris' || tr === 'diamond' || tr === 'doors') && a < 1) {
      ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 6 * u; ctx.beginPath()
      if (tr === 'iris') ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.52 * a + 1, 0, Math.PI * 2)
      else if (tr === 'diamond') { const r = (W + H) * 0.55 * a; ctx.moveTo(W / 2, H / 2 - r); ctx.lineTo(W / 2 + r, H / 2); ctx.lineTo(W / 2, H / 2 + r); ctx.lineTo(W / 2 - r, H / 2); ctx.closePath() }
      else { ctx.moveTo(W / 2 - W / 2 * a, 0); ctx.lineTo(W / 2 - W / 2 * a, H); ctx.moveTo(W / 2 + W / 2 * a, 0); ctx.lineTo(W / 2 + W / 2 * a, H) }
      ctx.stroke(); ctx.restore()
    }
    if (tr === 'dip') { const q = 1 - Math.abs(2 * (local / XF) - 1); ctx.save(); ctx.globalAlpha = q; ctx.fillStyle = C.gold; ctx.fillRect(0, 0, W, H); ctx.restore() }
    if (tr === 'glitch') {
      const q = local / XF
      if (q > 0.1 && q < 0.9) {
        const seed = Math.floor(t * 30)
        for (let k = 0; k < 9; k++) {
          const rnd = (n: number) => { const v = Math.sin((seed + 1) * 12.9898 + (k + 1) * 78.233 + n * 37.719) * 43758.5453; return v - Math.floor(v) }
          const sy = rnd(1) * H, sh = (0.02 + rnd(2) * 0.06) * H, dx = (rnd(3) - 0.5) * W * 0.12
          ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh)
        }
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.18; ctx.fillStyle = C.gold; ctx.fillRect(0, H * ((seed % 7) / 7), W, H * 0.06); ctx.restore()
      }
    }
    if (tr === 'wipe' && a < 1) { const e = a * (W + H * 0.6); ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 8 * u; ctx.beginPath(); ctx.moveTo(e, 0); ctx.lineTo(e - H * 0.6, H); ctx.stroke(); ctx.restore() }
    if (tr === 'flash') { ctx.fillStyle = `rgba(255,255,255,${1 - Math.abs(2 * (local / XF) - 1)})`; ctx.fillRect(0, 0, W, H) }
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
  if (A.logo && sc.kind !== 'contact' && sc.kind !== 'cta') {
    const lw = 150 * u, lh = lw * (A.logo.naturalHeight || 106) / (A.logo.naturalWidth || 222)
    const PF2 = platformOf(p)
    ctx.drawImage(A.logo, W - lw - Math.max(56 * u, W * PF2.safe.right + 20 * u), Math.max(46 * u, H * PF2.safe.top + 20 * u), lw, lh)
  }
  // CAPTIONS: the line being spoken (most viewers watch muted). Shown while the line plays.
  // Captions — unless the screen already says the same words (a kinetic hook, a title that IS the line).
  const bare = (x: string) => x.replace(/\*\*/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
  if (p.captions && sc.vo.trim() && bare(sc.vo) !== bare(sc.head)) {
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
