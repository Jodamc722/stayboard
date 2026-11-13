'use client'
// AD STUDIO — the editor (Jon, 2026-11-02: "a video editor for ads that we can build, prompt, have
// you write scripts, get previews … think Final Cut Pro but AI, built for custom ads").
//
// Left: the brief and the ads. Centre: the viewer, which IS the renderer (lib/ad-engine drawFrame)
// running live. Right: the inspector for the selected scene. Bottom: the timeline — scenes, voice and
// music tracks with a playhead you can drag. Export records that same renderer to a file, so the
// preview cannot disagree with the download.
//
// No drop-downs (Jon's standing UI rule): every choice is a visible button.
//
// 2026-11-02 (Jon: "make the edit feature, add music, create a playlist of sounds, use Eleven studios
// and voice options … allow me to prompt each scene once it's created"): every scene has an "Ask AI"
// box that rewrites just that scene (with Undo); the whole ad takes a change request too; a Sounds tab
// generates music and sound effects with ElevenLabs and keeps them as a playlist; any scene can carry
// a sound effect; the voice can be any voice in the ElevenLabs library, with delivery sliders.
import { wearsSignature } from '@/lib/ad-signature'
import StudioHome, { KIND_META } from './StudioHome'
import AdDesignPicker from './AdDesignPicker'
import { TransitionPicker, GraphicsPicker } from './AdFxPickers'
import { momentPost, momentFlyer, momentAngles, type PresetScene, type Angle } from '@/lib/ad-presets'
import AdScript from './AdScript'
import { buildingsIn, inBuildings, byPlace, type AreaKey } from '@/lib/ad-places'
import { type Moment, MOMENTS } from '@/lib/marketing-calendar'
import { ACT_LABEL, ACT_COLOR, eventByKey } from '@/lib/ad-event'
import { defaultImagePrompt, stockQueryOf, shapeOfFormat, IMAGE_COST_HINT, EVENT_NAME_NOTE, AI_KEY_MISSING } from '@/lib/ad-image-prompt'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AdProject, type AdScene, type AdKind, type AdFormat, type AdAssets, type AdAudience, type AdTemplate,
  FORMATS, FORMAT_LABEL, VOICES, MUSIC, LOOKS, GOALS, PLATFORMS, VIBES, FX, fxMeta, fxOpts, FX_POS_LABEL, FX_COLOR_LABEL, type FxOpts, platformOf, IDEAS, auditAd, auditScore, HOUSE_FACTS, GUEST_FACTS, type AuditIssue, TRANSITIONS, type AdTransition, STYLE_OPTIONS, STYLE_DEFAULT, type AdStyle, TEXT_ANIMS, CAMS, SWATCHES, type AdTextAnim, type AdCam, VOICE_DEFAULTS, KINDS, LEAD, TEMPLATES, STORIES, type AdStory, type AdKindOf, FLYER_SIZES, LOOKS_FEATURED, DEFAULT_LOOK, TRANSITION_META, TR_DIRECTIONAL, trMeta, type TrDir, type TrLen, PRO_KINDS, PRO_DIM_OF, type SceneCustom, CU_SIZE, CU_FONTS, CU_SHADES, CU_GRADES, CU_ZOOMS, hasCustom, polishAd, timeline, drawFrame, sceneAt, TOOL_LINK, SIG_LAYOUTS, voiceSig, riskyWords, newSceneId,
} from '@/lib/ad-engine'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

type ListRow = { id: string; name: string; updatedAt: string; updatedBy: string; scenes: number; format: string; status?: string; kind?: string; look?: string; thumb?: string; moment?: string }
type Audit = { score: number; verdict: string; strengths: string[]; issues: { scene: number; problem: string; fix: string; patch: Partial<AdScene> | null; remove: boolean; done?: boolean }[]; checks: AuditIssue[]; note?: string }
type Sound = { key: string; name: string; kind: 'music' | 'sfx'; url: string; dur: number; prompt: string; createdAt: string; by: string; path: string }
type LibVoice = { id: string; name: string; blurb: string; preview: string }
type Plan = {
  name: string; property: string; brief: string
  settings: { audience: AdAudience; format: AdFormat; seconds: number; music: string }
  angle: string; hook: string
  questions: { id: string; q: string; options: string[] }[]
  outline: string[]; warnings: string[]
}
type Hit = { url: string; view?: string; thumb: string; caption: string; unit: string; building: string; width: number | null; source?: string; license?: string; credit?: string }
type LibVideo = { key: string; name: string; url: string; thumb: string; dur: number; format: string; builtin: boolean; createdAt: string; by: string; path?: string }

const UI = {
  bg: '#0E1116', panel: '#151A21', panel2: '#1B222B', line: '#262E39', ink: '#E8EBEF', mut: '#8C96A3', gold: '#D2B077', blue: '#4C8DF6', red: '#E5675C', green: '#4CC488',
}
const KIND_COLOR: Record<AdKind, string> = {
  cta: '#E0A64C', mask: '#E0C04C', panel: '#7FA6C9', ticker: '#E06C4C', callouts: '#4CC4A8', polaroid: '#C9B79A', event: '#A06CE0', cinema: '#C98B5E', kinetic: '#E06C9F', reveal: '#5FB8C9', title: '#C9A15E', photo: '#5C8FD6', stats: '#6CB28C', wall: '#9A7FD1', cards: '#D07F5C', feed: '#4FA7B8', checks: '#8FB04A', rise: '#D4677C', timeline: '#D9A441', team: '#7CB5A0', quote: '#B89BD9', poster: '#E0A64C', contact: '#B58B3E',
  beats: '#D2B077', tiles: '#D2B077', grid: '#D2B077', calendar: '#D2B077', dates: '#D2B077', hub: '#D2B077', beforeafter: '#D2B077', tilegrid: '#D2B077', livefeed: '#D2B077', roles: '#D2B077', curve: '#D2B077', triad: '#D2B077',
}
const AUD: Record<AdAudience, { label: string; brief: string; hint: string }> = {
  owners: { label: 'Owners', brief: 'property owners', hint: 'Sell management: revenue, team, Lighthouse; ends on Nick' },
  partners: { label: 'Partners', brief: 'realtors, lenders and tax advisors who refer owners', hint: 'For referral partners; ends on Nick' },
  guests: { label: 'Guests', brief: 'travellers choosing where to stay in South Florida', hint: 'Sell the stay; ends on Book at stay-hospitality.com' },
}
/** The areas an ad is set in — from its calendar moment (empty = the writer reads the brief). */
const whereOf = (x: AdProject | null | undefined): AreaKey[] => (x && x.moment ? (MOMENTS.find(m => m.key === x.moment)?.where || []) : [])
/** Jon, 2026-11-02: "never use a collage photo ever" — photos captioned as grids/collages are left out. */
const COLLAGE = /collage|grid|mosaic|side[- ]by[- ]side|split view|multiple (photos|images|views)|before.{0,4}after|floor ?plan/i
/** The date block a flyer shows for a calendar moment: 'DEC 4–6' / 'DEC 25'. */
const whenShort = (m: Moment) => { const f = (iso: string) => new Date(iso + 'T12:00:00'); const a = f(m.start), b = f(m.end); const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(); return a.getTime() === b.getTime() ? mo(a) + ' ' + a.getDate() : a.getMonth() === b.getMonth() ? mo(a) + ' ' + a.getDate() + '–' + b.getDate() : mo(a) + ' ' + a.getDate() + ' – ' + mo(b) + ' ' + b.getDate() }
const proxied = (u: string) => (!u ? '' : u.startsWith('/') ? u : /guesty|cloudinary|muscache|pexels|unsplash|staticflickr|rawpixel|wikimedia|openverse|stocksnap|nappy/i.test(u) ? '/api/img-proxy?url=' + encodeURIComponent(u) : u)
const fmtT = (s: number) => { const m = Math.floor(s / 60); const r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) }

function Btn({ on, children, onClick, title, tone, disabled, small }: { on?: boolean; children: React.ReactNode; onClick?: () => void; title?: string; tone?: 'gold' | 'blue' | 'red'; disabled?: boolean; small?: boolean }) {
  const bg = tone === 'gold' ? UI.gold : tone === 'blue' ? UI.blue : tone === 'red' ? 'transparent' : on ? '#2A3442' : 'transparent'
  const fg = tone === 'gold' ? '#1B1408' : tone === 'blue' ? '#fff' : tone === 'red' ? UI.red : on ? UI.ink : UI.mut
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      style={{ background: bg, color: fg, border: '1px solid ' + (tone ? (tone === 'red' ? '#5a2a26' : 'transparent') : on ? '#3A4657' : UI.line), borderRadius: 8, padding: small ? '5px 9px' : '8px 13px', fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
const Label = ({ children }: { children: React.ReactNode }) => <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut, margin: '14px 0 6px' }}>{children}</p>
const field: React.CSSProperties = { boxSizing: 'border-box', width: '100%', background: UI.panel2, color: UI.ink, border: '1px solid ' + UI.line, borderRadius: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.45, fontFamily: 'inherit', resize: 'vertical' }

/** A live thumbnail of THIS ad in a given look/style — the real renderer, one frame. */
function LookPreview({ proj, look, style, assets, w = 168 }: { proj: AdProject; look: string; style?: Partial<AdStyle>; assets: () => AdAssets; w?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [FW, FH] = FORMATS[proj.format]
  const h = Math.round(w * Math.min(1.25, FH / FW))
  const key = JSON.stringify(style || {}) + JSON.stringify(proj.style || {}) + look + proj.id + proj.format + proj.scenes.length
  useEffect(() => {
    let n = 0
    const draw = () => {
      const cv = ref.current; if (!cv) return
      const q: AdProject = { ...proj, look, style: { ...STYLE_DEFAULT, ...(proj.style || {}), ...(style || {}) }, captions: false }
      const T = timeline(q)
      // the first scene with a photo, a beat in, so the type has landed
      let k = q.scenes.findIndex(x => x.photos.length && x.kind !== 'contact')
      if (k < 0) k = 0
      const c2 = document.createElement('canvas'); c2.width = Math.round(540 * FW / Math.max(FW, FH)) * 2; c2.height = Math.round(540 * FH / Math.max(FW, FH)) * 2
      const g = c2.getContext('2d'); if (!g) return
      drawFrame(g, q, T, Math.min(T.total - 0.01, T.starts[k] + Math.min(2.2, T.durs[k] * 0.75)), assets())
      const x = cv.getContext('2d'); if (!x) return
      x.clearRect(0, 0, cv.width, cv.height)
      const s2 = Math.max(cv.width / c2.width, cv.height / c2.height)
      x.drawImage(c2, (cv.width - c2.width * s2) / 2, (cv.height - c2.height * s2) / 2, c2.width * s2, c2.height * s2)
    }
    draw()
    const id = setInterval(() => { draw(); if (++n > 6) clearInterval(id) }, 700)
    return () => clearInterval(id)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={w * 2} height={h * 2} style={{ width: '100%', aspectRatio: `${w}/${h}`, display: 'block', background: '#000' }} />
}

/** A collapsible inspector section (Jon, 2026-11-05: "make features collapsible"). */
function Fold({ id, title, folded, onToggle, children }: { id: string; title: string; folded: boolean; onToggle: (id: string) => void; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid ' + UI.line, marginTop: 12 }}>
      <button type="button" onClick={() => onToggle(id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 0, color: UI.ink, padding: '10px 0 2px', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 10, color: UI.mut, width: 10 }}>{folded ? '▸' : '▾'}</span>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</span>
      </button>
      {folded ? null : <div>{children}</div>}
    </div>
  )
}
/** One labelled option row in a graphic's settings card. */
function FxRow({ name, children }: { name: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4 }}><span style={{ fontSize: 10, color: UI.mut, width: 58, flex: '0 0 58px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{name}</span>{children}</div>
}
export default function AdStudio({ display, body, serif, condensed, elegant, canEdit, canDelete, full }: { display: string; body: string; serif?: string; condensed?: string; elegant?: string; canEdit: boolean; canDelete: boolean; full?: boolean }) {
  const [list, setList] = useState<ListRow[]>([])
  // The front door (Jon, 2026-11-04): start from fresh every time; the last ad is one click away in Your work.
  const [home, setHome] = useState(true)
  // Looks: the six designed ones first; the rest behind More looks (Jon, 2026-11-04: quality over quantity).
  const [moreLooks, setMoreLooks] = useState(false)
  const looksShown = (cur?: string) => moreLooks ? LOOKS : LOOKS.filter(l => LOOKS_FEATURED.indexOf(l.key) >= 0 || l.key === cur)
  const [p, setP] = useState<AdProject | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState<string>('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty' | ''>('')
  const [brief, setBrief] = useState('')
  const [seconds, setSeconds] = useState(30)
  // THE EDITOR, SIMPLER (Jon, 2026-11-10: "audit and fix the ad studio to make it easier to use"): the left panel is
  // gone — one right panel with two tabs (this scene / the whole ad), a one-row top bar with a ⋯ menu, a visual
  // design picker, and undo/redo for every edit.
  const [tab, setTab] = useState<'scene' | 'ad'>('scene')
  const [menu, setMenu] = useState(false)
  const [picker, setPicker] = useState<null | 'change' | 'add'>(null)
  // the transitions and graphics browsers, and where a pick from them goes (this scene, or every scene)
  const [trPick, setTrPick] = useState(false)
  // the post caption writer
  const [capBusy, setCapBusy] = useState<'' | 'instagram' | 'facebook'>('')
  const [capOpts, setCapOpts] = useState<{ label: string; text: string }[]>([])
  const [capCopied, setCapCopied] = useState(false)
  const writeCaption = async (channel: 'instagram' | 'facebook') => {
    const cur = pRef.current; if (!cur) return
    setCapBusy(channel); setErr('')
    const r = await fetch('/api/ads/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: cur, channel }) }).then(x => x.json()).catch(() => null)
    setCapBusy('')
    if (r?.ok && r.options?.length) setCapOpts(r.options)
    else setErr(r?.error || 'The caption writer did not answer. Try again.')
  }
  const [fxPick, setFxPick] = useState(false)
  const [fxAll, setFxAll] = useState(false)
  const [trAll, setTrAll] = useState(false)
  const [moreStart, setMoreStart] = useState(false)
  const [planMusic, setPlanMusic] = useState(false)
  const [ideasOpen, setIdeasOpen] = useState(false)
  /** The ElevenLabs maker, opened where it is needed: under Music (whole ad) or under Sound effect (scene). */
  const [sndOpen, setSndOpen] = useState<'' | 'music' | 'sfx'>('')
  const [lastId, setLastId] = useState('')
  /** Undo / redo: whole-project snapshots. Typing coalesces into one step (a new step after 0.9 s of quiet). */
  const hist = useRef<{ past: AdProject[]; future: AdProject[]; at: number }>({ past: [], future: [], at: 0 })
  const [histN, setHistN] = useState<[number, number]>([0, 0])
  const resetHist = () => { hist.current = { past: [], future: [], at: 0 }; setHistN([0, 0]) }
  /** What a fresh start carries into the ad once it is built (kind, calendar moment) — nothing is saved before that. */
  const startPatch = useRef<Partial<AdProject> | null>(null)
  const [audit, setAudit] = useState<Audit | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  /** The first-pass review shown when an ad is freshly built: score before → after the touch-up, and what changed. */
  const [firstPass, setFirstPass] = useState<{ before: number; after: number; changes: string[] } | null>(null)
  const [safe, setSafe] = useState(true)
  /** Scenes picked together (Jon, 2026-11-05: "highlight scenes so I can apply changes to all — leaves falling on all of them").
   *  By id, so reordering keeps the pick. Shift / ⌘-click on the timeline or the script, or the tick on a script line. */
  const [picked, setPicked] = useState<string[]>([])
  /** Collapsed inspector sections, remembered per browser. */
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  // The rarely-used sections start closed; anything you have opened or closed yourself is remembered.
  useEffect(() => { let saved: Record<string, boolean> = {}; try { const v = localStorage.getItem('ads.folded'); if (v) saved = JSON.parse(v) || {} } catch { /* fine */ } setFolded({ motion: true, graphics: true, sound: true, style: true, brief: true, voice: true, ...saved }) }, [])
  const toggleFold = (id: string) => setFolded(f => { const n = { ...f, [id]: !f[id] }; try { localStorage.setItem('ads.folded', JSON.stringify(n)) } catch { /* fine */ } return n })
  const setAllFolds = (v: boolean) => setFolded(f => { const n: Record<string, boolean> = { ...f }; (tab === 'scene' ? ['ai', 'design', 'custom', 'motion', 'words', 'photos', 'graphics', 'sound'] : ['format', 'look', 'music', 'voice', 'style', 'brief']).forEach(k => (n[k] = v)); try { localStorage.setItem('ads.folded', JSON.stringify(n)) } catch { /* fine */ } return n })
  /** Script beside the player (Jon, 2026-11-04: "the script the most important part of walking through the video ads"). */
  const [beside, setBeside] = useState(true)
  useEffect(() => { try { const v = localStorage.getItem('ads.scriptBeside'); if (v != null) setBeside(v === '1') } catch { /* fine */ } }, [])
  const toggleBeside = () => { const v = !beside; setBeside(v); try { localStorage.setItem('ads.scriptBeside', v ? '1' : '0') } catch { /* fine */ } }
  const [versions, setVersions] = useState<{ ts: string; name: string; scenes: number; by: string; look: string }[] | null>(null)
  const [options, setOptions] = useState<{ id: string; list: { head: string; vo: string }[] } | null>(null)
  const safeRef = useRef<HTMLCanvasElement>(null)
  const [sounds, setSounds] = useState<Sound[]>([])
  const [sndKind, setSndKind] = useState<'music' | 'sfx'>('music')
  const [sndPrompt, setSndPrompt] = useState('')
  const [sndSecs, setSndSecs] = useState(30)
  const [sndName, setSndName] = useState('')
  const [hear, setHear] = useState('') // the clip being previewed (music, sound or voice sample)
  const [ask, setAsk] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  // The "new ad" chooser (Jon, 2026-11-02: "when you select new ad it should let you decide how you
  // want to create it — prompt it, new visual, revamp, music vibe and goal").
  const [starting, setStarting] = useState(false)
  const [draft, setDraft] = useState<{ name: string; scenes: AdScene[]; settings: Plan['settings']; note: string } | null>(null)
  const [st, setSt] = useState<{ mode: 'describe' | 'script' | 'template' | 'revamp' | 'blank' | 'story'; prompt: string; goal: string; music: string; vibe: string; look: string; format: AdFormat | ''; from: string; audience: AdAudience; who: string; why: string; script: string }>({ mode: 'describe', prompt: '', goal: 'bookings', music: '', vibe: '', look: DEFAULT_LOOK, format: '', from: '', audience: 'guests', who: '', why: '', script: '' })
  const seed = useRef<{ fresh: boolean; look: string; goal: string; music: string; vibe: string; patch?: Partial<AdProject> } | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [planNote, setPlanNote] = useState('')
  const [adAsk, setAdAsk] = useState('')
  const [undo, setUndo] = useState<{ id: string; scene: AdScene } | null>(null)
  const [vq, setVq] = useState('')
  const [vGender, setVGender] = useState('')
  const [vHits, setVHits] = useState<LibVoice[] | null>(null)
  const [vBusy, setVBusy] = useState(false)
  const [lib, setLib] = useState<LibVideo[]>([])
  const [libPct, setLibPct] = useState<number | null>(null)
  const [watch, setWatch] = useState<LibVideo | null>(null)
  const [keepCopy, setKeepCopy] = useState(true)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  // Where photos come from: our library, or licensed stock (Jon, 2026-11-04) — or generated (2026-11-12).
  const [photoSrc, setPhotoSrc] = useState<'library' | 'stock' | 'video' | 'ai'>('library')
  // AI IMAGES (2026-11-12, Jon: "more imagery generations to highlight the events"): the Generate tab's prompt, how
  // many to make, the last results (up to 4), a note (no key / budget / refused), the key-missing state, the batch.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiN, setAiN] = useState<1 | 2 | 4>(2)
  const [aiHits, setAiHits] = useState<Hit[]>([])
  const [aiNote, setAiNote] = useState('')
  const [aiOff, setAiOff] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiBatch, setAiBatch] = useState('')
  const [stockNote, setStockNote] = useState('')
  const [searching, setSearching] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // FITS THE SCREEN (Jon, 2026-11-10: "the way it fits the screen"): the editor is one screen tall — the player takes
  // whatever room is left and is measured, so the picture is always whole and as large as it can be.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 640, h: 360 })
  useEffect(() => {
    if (!stageEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(es => { const r = es[0].contentRect; if (r.width > 20 && r.height > 20) setBox({ w: Math.floor(r.width), h: Math.floor(r.height) }) })
    ro.observe(stageEl)
    return () => ro.disconnect()
  }, [stageEl])
  /** The big preview: the player alone, edge to edge, with the same controls (Esc closes). */
  const [theater, setTheater] = useState(false)
  /** True only while the editor itself is on screen with nothing over it — the keyboard shortcuts act then, and only then. */
  const keysOn = useRef(false)
  const theaterRef = useRef(false)
  const imgs = useRef<Record<string, HTMLImageElement>>({})
  const logo = useRef<HTMLImageElement | null>(null)
  const logos = useRef<{ gold: HTMLImageElement | null; black: HTMLImageElement | null; white: HTMLImageElement | null }>({ gold: null, black: null, white: null })
  const actx = useRef<AudioContext | null>(null)
  const voiceBuf = useRef<{ url: string; buf: AudioBuffer } | null>(null)
  const musicBuf = useRef<Record<string, AudioBuffer>>({})
  const play0 = useRef<{ at: number; from: number; nodes: AudioScheduledSourceNode[] } | null>(null)
  const pRef = useRef<AdProject | null>(null)
  const tRef = useRef(0)
  const saveTimer = useRef<any>(null)
  const vids = useRef<Record<string, HTMLVideoElement>>({})
  const libRef = useRef<LibVideo[]>([])
  const sndRef = useRef<Sound[]>([])
  const sfxBuf = useRef<Record<string, AudioBuffer>>({})
  const previewEl = useRef<HTMLAudioElement | null>(null)
  const live = useRef(false) // true while playing or exporting: videos run instead of seeking
  libRef.current = lib
  sndRef.current = sounds
  pRef.current = p
  tRef.current = t

  const tl = useMemo(() => (p ? timeline(p) : null), [p])
  const stale = !!(p && p.voice && p.voice.sig !== voiceSig(p))
  const hasVoice = !!(p && p.voice && !stale)

  // ── loading ───────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    const r = await fetch('/api/ads').then(x => x.json()).catch(() => null)
    if (r?.ok) setList(r.projects || [])
  }, [])
  const open = useCallback(async (id: string, quiet?: boolean) => {
    stop()
    setPicked([])
    const r = await fetch('/api/ads?id=' + encodeURIComponent(id)).then(x => x.json()).catch(() => null)
    if (!r?.ok) {
      // The last ad opened was deleted: forget it quietly instead of showing an error on arrival.
      if (quiet) { try { localStorage.removeItem('adstudio.last') } catch { /* fine */ } return }
      setErr(r?.error || 'Could not open that ad.'); return
    }
    setErr(''); setPlan(null); setDraft(null); setStarting(false); setShowAudit(false); setFirstPass(null); setAudit(null); setMenu(false); resetHist()
    setP(r.project); pRef.current = r.project; setAudioUrl(r.audioUrl || null); setSel(0); setT(1.6); setSaved('saved'); setBrief(r.project.prompt || '')
    try { localStorage.setItem('adstudio.last', id) } catch { /* fine */ }
    setLastId(id); setTab('scene'); try { if (panelRef.current) panelRef.current.scrollTop = 0 } catch { /* fine */ }
    setHome(false); try { window.scrollTo(0, 0) } catch { /* fine */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadList()
    try { setLastId(localStorage.getItem('adstudio.last') || '') } catch { /* fine */ }
    const l = new Image(); l.src = '/ads/stay-logo-gold.png'; l.onload = () => { logo.current = l; logos.current.gold = l }
    ;(['black', 'white'] as const).forEach(c => { const im = new Image(); im.src = '/ads/stay-logo-' + c + '.png'; im.onload = () => { logos.current[c] = im } })
    loadLib(); loadSounds()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const newAd = async (): Promise<AdProject | null> => {
    setBusy('new'); setErr('')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'Could not start a new ad.'); return null }
    stop(); resetHist(); setP(r.project); pRef.current = r.project; setAudioUrl(null); setSel(0); setT(1.6); setSaved('saved'); setBrief('')
    setLastId(r.project.id); try { localStorage.setItem('adstudio.last', r.project.id) } catch { /* fine */ }
    loadList()
    return r.project
  }
  /** Videos library → Edit this video: an editable copy of a built-in sales video, opened in the editor. */
  const editLibraryVideo = async (key: string, existingId?: string) => {
    // The editable copy you already have opens as it is — every press used to make another copy.
    if (existingId) { await open(existingId); return }
    setBusy('import'); setErr('')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromLibrary: key }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'Could not open that video for editing.'); return }
    await loadList(); await open(r.project.id)
  }
  /** The start page for a video or a story. Nothing is created until it is built. */
  const openStart = (mode: typeof st.mode = 'describe') => {
    stop(); setPlan(null); setErr(''); setDraft(null); setShowAudit(false); setFirstPass(null); setMoreStart(false); setIdeasOpen(false); setMenu(false)
    startPatch.current = { kind: mode === 'story' ? 'story' : 'video' }
    setSt(x => ({ ...x, mode, prompt: '', vibe: '', from: '', who: '', why: '', script: '', music: '', format: '', look: DEFAULT_LOOK, goal: 'bookings', audience: 'guests' }))
    setStarting(true); setHome(false); try { window.scrollTo(0, 0) } catch { /* fine */ }
  }
  /** Leave the start / plan / script pages without building. */
  const cancelFlow = () => { const fresh = !!seed.current?.fresh || starting || !pRef.current; setStarting(false); setPlan(null); setDraft(null); seed.current = null; setErr(''); if (fresh) { setHome(true); loadList() } }
  /** The areas this build is set in: the moment being started, else the open ad's. */
  const whereNow = (): AreaKey[] => { const mk = seed.current?.fresh ? seed.current?.patch?.moment : pRef.current?.moment; return mk ? (MOMENTS.find(m => m.key === mk)?.where || []) : [] }
  const goalOf = (k: string) => GOALS.find(g => g.key === k)
  /** EVENT AD (2026-11-12): the calendar event an ad is built as three acts for — an ad that already has acts, or a
   *  build started from an event with the Event goal. Undefined = an ordinary ad (the writer may still spot "event ad"). */
  const eventKeyOf = (x: AdProject | null | undefined): string | undefined => (x && x.moment && eventByKey(x.moment) && (x.scenes.some(y => y.act) || x.goal === 'event') ? x.moment : undefined)
  /** A rewritten event ad keeps the AI pictures already made (they cost money): the n-th scene of an act takes the
   *  n-th old scene's generated image. Book scenes are left to the writer's own photo pick. */
  const keepAi = (old: AdProject, next: AdScene[]): AdScene[] => next.map((x, i) => {
    if (!x.act || x.act === 'book') return x
    const k = next.slice(0, i).filter(y => y.act === x.act).length
    const o = old.scenes.filter(y => y.act === x.act)[k]
    return o && o.src === 'ai' && !o.aiPending && o.photos.length ? { ...x, photos: o.photos.slice(), src: 'ai' as const, aiPending: false, imgPrompt: o.imgPrompt } : x
  })
  const eventNow = (): string | undefined => {
    const sd = seed.current
    if (sd?.fresh) { const mk = sd.patch?.moment; return mk && sd.goal === 'event' && eventByKey(mk) ? mk : undefined }
    return eventKeyOf(pRef.current)
  }
  /** Brief extras the chooser adds: goal, music vibe and look, in words the planner and writer use. */
  const seedLines = () => [goalOf(st.goal)?.brief || '', st.why.trim() ? 'What we are trying to accomplish: ' + st.why.trim() + '.' : '', 'Audience: ' + AUD[st.audience].brief + (st.who.trim() ? ', specifically ' + st.who.trim() : '') + '.', st.vibe.trim() ? 'Music vibe: ' + st.vibe.trim() + '.' : st.music ? 'Music vibe: ' + (MUSIC.find(m => m.key === st.music)?.mood || '') + '.' : '', 'Visual style: ' + (LOOKS.find(l => l.key === st.look)?.blurb || '') + '.'].filter(Boolean).join(' ')
  /** After an ad is built from the chooser: generate the described music vibe with ElevenLabs. */
  const vibeTrack = async (vibe: string) => {
    if (!vibe.trim()) return
    const r = await fetch('/api/ads/sounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'music', prompt: vibe, seconds: 60, name: vibe.slice(0, 40) }) }).then(x => x.json()).catch(() => null)
    if (!r?.ok) { setErr('The ad is ready, but the new music vibe was not made: ' + (r?.error || 'no answer') + ' It is using a playlist track for now.'); return }
    setSounds(r.sounds || [])
    const mine = (r.sounds || []).find((x: any) => x.kind === 'music')
    if (mine) change(d => ({ ...d, music: mine.key }))
  }
  /** Describe it → the plan to confirm (or, skipping the plan, straight to the build). */
  const goPlan = async (skip?: boolean) => {
    if (!st.prompt.trim()) { setErr('Say what the ad is about first — even one line, e.g. a cool video for Amrit.'); return }
    setErr('')
    seed.current = { fresh: true, look: st.look, goal: st.goal, music: st.music, vibe: st.vibe, patch: startPatch.current || undefined }
    const text = st.prompt.trim()
    setBrief(text)
    if (skip) {
      const set = { audience: st.audience, format: (st.format || '9:16') as AdFormat, seconds, music: st.music }
      setBusy('write')
      const w = await writeScenes(text + '\n\n' + seedLines(), set)
      if (w) { await applyScenes(w.name, w.scenes, set, text); setStarting(false) }
      setBusy('')
      return
    }
    if (await planAd(text + '\n\n' + seedLines(), { audience: st.audience, format: st.format || undefined })) setStarting(false)
  }
  /** Revamp an ad we made, or start blank. */
  const startGo = async () => {
    const look = st.look, music = st.music, vibe = st.vibe
    if (st.mode === 'revamp') {
      if (!st.from) { setErr('Pick the ad to revamp.'); return }
      const src = await fetch('/api/ads?id=' + encodeURIComponent(st.from)).then(x => x.json()).catch(() => null)
      if (!src?.ok) { setErr('Could not open that ad.'); return }
      const S: AdProject = src.project
      const n = await newAd(); if (!n) return
      setStarting(false); setBusy('adask')
      let scenes = S.scenes.map(x => ({ ...x, items: x.items.slice(), photos: x.photos.slice() }))
      const base: AdProject = { ...n, kind: S.kind || 'video', name: S.name + ' · revamp', format: (st.format || S.format) as AdFormat, audience: st.audience, music: music || S.music, look, goal: st.goal, contact: S.contact, captions: S.captions, voiceId: S.voiceId, voiceName: S.voiceName, voiceSettings: S.voiceSettings, moment: S.moment, scenes }
      const ask = 'REVAMP THIS AD: keep what works, make it fresher and stronger. ' + (st.prompt.trim() ? 'What to change: ' + st.prompt.trim() + '. ' : '') + seedLines()
      const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: ask, seconds, audience: AUD[base.audience].brief, format: base.format, current: base, where: whereOf(base) }) }).then(x => x.json()).catch(() => null)
      setBusy('')
      if (r?.ok && r.scenes?.length) scenes = r.scenes
      else setErr('Copied the ad, but the rewrite did not come back — it is the original scenes for now. Try "Change the whole ad".')
      change(() => ({ ...base, prompt: st.prompt, scenes }))
      setSel(0); setT(1.6)
      vibeTrack(vibe)
      return
    }
    const n = await newAd(); if (!n) return
    change(d => ({ ...d, kind: 'video', look, goal: st.goal, audience: st.audience, music: music || d.music, format: (st.format || d.format) as AdFormat }))
    setStarting(false); setTab('scene')
    vibeTrack(vibe)
  }
  /** A ready layout, filled with our photos — a new ad every time. */
  const startTemplate = async (tp: AdTemplate) => {
    if (!canEdit || busy) return
    const n = await newAd(); if (!n) return
    setStarting(false)
    await applyTemplate(tp, true)
    change(d => ({ ...d, kind: 'video' })); resetHist()
  }

  // ── editing + autosave ────────────────────────────────────────────────
  const change = (fn: (d: AdProject) => AdProject) => {
    if (!canEdit) return
    // Undo: keep the state before this edit. A run of quick edits (typing, a slider) is one step.
    const cur0 = pRef.current, H = hist.current, now = Date.now()
    if (cur0 && (now - H.at > 900 || !H.past.length)) { H.past.push(cur0); if (H.past.length > 80) H.past.shift() }
    H.at = now; H.future = []
    setHistN([H.past.length, 0])
    setP(cur => (cur ? fn(cur) : cur))
    setSaved('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1200)
  }
  const stepHist = (back: boolean) => {
    if (!canEdit) return
    const H = hist.current, cur = pRef.current
    const from = back ? H.past : H.future, to = back ? H.future : H.past
    if (!cur || !from.length) return
    const prev = from.pop()!
    if (prev.id !== cur.id) { resetHist(); return }
    to.push(cur); H.at = 0
    stop(); setP(prev); pRef.current = prev
    setSel(i => Math.max(0, Math.min(i, prev.scenes.length - 1))); setPicked([]); setUndo(null)
    setHistN([H.past.length, H.future.length])
    setSaved('dirty'); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 600)
  }
  const save = async () => {
    const cur = pRef.current
    if (!cur || !canEdit) return
    setSaved('saving')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: cur }) }).then(x => x.json()).catch(() => null)
    if (r?.ok) { setSaved(pRef.current === cur ? 'saved' : 'dirty'); setList(l => l.map(x => (x.id === cur.id ? { ...x, name: cur.name, format: cur.format, scenes: cur.scenes.length, updatedAt: r.project.updatedAt } : x))) }
    else { setSaved('dirty'); setErr(r?.error || 'Save failed — your changes are still here; try again.') }
  }
  const setScene = (i: number, patch: Partial<AdScene>) => change(d => ({ ...d, scenes: d.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  /** The scenes a design / motion / graphics / sound change goes to: the picked ones (plus the one open), else the one open. */
  const targetIdx = (): number[] => {
    const cur = pRef.current; if (!cur) return [sel]
    if (!picked.length) return [sel]
    const out = cur.scenes.map((x, k) => (picked.indexOf(x.id) >= 0 || k === sel ? k : -1)).filter(k => k >= 0)
    return out.length ? out : [sel]
  }
  const setMany = (fn: (s: AdScene, i: number) => Partial<AdScene>) => { const t = targetIdx(); change(d => ({ ...d, scenes: d.scenes.map((s, k) => (t.indexOf(k) >= 0 ? { ...s, ...fn(s, k) } : s)) })) }
  /** A transition change: to the scene(s) being edited, or — from the browser with "All scenes" on — every scene change. */
  const setTr = (patch: Partial<AdScene>, all = false) => {
    if (all) change(d => ({ ...d, scenes: d.scenes.map((x, k) => (k > 0 ? { ...x, ...patch } : x)) }))
    else setMany(() => patch)
    const T = tl; if (T && !play0.current) setT(T.starts[sel] - 0.15 + (patch.tr ? 0.4 : 0))
  }
  /** A graphics change: to the scene(s) being edited, or to every scene when "All scenes" is on. */
  const setFx = (fn: (s: AdScene) => Partial<AdScene>) => {
    if (fxAll) change(d => ({ ...d, scenes: d.scenes.map(x => ({ ...x, ...fn(x) })) }))
    else setMany(fn)
  }
  const toggleFx = (k: string) => {
    const has = (sc0: AdScene) => (sc0.fx || []).indexOf(k) >= 0
    const cur = pRef.current?.scenes[sel]
    const turnOn = !(cur && has(cur))
    setFx(x => turnOn
      ? { fx: (x.fx || []).filter(y => y !== k).concat([k]).slice(-6), fxo: { ...(x.fxo || {}), ...(cur?.fxo && cur.fxo[k] ? { [k]: { ...cur.fxo[k] } } : {}) } }
      : (() => { const o = { ...(x.fxo || {}) }; delete o[k]; return { fx: (x.fx || []).filter(y => y !== k), fxo: o } })())
  }
  const togglePick = (i: number) => { const cur = pRef.current; if (!cur) return; const id = cur.scenes[i]?.id; if (!id) return
    setPicked(ps => { const base = ps.length ? ps : (cur.scenes[sel] ? [cur.scenes[sel].id] : []); return base.indexOf(id) >= 0 ? base.filter(x => x !== id) : base.concat([id]) }) }
  const pickAll = () => { const cur = pRef.current; if (cur) setPicked(cur.scenes.map(x => x.id)) }
  const move = (from: number, to: number) => {
    if (!p || from === to || to < 0 || to >= p.scenes.length) return
    change(d => { const a = d.scenes.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...d, scenes: a } })
    setSel(to)
  }
  const addScene = (kind: AdKind) => {
    if (!p) return
    const at = Math.min(p.scenes.length, sel + 1)
    change(d => { const a = d.scenes.slice(); a.splice(at, 0, { id: newSceneId(d), kind, vo: '', head: '', sub: '', items: [], photos: [] }); return { ...d, scenes: a } })
    setSel(at)
  }
  const dupScene = () => { if (!p) return; const s = p.scenes[sel]; change(d => { const a = d.scenes.slice(); a.splice(sel + 1, 0, { ...s, id: newSceneId(d), items: s.items.slice(), photos: s.photos.slice() }); return { ...d, scenes: a } }); setSel(sel + 1) }
  const delScene = () => { if (!p || p.scenes.length < 2) return; change(d => ({ ...d, scenes: d.scenes.filter((_, k) => k !== sel) })); setSel(Math.max(0, sel - 1)) }
  const delSceneAt = (i: number) => { const cur = pRef.current; if (!cur || cur.scenes.length < 2) return; change(d => ({ ...d, scenes: d.scenes.filter((_, k) => k !== i) })); setSel(Math.max(0, Math.min(i, cur.scenes.length - 2))) }
  // Shorter / longer: nudges the scene's hold by half a second from what it is now (auto or set).
  const nudge = (i: number, by: number) => { if (!p || !tl) return; const cur = p.scenes[i].dur && p.scenes[i].dur! > 0 ? p.scenes[i].dur! : tl.durs[i]; const next = Math.round(Math.max(1, Math.min(30, cur + by)) * 2) / 2; change(d => { const a = d.scenes.slice(); a[i] = { ...a[i], dur: next }; return { ...d, scenes: a } }) }
  // Cut the whole ad to a target length: every scene's hold scaled down together (never under 1.2 s), end card keeps ≥ 2.5 s.
  const cutTo = (seconds: number) => { if (!p || !tl || tl.total <= seconds) return; const k = seconds / tl.total; change(d => ({ ...d, scenes: d.scenes.map((s, i) => { const cur = s.dur && s.dur > 0 ? s.dur : tl.durs[i]; const min = i === d.scenes.length - 1 ? 2.5 : 1.2; return { ...s, dur: Math.round(Math.max(min, cur * k) * 2) / 2 } }) })) }

  // ── AI: write / rewrite ───────────────────────────────────────────────
  const write = async (rewrite: boolean, change_?: string) => {
    if (!p) return
    setBusy(change_ ? 'adask' : rewrite ? 'rewrite' : 'write'); setErr('')
    const prompt = change_ ? (brief ? brief + '\n\n' : '') + 'CHANGE REQUESTED FOR THE WHOLE AD (keep everything else): ' + change_ : brief
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds, audience: AUD[p.audience].brief, format: p.format, current: rewrite ? p : null, where: whereOf(p), eventKey: eventKeyOf(p) }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The writer did not answer. Try again.'); return }
    if (r.warnings?.length) setErr('Fact check: ' + r.warnings.join(' · '))
    { const d0 = pRef.current || p; finishBuild({ ...d0, prompt: brief, name: d0.name === 'Untitled ad' && r.name ? r.name : d0.name, scenes: eventKeyOf(d0) ? keepAi(d0, r.scenes) : r.scenes }) }
    setSel(0); setT(1.6); setUndo(null)
    if (change_) setAdAsk('')
  }
  // ── plan first: sharpen the brief and confirm the details before anything is built ──
  const planAd = async (override?: string, opt?: { audience?: AdAudience; format?: AdFormat }): Promise<boolean> => {
    const b = override || brief
    if (!b.trim()) { setErr('Write a line about the ad first, e.g. "a cool video for Amrit".'); return false }
    if (!override) seed.current = null
    stop(); setBusy('plan'); setErr('')
    const r = await fetch('/api/ads/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: b, seconds, format: opt?.format || p?.format || '16:9', audience: opt?.audience || p?.audience || 'owners' }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok || !r.plan) { setErr(r?.error || 'Could not plan that one. Try again.'); return false }
    const pl: Plan = r.plan
    // What was picked in the chooser wins over the planner's suggestion.
    const sd = seed.current
    if (sd?.music) pl.settings.music = sd.music
    if (opt?.format) pl.settings.format = opt.format
    setPlan(pl); setPlanNote(''); setShowAudit(false)
    setAnswers(Object.fromEntries(pl.questions.map(q => [q.id, q.options[0]])))
    return true
  }
  /** Rethink the plan with the answers and any note so far. */
  const replan = async () => {
    if (!plan) return
    const extra = plan.questions.map(q => `${q.q} → ${answers[q.id] || q.options[0]}`).join('\n') + (planNote.trim() ? '\nAlso: ' + planNote.trim() : '')
    setBusy('plan'); setErr('')
    const r = await fetch('/api/ads/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: plan.brief + '\n\nDECIDED SO FAR:\n' + extra, seconds: plan.settings.seconds, format: plan.settings.format, audience: plan.settings.audience }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok || !r.plan) { setErr(r?.error || 'Could not rethink it. Try again.'); return }
    setPlan(r.plan); setPlanNote('')
    setAnswers(Object.fromEntries(r.plan.questions.map((q: any) => [q.id, q.options[0]])))
  }
  /** Build the ad from the confirmed plan: settings applied, then the writer works from the sharpened brief. */
  /** The writer's prompt for a confirmed plan. */
  const planPromptText = (pl: Plan) => [
    pl.brief,
    pl.property ? `PROPERTY: ${pl.property}. Every photoQuery must name it (e.g. "${pl.property.split(/\s+/)[0].toLowerCase()} pool") so the photos are of this property only.` : '',
    pl.angle ? 'ANGLE: ' + pl.angle : '', pl.hook ? 'OPEN WITH: ' + pl.hook : '',
    pl.questions.length ? 'DECISIONS:\n' + pl.questions.map(q => `- ${q.q} → ${answers[q.id] || q.options[0]}`).join('\n') : '',
    planNote.trim() ? 'ALSO: ' + planNote.trim() : '',
    pl.outline.length ? 'FOLLOW THIS SCENE OUTLINE:\n' + pl.outline.join('\n') : '',
  ].filter(Boolean).join('\n\n')
  /** Ask the writer for scenes. */
  const writeScenes = async (prompt: string, set: Plan['settings'], current?: AdProject | null): Promise<{ name: string; scenes: AdScene[] } | null> => {
    setErr('')
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds: set.seconds, audience: AUD[set.audience].brief, format: set.format, current: current || null, where: whereNow(), eventKey: eventNow() }) }).then(x => x.json()).catch(() => null)
    if (!r?.ok || !r.scenes?.length) { setErr(r?.error || 'The writer did not answer. Try again.'); return null }
    if (r.warnings?.length) setErr('Fact check: ' + r.warnings.join(' · '))
    return { name: r.name || '', scenes: r.scenes }
  }
  /** Put finished scenes into an ad (a new one when the guide started it), with the chosen settings. */
  const applyScenes = async (name: string, scenes: AdScene[], set: Plan['settings'], promptText?: string) => {
    const sd = seed.current
    let base = sd?.fresh ? null : pRef.current
    if (!base) {
      const n = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
      if (!n?.ok) { setErr(n?.error || 'Could not start a new ad.'); return }
      base = n.project as AdProject
      setP(base); pRef.current = base; setAudioUrl(null); loadList()
    }
    setSeconds(set.seconds)
    const d0 = pRef.current || base
    const pt = sd?.patch || {}
    // The platform follows the shape that was chosen (a Reel start that became 16:9 is a web video).
    const plat = PLATFORMS.find(x => x.key === (pt.platform || d0.platform) && x.format === set.format)?.key || PLATFORMS.find(x => x.format === set.format)?.key || d0.platform
    finishBuild({ ...d0, ...pt, platform: plat, prompt: promptText ?? brief, name: name || d0.name, audience: set.audience, format: set.format, music: set.music || d0.music, look: sd?.look || d0.look, goal: sd?.goal || d0.goal, scenes })
    setPlan(null); setDraft(null); setStarting(false); setHome(false); setTab('scene'); setSel(0); setT(1.6); setUndo(null)
    if (sd?.fresh) resetHist()
    seed.current = null
    if (sd?.vibe) vibeTrack(sd.vibe)
  }
  const buildFromPlan = async () => {
    if (!plan) return
    setBusy('write')
    const w = await writeScenes(planPromptText(plan), plan.settings)
    setBusy('')
    if (w) await applyScenes(plan.name || w.name, w.scenes, plan.settings)
  }
  /** Jon, 2026-11-02: "should also be able to generate a script and use that to build out the video".
   *  The writer's scenes come back as a script to read and edit first; Build turns it into the video. */
  const scriptFromPlan = async () => {
    if (!plan) return
    setBusy('script')
    const w = await writeScenes(planPromptText(plan), plan.settings)
    setBusy('')
    if (w) setDraft({ name: plan.name || w.name, scenes: w.scenes, settings: plan.settings, note: '' })
  }
  const rewriteDraft = async () => {
    if (!draft) return
    setBusy('script')
    const cur = { ...(pRef.current || ({} as any)), scenes: draft.scenes, audience: draft.settings.audience, format: draft.settings.format } as AdProject
    const w = await writeScenes('Rewrite this script. ' + (draft.note.trim() ? 'What to change: ' + draft.note.trim() : 'Make it tighter and stronger.') + (plan ? '\n\n' + planPromptText(plan) : ''), draft.settings, cur)
    setBusy('')
    if (w) setDraft({ ...draft, scenes: w.scenes, note: '' })
  }
  const copyScript = () => {
    if (!draft) return
    const txt = draft.name + '\n\n' + draft.scenes.map((x, k) => `SCENE ${k + 1} · ${KINDS.find(q => q.kind === x.kind)?.label || x.kind}\nVO: ${x.vo || '(music only)'}\nON SCREEN: ${x.head.replace(/\*\*/g, '').replace(/\n/g, ' / ')}${x.items.length ? '\nROWS: ' + x.items.join(' · ') : ''}`).join('\n\n')
    try { navigator.clipboard.writeText(txt) } catch { /* fine */ }
  }
  /** A pasted script → scenes, keeping the spoken words. */
  const layOutScript = async () => {
    if (!st.script.trim()) { setErr('Paste the script first.'); return false }
    const set = { audience: st.audience, format: (st.format || '16:9') as AdFormat, seconds: Math.max(15, Math.min(90, Math.round(st.script.trim().split(/\s+/).length / 2.5 / 15) * 15 || 30)), music: st.music }
    seed.current = { fresh: true, look: st.look, goal: st.goal, music: st.music, vibe: st.vibe, patch: startPatch.current || undefined }
    setBrief(st.prompt || 'From a script')
    setBusy('script')
    const w = await writeScenes('LAY OUT THIS SCRIPT AS SCENES. Keep the spoken words exactly as written (only split them across scenes; fix nothing but obvious typos). Choose the scene kinds, on-screen headlines and photoQuery words that fit each line.\n\n' + seedLines() + '\n\nTHE SCRIPT:\n' + st.script.trim(), set)
    setBusy('')
    if (!w) return false
    setDraft({ name: w.name || 'Scripted ad', scenes: w.scenes, settings: set, note: '' })
    return true
  }

  /** A vibe: look + style + graphics on every scene + music, in one tap. */
  const applyVibe = (v: typeof VIBES[number]) => {
    change(d => ({ ...d, look: v.look, music: v.music, style: { ...STYLE_DEFAULT, ...v.style }, scenes: d.scenes.map(x => ({ ...x, fx: v.fx.slice(), fxo: {}, tr: 'auto' as AdTransition })) }))
    if (tl) setT(tl.starts[Math.min(1, tl.starts.length - 1)] + 1.6)
  }
  /** Jon: "a wide range of styles and looks" — one tap for a fresh combination. */
  const surprise = () => {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
    const look = pick(LOOKS.filter(l => l.key !== (pRef.current?.look || DEFAULT_LOOK))).key
    const style: AdStyle = {
      font: pick(['auto', 'auto', 'sans', 'serif', 'condensed', 'elegant'] as AdStyle['font'][]),
      caps: pick(['auto', 'auto', 'on'] as AdStyle['caps'][]),
      grade: pick(['auto', 'auto', 'warm', 'cool', 'vivid', 'faded', 'mono'] as AdStyle['grade'][]),
      pace: pick(['normal', 'normal', 'calm', 'fast'] as AdStyle['pace'][]),
      finish: pick(['auto', 'auto', 'film', 'glow', 'soft'] as AdStyle['finish'][]),
      frame: pick(['none', 'none', 'border', 'letterbox'] as AdStyle['frame'][]),
      logo: 'auto',
    }
    change(d => ({ ...d, look, style, scenes: d.scenes.map(x => ({ ...x, tr: 'auto' as AdTransition })) }))
    if (tl) setT(tl.starts[Math.min(1, tl.starts.length - 1)] + 1.6)
  }

  /** FIRST PASS (Jon, 2026-11-04: "we need a view, an audit and overall touch-up when videos are first generated").
   *  Every freshly built ad is touched up (end card, captions, calm transitions, no repeated photos, varied designs,
   *  gold accents, pacing), then the review opens: the score before → after, what changed, the expert pass running. */
  const finishBuild = (built: AdProject) => {
    const facts = built.audience === 'guests' ? GUEST_FACTS : HOUSE_FACTS
    const before = auditScore(auditAd(built, timeline(built), facts))
    const fp = polishAd(built)
    const after = auditScore(auditAd(fp.project, timeline(fp.project), facts))
    change(() => fp.project)
    setFirstPass({ before, after, changes: fp.changes }); setAudit(null); setShowAudit(true)
    if ((fp.project.kind || 'video') !== 'flyer') runAudit(fp.project)
  }
  // ── the expert audit (Jon, 2026-11-03: "as an ad expert, audit this") ─────
  const liveChecks = useMemo(() => (p && tl ? auditAd(p, tl, p.audience === 'guests' ? GUEST_FACTS : HOUSE_FACTS) : []), [p, tl])
  const runAudit = async (proj?: AdProject) => {
    const target = proj || p
    if (!target) return
    setBusy('audit'); setErr(''); setShowAudit(true)
    const r = await fetch('/api/ads/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: target }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The audit did not come back. Try again.'); return }
    setAudit(r)
  }
  const applyIssue = (k: number) => {
    if (!audit) return
    const is = audit.issues[k]; if (!is || is.done) return
    if (is.remove) change(d => ({ ...d, scenes: d.scenes.length > 1 ? d.scenes.filter((_, i) => i !== is.scene) : d.scenes }))
    else if (is.patch) change(d => ({ ...d, scenes: d.scenes.map((x, i) => (i === is.scene ? { ...x, ...is.patch } : x)) }))
    setAudit({ ...audit, issues: audit.issues.map((x, i) => (i === k ? { ...x, done: true } : x)) })
  }
  const applyCheck = (c: AuditIssue) => {
    if (!c.fix) return
    change(d => ({ ...d, ...(c.fix!.project || {}), scenes: c.scene != null && c.fix!.scene ? d.scenes.map((x, i) => (i === c.scene ? { ...x, ...c.fix!.scene } : x)) : d.scenes }))
  }
  // ── versions ──
  const loadVersions = async () => {
    if (!p) return
    const r = await fetch('/api/ads/versions?id=' + encodeURIComponent(p.id)).then(x => x.json()).catch(() => null)
    setVersions(r?.ok ? r.versions : [])
  }
  const restore = async (ts: string) => {
    if (!p || !window.confirm('Go back to this version? The current state is kept as a version too.')) return
    const r = await fetch('/api/ads/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, ts }) }).then(x => x.json()).catch(() => null)
    if (!r?.ok) { setErr(r?.error || 'Could not restore.'); return }
    stop(); resetHist(); setP(r.project); pRef.current = r.project; setAudioUrl(r.audioUrl || null); setSaved('saved'); setVersions(null); setSel(0); setT(1.6); setAudit(null)
  }
  // ── three headline options for the selected scene ──
  const headOptions = async () => {
    if (!p || !sc) return
    setBusy('options'); setErr('')
    const r = await fetch('/api/ads/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: p, index: sel, options: true }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'No options came back.'); return }
    setOptions({ id: sc.id, list: r.options || [] })
  }
  // ── duplicate the whole ad (an A/B variant) ──
  const duplicateAd = async (plat?: string) => {
    if (!p) return
    const pf = plat ? PLATFORMS.find(x => x.key === plat) : null
    const n = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
    if (!n?.ok) { setErr(n?.error || 'Could not duplicate.'); return }
    const copy: AdProject = { ...p, id: n.project.id, name: pf ? p.name + ' · ' + pf.label : p.name + ' · B', ...(pf ? { platform: pf.key, format: pf.format } : {}), voice: null, status: 'draft', createdAt: n.project.createdAt, updatedAt: n.project.updatedAt }
    const sv = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: copy }) }).then(x => x.json()).catch(() => null)
    if (!sv?.ok) { setErr(sv?.error || 'Could not save the copy.'); return }
    stop(); resetHist(); setMenu(false); setP(sv.project); pRef.current = sv.project; setAudioUrl(null); setSaved('saved'); setSel(0); setT(1.6); setAudit(null); loadList()
  }
  // ── start from an idea ──
  const useIdea = (idea: typeof IDEAS[number]) => {
    const g = GOALS.find(x => x.key === idea.goal)
    setSt(x => ({ ...x, mode: 'describe', prompt: idea.prompt, goal: idea.goal, audience: g?.audience || 'guests' }))
    setIdeasOpen(false)
  }
  // ── safe-zone overlay on the preview (never in the export) ──
  useEffect(() => {
    const cv = safeRef.current; if (!cv || !p) return
    const g = cv.getContext('2d'); if (!g) return
    g.clearRect(0, 0, cv.width, cv.height)
    if (!safe || theater) return // the big preview is the ad as people will see it
    const PF = platformOf(p), W = cv.width, H = cv.height
    g.fillStyle = 'rgba(255,80,80,0.18)'
    if (PF.safe.top) g.fillRect(0, 0, W, H * PF.safe.top)
    if (PF.safe.bottom) g.fillRect(0, H - H * PF.safe.bottom, W, H * PF.safe.bottom)
    if (PF.safe.right) g.fillRect(W - W * PF.safe.right, H * PF.safe.top, W * PF.safe.right, H - H * PF.safe.top - H * PF.safe.bottom)
    g.strokeStyle = 'rgba(255,80,80,0.6)'; g.setLineDash([6, 6]); g.lineWidth = 1.5
    if (PF.safe.top) { g.beginPath(); g.moveTo(0, H * PF.safe.top); g.lineTo(W, H * PF.safe.top); g.stroke() }
    if (PF.safe.bottom) { g.beginPath(); g.moveTo(0, H - H * PF.safe.bottom); g.lineTo(W, H - H * PF.safe.bottom); g.stroke() }
    if (PF.safe.right) { g.beginPath(); g.moveTo(W - W * PF.safe.right, 0); g.lineTo(W - W * PF.safe.right, H); g.stroke() }
    g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `600 ${Math.round(W * 0.022)}px ${body}`
    if (PF.safe.bottom) g.fillText(PF.label + ' UI covers this', 12, H - H * PF.safe.bottom + W * 0.03)
  }, [safe, p?.platform, p?.format, p?.id, body, box.w, box.h, home, starting, !!plan, !!draft, showAudit, theater, beside]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Rewrite just the selected scene the way it is asked ("punchier", "show the rooftop", "make it numbers"). */
  const askScene = async (what: string) => {
    if (!p || !what.trim()) return
    const i = sel, before = p.scenes[i]
    setBusy('scene'); setErr('')
    const r = await fetch('/api/ads/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: p, index: i, ask: what.trim() }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok || !r.scene) { setErr(r?.error || 'The scene could not be changed. Try again.'); return }
    if (pRef.current?.scenes[i]?.id !== before.id) return // the ad changed underneath; drop it
    setUndo({ id: before.id, scene: before })
    change(d => ({ ...d, scenes: d.scenes.map((s, k) => (k === i ? { ...r.scene, id: before.id } : s)) }))
    setAsk('')
    if (tl) setT(tl.starts[i] + Math.min(1.6, tl.durs[i] * 0.6))
  }
  const undoScene = () => {
    if (!undo) return
    change(d => ({ ...d, scenes: d.scenes.map(s => (s.id === undo.id ? undo.scene : s)) }))
    setUndo(null)
  }

  // ── voice ─────────────────────────────────────────────────────────────
  const makeVoice = async () => {
    if (!p) return
    stop(); setBusy('voice'); setErr('')
    clearTimeout(saveTimer.current)
    const r = await fetch('/api/ads/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: p }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The voice could not be made.'); return }
    setP(r.project); setAudioUrl(r.audioUrl || null); setSaved('saved'); setT(0)
  }

  // ── assets for the renderer ───────────────────────────────────────────
  const img = (url: string): HTMLImageElement | null => {
    if (!url) return null
    const c = imgs.current[url]
    if (c) return c.complete && c.naturalWidth ? c : null
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.src = proxied(url)
    imgs.current[url] = im
    return null
  }
  /** A scene's media: a photo, or a library video ('video:<key>') kept in step with the scene clock. */
  const vidUrl = (ref: string): string => {
    if (ref.startsWith('/')) return ref
    const hit = libRef.current.find(v => v.key === ref)
    return hit ? hit.url : ''
  }
  const media = (u: string, local: number): HTMLImageElement | HTMLVideoElement | null => {
    if (!u.startsWith('video:')) return img(u)
    const ref = u.slice(6)
    let el = vids.current[ref]
    if (!el) {
      const src = vidUrl(ref)
      if (!src) return null
      el = document.createElement('video')
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.src = src
      vids.current[ref] = el
      return null
    }
    if (el.readyState < 2) return null
    const d = el.duration || 1
    const want = local % d
    if (live.current) {
      if (el.paused) el.play().catch(() => {})
      if (Math.abs(el.currentTime - want) > 0.4) el.currentTime = want
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - want) > 0.06 && !el.seeking) el.currentTime = want
    }
    return el
  }
  /** Bundled track or a generated one from the Sounds library. */
  const track = (key: string): { label: string; file: string; credit: string } => {
    const m = MUSIC.find(x => x.key === key)
    if (m) return m
    const g = sndRef.current.find(x => x.key === key)
    return g ? { label: g.name, file: g.url, credit: '' } : { label: key.startsWith('snd:') ? 'Generated track' : 'No music', file: '', credit: '' }
  }
  const assets = (): AdAssets => ({
    img, media, logo: logo.current, logos: logos.current, display, body, serif, condensed, elegant, mono: 'ui-monospace, Menlo, monospace',
    credit: track(pRef.current?.music || '').credit,
  })

  // ── audio ─────────────────────────────────────────────────────────────
  const ctx = () => { if (!actx.current) actx.current = new AudioContext(); return actx.current }
  const loadAudio = async (): Promise<{ v: AudioBuffer | null; m: AudioBuffer | null; fx: Record<string, AudioBuffer> }> => {
    const c = ctx()
    let v: AudioBuffer | null = null, m: AudioBuffer | null = null
    if (audioUrl && hasVoice) {
      if (voiceBuf.current?.url === audioUrl) v = voiceBuf.current.buf
      else { try { const ab = await fetch(audioUrl).then(r => r.arrayBuffer()); v = await c.decodeAudioData(ab); voiceBuf.current = { url: audioUrl, buf: v } } catch { v = null } }
    }
    const mk = pRef.current?.music || '', mu = track(mk)
    if (mu.file) {
      if (musicBuf.current[mk]) m = musicBuf.current[mk]
      else { try { const ab = await fetch(mu.file).then(r => r.arrayBuffer()); m = await c.decodeAudioData(ab); musicBuf.current[mk] = m } catch { m = null } }
    }
    const fx: Record<string, AudioBuffer> = {}
    for (const sc of pRef.current?.scenes || []) {
      const k = sc.sfx || ''
      if (!k || fx[k]) continue
      if (sfxBuf.current[k]) { fx[k] = sfxBuf.current[k]; continue }
      const u = sndRef.current.find(x => x.key === k)?.url
      if (!u) continue
      try { const ab = await fetch(u).then(r => r.arrayBuffer()); fx[k] = sfxBuf.current[k] = await c.decodeAudioData(ab) } catch { /* skip it */ }
    }
    return { v, m, fx }
  }
  /** Wire the voice and the ducked, faded music into `dest`, starting the ad at `from` seconds. */
  const wire = (c: AudioContext, dest: AudioNode, from: number, v: AudioBuffer | null, m: AudioBuffer | null, startAt: number, fx: Record<string, AudioBuffer> = {}): AudioScheduledSourceNode[] => {
    const cur = pRef.current!, T = timeline(cur)
    const nodes: AudioScheduledSourceNode[] = []
    if (v) {
      const s = c.createBufferSource(); s.buffer = v; s.connect(dest)
      const off = from - LEAD
      if (off < v.duration) { s.start(startAt + Math.max(0, -off), Math.max(0, off)); nodes.push(s) }
    }
    if (m) {
      const s = c.createBufferSource(); s.buffer = m
      const g = c.createGain(); s.connect(g); g.connect(dest)
      const base = cur.musicVol, duck = cur.musicVol * 0.55
      const fadeAt = (T.voiced ? T.voEnd + 0.3 : T.total - 4)
      // The level the music should have at ad-time x: fade in, duck under each spoken line, fade out.
      const lvl = (x: number) => {
        let l = base * Math.min(1, x / 1.0)
        for (let k = 0; k < T.spans.length; k++) if (x > T.spans[k].from - 0.15 && x < T.spans[k].to + 0.25) l = Math.min(l, duck)
        if (x >= fadeAt) l *= Math.max(0, 1 - (x - fadeAt) / Math.max(0.5, T.total - fadeAt))
        return l
      }
      g.gain.setValueAtTime(lvl(from), startAt)
      for (let x = Math.ceil(from * 10) / 10; x <= T.total; x += 0.1) g.gain.linearRampToValueAtTime(lvl(x), startAt + (x - from))
      if (from < m.duration) { s.start(startAt, from); s.stop(startAt + (T.total - from)); nodes.push(s) }
    }
    // Each scene's sound effect lands as the scene starts.
    cur.scenes.forEach((sc, i) => {
      const b = sc.sfx ? fx[sc.sfx] : null
      if (!b) return
      const at = T.starts[i] + 0.05, off = from - at
      if (off >= b.duration) return
      const s = c.createBufferSource(); s.buffer = b
      const g = c.createGain(); g.gain.value = 0.85; s.connect(g); g.connect(dest)
      s.start(startAt + Math.max(0, -off), Math.max(0, off)); nodes.push(s)
    })
    return nodes
  }
  const stop = () => {
    const pl = play0.current
    if (pl) { pl.nodes.forEach(n => { try { n.stop() } catch { /* already */ } }); play0.current = null }
    live.current = false
    Object.keys(vids.current).forEach(k => { try { vids.current[k].pause() } catch { /* fine */ } })
    setPlaying(false)
  }
  const start = async (from: number) => {
    if (!pRef.current) return
    const c = ctx(); if (c.state === 'suspended') await c.resume()
    const { v, m, fx } = await loadAudio()
    const at = c.currentTime + 0.08
    play0.current = { at, from, nodes: wire(c, c.destination, from, v, m, at, fx) }
    live.current = true
    setPlaying(true)
  }
  const play = () => {
    if (!p || !tl) return
    if (play0.current) { stop(); return }
    start(t >= tl.total - 0.05 ? 0 : t)
  }

  // ── the viewer: draw every frame ──────────────────────────────────────
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const cv = canvasRef.current, cur = pRef.current
      if (cv && cur) {
        const T = timeline(cur)
        let now = cur.kind === 'flyer' ? Math.max(0, T.total - 0.4) : tRef.current
        const pl = play0.current
        if (pl && actx.current) {
          now = pl.from + Math.max(0, actx.current.currentTime - pl.at)
          if (now >= T.total) { now = T.total; stop() }
          if (Math.abs(now - tRef.current) > 0.03) setT(now)
        }
        const g = cv.getContext('2d')
        if (g) drawFrame(g, cur, T, Math.min(now, T.total - 0.001), assets())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { if (panelRef.current) panelRef.current.scrollTop = 0 } catch { /* fine */ } }, [p?.id, home, tab])
  // Follow the playhead with the selection while playing; seek to a scene when it is picked.
  useEffect(() => { if (playing && tl) { const i = sceneAt(tl, t); if (i !== sel) setSel(i) } }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (i: number) => { setSel(i); if (tl && !playing) setT(tl.starts[i] + Math.min(1.6, tl.durs[i] * 0.6)) }
  const seek = (x: number) => { const was = !!play0.current; stop(); const to = Math.max(0, x); setT(to); tRef.current = to; if (was) start(to) }
  // ── keyboard: space = play/pause, ← → = scenes (not while typing) ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (!pRef.current || !keysOn.current) return
      if (e.key === 'Escape' && theaterRef.current) { e.preventDefault(); setTheater(false); return }
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && pRef.current.kind !== 'flyer') { e.preventDefault(); setTheater(v => !v); return }
      if (theaterRef.current && (e.key === 'Delete' || e.key === 'Backspace')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); stepHist(!e.shiftKey); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); if (play0.current) stop(); else { const T = timeline(pRef.current); start(tRef.current >= T.total - 0.05 ? 0 : tRef.current) } }
      else if (e.key === 'ArrowRight') { e.preventDefault(); const T = timeline(pRef.current); const i = Math.min(T.starts.length - 1, sel + 1); setSel(i); if (!play0.current) setT(T.starts[i] + Math.min(1.6, T.durs[i] * 0.6)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); const T = timeline(pRef.current); const i = Math.max(0, sel - 1); setSel(i); if (!play0.current) setT(T.starts[i] + Math.min(1.6, T.durs[i] * 0.6)) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit && pRef.current.scenes.length > 1) { e.preventDefault(); delSceneAt(sel) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── export: the same renderer, recorded ───────────────────────────────
  const exportVideo = async () => {
    if (!p || !tl) return
    stop(); setErr('')
    const [W, H] = FORMATS[p.format]
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    // Warm every image first, so the first second of the file is not half-loaded.
    p.scenes.forEach(s => s.photos.forEach(u => img(u))); if (p.contact.photo) img(p.contact.photo)
    await new Promise(r => setTimeout(r, 1200))
    const c = ctx(); if (c.state === 'suspended') await c.resume()
    const { v, m, fx } = await loadAudio()
    const dest = c.createMediaStreamDestination()
    // QUALITY (Jon, 2026-11-10: "overall video quality"): frames are pushed one at a time as they are drawn
    // (requestFrame), so the file never repeats or tears a frame when the page is busy, and photos are scaled with
    // the browser's best filter. Falls back to a 30 fps capture where requestFrame is missing.
    g.imageSmoothingEnabled = true; (g as any).imageSmoothingQuality = 'high'
    let vs = (cv as any).captureStream(0) as MediaStream
    let vtrack = vs.getVideoTracks()[0] as any
    if (!vtrack || typeof vtrack.requestFrame !== 'function') { vs = (cv as any).captureStream(30) as MediaStream; vtrack = null }
    const pushFrame = () => { try { vtrack?.requestFrame() } catch { /* */ } }
    const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()])
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    const mime = types.find(x => (window as any).MediaRecorder && MediaRecorder.isTypeSupported(x)) || ''
    if (!mime) { setErr('This browser cannot record video. Use Chrome or Safari.'); return }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(W, H) > 1920 ? 32_000_000 : 22_000_000, audioBitsPerSecond: 256_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<void>(res => { rec.onstop = () => res() })
    live.current = true
    drawFrame(g, p, tl, 0, assets()); pushFrame()
    rec.start(500)
    const at = c.currentTime + 0.15
    const nodes = wire(c, dest, 0, v, m, at, fx)
    setExportPct(0)
    // SMOOTH (Jon, 2026-11-13: "make sure rendering is smooth and high quality"). The file is cut on an exact 30 fps
    // grid: each tick of the screen (requestAnimationFrame, so it is locked to the display, not a drifting timer)
    // asks "which frame number is the sound at?" and draws that frame at its exact time, once. Motion is then evenly
    // spaced however busy the page is. A timer drove this before and its 33–50 ms wobble showed as judder on pans.
    // With the tab in the background the screen stops ticking, so a timer takes over rather than stalling the export.
    const FPS = 30
    let lastFrame = -1
    await new Promise<void>(res => {
      const step = () => {
        const x = Math.max(0, c.currentTime - at)
        const n = Math.floor(x * FPS)
        if (n > lastFrame) {
          lastFrame = n
          drawFrame(g, p, tl, Math.min(n / FPS, tl.total - 0.001), assets()); pushFrame()
          if (n % 6 === 0) setExportPct(Math.min(100, Math.round(x / tl.total * 100)))
        }
        if (x >= tl.total + 0.2) { res(); return }
        if (document.visibilityState === 'visible') requestAnimationFrame(step); else setTimeout(step, 1000 / FPS)
      }
      step()
    })
    nodes.forEach(n => { try { n.stop() } catch { /* done */ } })
    rec.stop(); await done
    live.current = false
    setExportPct(null)
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
    const blob = new Blob(chunks, { type: mime.split(';')[0] })
    download(blob, ext)
    if (keepCopy && canEdit) {
      drawFrame(g, p, tl, Math.min(tl.total - 0.01, tl.starts[0] + 1.6), assets())
      const thumb = await new Promise<Blob | null>(res => cv.toBlob(b => res(b), 'image/jpeg', 0.8))
      await toLibrary(blob, ext, thumb, p.name, tl.total, p.format)
    }
  }
  const fileBase = () => `${(p?.name || 'Stay ad').replace(/[^\w\- ]+/g, '').trim() || 'Stay ad'} (${(p?.format || '16:9').replace(':', 'x')})`
  const download = (blob: Blob, ext: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileBase()}.${ext}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  }
  /** A still of the frame on screen, full size — for a static post. */
  const exportPng = async () => {
    if (!p || !tl) return
    const [W, H] = FORMATS[p.format]
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    drawFrame(cv.getContext('2d')!, p, tl, p.kind === 'flyer' ? Math.max(0, tl.total - 0.4) : Math.min(t, tl.total - 0.01), assets())
    const b = await new Promise<Blob | null>(res => cv.toBlob(x => res(x), 'image/png'))
    if (b) download(b, 'png')
  }
  /** A CAROUSEL (Jon, 2026-11-10: "photo for our Facebook or IG"): every scene as its own full-size photo, drawn at the
   *  moment the scene has fully landed, downloaded one after another (1.png, 2.png …) for an Instagram carousel. */
  const exportCarousel = async () => {
    if (!p || !tl) return
    const [W, H] = FORMATS[p.format]
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    const base = fileBase()
    for (let i = 0; i < p.scenes.length; i++) {
      const at = tl.starts[i] + Math.max(0.2, tl.durs[i] - 0.35)
      drawFrame(g, p, tl, Math.min(at, tl.total - 0.01), assets())
      const b = await new Promise<Blob | null>(res => cv.toBlob(x => res(x), 'image/png'))
      if (!b) continue
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${base} — ${i + 1}.png`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000)
      await new Promise(r => setTimeout(r, 350))
    }
  }
  /** The flyer as a PDF at its real size (Letter prints at 300 dpi; social sizes as a one-page PDF). */
  const exportPdf = async () => {
    if (!p || !tl) return
    setBusy('export')
    try {
      const [W, H] = FORMATS[p.format]
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H
      drawFrame(cv.getContext('2d')!, p, tl, Math.max(0, tl.total - 0.4), assets())
      const { jsPDF } = await import('jspdf')
      const inW = p.format === 'letter' ? 8.5 : W / 150, inH = p.format === 'letter' ? 11 : H / 150
      const doc = new jsPDF({ orientation: inW >= inH ? 'landscape' : 'portrait', unit: 'in', format: [inW, inH] })
      doc.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, inW, inH)
      doc.save(`${fileBase()}.pdf`)
    } catch (e: any) { setErr('PDF failed: ' + (e?.message || e)) }
    setBusy('')
  }
  /** An animated GIF of the whole ad (no sound) — "a static image that moves", for posts and email. */
  const exportGif = async () => {
    if (!p || !tl) return
    stop(); setErr('')
    const [W, H] = FORMATS[p.format]
    const k = 480 / Math.max(W, H)
    const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k)
    const g = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D
    p.scenes.forEach(s => s.photos.forEach(u => media(u, 0))); await new Promise(r => setTimeout(r, 1000))
    const fps = tl.total > 16 ? 8 : 10
    const n = Math.ceil(tl.total * fps)
    const enc = GIFEncoder()
    setExportPct(0)
    for (let f = 0; f < n; f++) {
      const x = f / fps
      // a video in the scene has to be at the right frame before it is drawn
      const i = sceneAt(tl, x), ref = (p.scenes[i].photos[0] || '')
      if (ref.startsWith('video:')) {
        const el = vids.current[ref.slice(6)]
        if (el) { el.currentTime = (x - tl.starts[i]) % (el.duration || 1); await new Promise(r => { const done = () => r(null); el.addEventListener('seeked', done, { once: true }); setTimeout(done, 400) }) }
      }
      drawFrame(g, p, tl, Math.min(x, tl.total - 0.001), assets())
      const data = g.getImageData(0, 0, cv.width, cv.height).data
      const pal = quantize(data, 256)
      enc.writeFrame(applyPalette(data, pal), cv.width, cv.height, { palette: pal, delay: Math.round(1000 / fps) })
      if (f % 6 === 0) { setExportPct(Math.round(f / n * 100)); await new Promise(r => setTimeout(r, 0)) }
    }
    enc.finish()
    setExportPct(null)
    download(new Blob([enc.bytes() as any], { type: 'image/gif' }), 'gif')
  }

  // ── the video library ─────────────────────────────────────────────────
  const loadLib = async () => {
    const r = await fetch('/api/ads/library').then(x => x.json()).catch(() => null)
    if (r?.ok) setLib(r.videos || [])
  }
  const putFile = (url: string, body: Blob, type: string, onPct?: (n: number) => void) => new Promise<void>((res, rej) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', type)
    xhr.setRequestHeader('x-upsert', 'true')
    xhr.upload.onprogress = e => { if (e.lengthComputable && onPct) onPct(Math.round(e.loaded / e.total * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error('upload failed (' + xhr.status + ')')))
    xhr.onerror = () => rej(new Error('upload failed'))
    xhr.send(body)
  })
  const toLibrary = async (blob: Blob, ext: string, thumb: Blob | null, name: string, dur: number, format: string) => {
    try {
      setLibPct(0)
      const s = await fetch('/api/ads/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sign: ext }) }).then(x => x.json())
      if (!s?.ok) throw new Error(s?.error || 'could not start the upload')
      await putFile(s.signedUrl, blob, blob.type || 'video/mp4', n => setLibPct(n))
      if (thumb) await putFile(s.thumbUrl, thumb, 'image/jpeg')
      const m = await fetch('/api/ads/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { path: s.path, thumbPath: thumb ? s.thumbPath : '', name, dur, format } }) }).then(x => x.json())
      if (!m?.ok) throw new Error(m?.error || 'could not save it')
      await loadLib()
    } catch (e: any) { setErr('Saved to your computer, but not to the library: ' + (e?.message || e)) }
    finally { setLibPct(null) }
  }
  const uploadVideo = async (f: File) => {
    const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toLowerCase()
    // the first frame as the thumbnail, and the length, read in the browser
    const url = URL.createObjectURL(f)
    const v = document.createElement('video'); v.muted = true; v.src = url; v.preload = 'auto'
    const meta = await new Promise<{ dur: number; thumb: Blob | null; w: number; h: number }>(res => {
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2) }
      v.onseeked = () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(640 * (v.videoHeight || 360) / (v.videoWidth || 640))
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        c.toBlob(b => res({ dur: v.duration || 0, thumb: b, w: v.videoWidth, h: v.videoHeight }), 'image/jpeg', 0.8)
      }
      v.onerror = () => res({ dur: 0, thumb: null, w: 0, h: 0 })
    })
    URL.revokeObjectURL(url)
    const fmt = meta.w && meta.h ? (meta.w > meta.h * 1.2 ? '16:9' : meta.h > meta.w * 1.5 ? '9:16' : meta.h > meta.w * 1.1 ? '4:5' : '1:1') : ''
    await toLibrary(f, ext, meta.thumb, f.name.replace(/\.[a-z0-9]+$/i, ''), meta.dur, fmt)
  }
  const delVideo = async (v: LibVideo) => {
    if (!v.path || !window.confirm('Delete "' + v.name + '" from the library?')) return
    await fetch('/api/ads/library?path=' + encodeURIComponent(v.path), { method: 'DELETE' })
    loadLib()
  }
  const useVideo = (v: LibVideo) => {
    if (!p || !sc) return
    setScene(sel, { photos: ['video:' + (v.builtin ? v.url : v.key)].concat(sc.photos.filter(x => !x.startsWith('video:'))).slice(0, 12) })
  }

  // ── sounds (ElevenLabs music + effects) and voices ────────────────────
  const loadSounds = async () => {
    const r = await fetch('/api/ads/sounds').then(x => x.json()).catch(() => null)
    if (r?.ok) setSounds(r.sounds || [])
  }
  const makeSound = async () => {
    if (!sndPrompt.trim()) { setErr('Describe the sound first, e.g. "warm lounge house, sunset by the pool".'); return }
    setBusy('sound'); setErr('')
    const r = await fetch('/api/ads/sounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: sndKind, prompt: sndPrompt, seconds: sndSecs, name: sndName }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The sound could not be made.'); return }
    setSounds(r.sounds || []); setSndPrompt(''); setSndName('')
  }
  const delSound = async (x: Sound) => {
    if (!window.confirm('Delete "' + x.name + '"? Ads that use it will play without it.')) return
    await fetch('/api/ads/sounds?path=' + encodeURIComponent(x.path), { method: 'DELETE' })
    loadSounds()
  }
  /** Play a clip once (tap again to stop). */
  const preview = (url: string) => {
    const el = previewEl.current || (previewEl.current = new Audio())
    if (hear === url) { el.pause(); setHear(''); return }
    stop()
    el.src = url; el.currentTime = 0; el.volume = 0.9
    el.onended = () => setHear('')
    el.play().then(() => setHear(url)).catch(() => setHear(''))
  }
  const findVoices = async (gender = vGender) => {
    setVBusy(true); setErr('')
    const r = await fetch('/api/ads/voices?q=' + encodeURIComponent(vq.trim()) + '&gender=' + gender).then(x => x.json()).catch(() => null)
    setVBusy(false)
    if (!r?.ok) { setErr(r?.error || 'The voice library did not answer.'); return }
    setVHits(r.voices || [])
  }

  // ── templates: a ready-made ad that fills itself from the photo library ──
  // A story is a template that starts its own ad (Jon, 2026-11-03: our story, welcome, first 90 days, the team).
  const buildStory = async (st: AdStory) => {
    if (!canEdit || busy) return
    const cur = await newAd(); if (!cur) return
    setStarting(false)
    await applyTemplate(st, true)
    resetHist()
    change(d => ({ ...d, kind: 'story', name: st.name, audience: st.audience, format: st.format, goal: st.audience === 'partners' ? 'partners' : 'owners', look: d.look || DEFAULT_LOOK }))
  }
  const applyTemplate = async (tp: AdTemplate, quiet = false) => {
    const p = pRef.current
    if (!p || !canEdit) return
    if (!quiet && p.scenes.length > 2 && !window.confirm('Replace the scenes in "' + p.name + '" with the ' + tp.label + ' template?')) return
    stop(); setBusy('template')
    const cache: Record<string, string[]> = {}
    const scenes: AdScene[] = []
    for (let i = 0; i < tp.scenes.length; i++) {
      const s = tp.scenes[i]
      let photos: string[] = []
      if (s.q && s.n) {
        if (!cache[s.q]) {
          const r = await fetch('/api/photos/library?search=' + encodeURIComponent(s.q)).then(x => x.json()).catch(() => null)
          const hs: Hit[] = r?.ok ? r.hits || [] : []
          cache[s.q] = hs.filter((h: any) => h.active !== false && !COLLAGE.test(String(h.caption || ''))).map(h => h.view || h.url)
        }
        // different photos for different scenes that share a search
        if (cache[s.q].length) {
          const c = await fetch('/api/ads/photo-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: cache[s.q].slice(0, 30) }) }).then(x => x.json()).catch(() => null)
          if (c?.ok && c.collage?.length) cache[s.q] = cache[s.q].filter(u => c.collage.indexOf(u) < 0)
        }
        const used = scenes.reduce((a: string[], x) => a.concat(x.photos), [])
        const fresh = cache[s.q].filter(u => used.indexOf(u) < 0)
        photos = (fresh.length >= s.n ? fresh : cache[s.q]).slice(0, s.n)
      }
      scenes.push({ id: 's' + (i + 1), kind: s.kind, vo: s.vo, head: s.head, sub: s.sub, items: s.items.slice(), photos, dur: s.dur || null, ...(s.qr ? { qr: s.qr, qrLabel: s.qrLabel } : {}), ...(s.sig ? { sig: s.sig } : {}), ...(s.eyebrow ? { eyebrow: s.eyebrow } : {}) })
    }
    setBusy('')
    { const d0 = pRef.current || p; finishBuild({ ...d0, name: d0.name === 'Untitled ad' ? tp.name : d0.name, format: d0.goal ? d0.format : tp.format, audience: tp.audience, scenes }) }
    setSel(0); setT(1.6); setHome(false); setTab('scene')
  }

  // ── photos ────────────────────────────────────────────────────────────
  /** `over` runs a search for given words / source right away (the AI fallback uses it before state has caught up). */
  const search = async (over?: { q?: string; src?: 'library' | 'stock' }) => {
    const qq = String(over?.q ?? q).trim()
    const src = over?.src ?? photoSrc
    if (!qq) return
    setSearching(true)
    if (src === 'stock') {
      const shape = p ? (p.format === '9:16' || p.format === '4:5' || p.format === 'letter' ? 'portrait' : p.format === '1:1' ? 'square' : 'landscape') : ''
      const r = await fetch('/api/ads/stock?q=' + encodeURIComponent(qq) + '&shape=' + shape).then(x => x.json()).catch(() => null)
      setSearching(false)
      const list: Hit[] = r?.ok ? (r.hits || []).map((h: any) => ({ url: h.url, view: h.view, thumb: h.thumb, caption: h.caption, unit: h.source, building: '', width: h.width, source: h.source, license: h.license, credit: h.credit })) : []
      setHits(list)
      setStockNote(!r?.ok ? (r?.error || 'Stock search failed.') : r.keys && !r.keys.pexels && !r.keys.unsplash ? 'Public-domain results only (Openverse). Add PEXELS_API_KEY or UNSPLASH_ACCESS_KEY in Vercel for the full stock libraries.' : list.length ? '' : 'Nothing found — try fewer words.')
      return
    }
    setStockNote('')
    const r = await fetch('/api/photos/library?search=' + encodeURIComponent(qq)).then(x => x.json()).catch(() => null)
    setSearching(false)
    const list: Hit[] = r?.ok ? (r.hits || []).filter((h: Hit) => !COLLAGE.test(String(h.caption || ''))).slice(0, 60) : []
    setHits(list)
    // then drop any that are collages by the picture itself
    if (list.length) {
      const c = await fetch('/api/ads/photo-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: list.map(h => h.view || h.url) }) }).then(x => x.json()).catch(() => null)
      if (c?.ok && c.collage?.length) setHits(list.filter(h => c.collage.indexOf(h.view || h.url) < 0))
    }
    if (!r?.ok) setErr(r?.error || 'Photo search failed.')
  }

  // ── AI images (2026-11-12) ─────────────────────────────────────────────
  // Jon: "we should have more imagery generations to highlight the events … and highlight book with us". The Generate
  // tab makes pictures for the event and the things to do (app/api/ads/image, OpenAI gpt-image-1, medium); the Book
  // scenes keep our real listing photos. No key → the note says so and the scene's stock search runs instead.
  /** The calendar moment the open ad is for, if any. */
  const momentOf = (x: AdProject | null | undefined): Moment | null => (x && x.moment ? MOMENTS.find(m => m.key === x.moment) || null : null)
  /** Which event scene this is (0 = the opener) — the calendar's vibe list is in that order. */
  const eventIdx = (x: AdProject, i: number) => x.scenes.slice(0, i).filter(y => y.act === 'event').length
  const aiFallback = (msg: string, i: number) => {
    const cur = pRef.current, s0 = cur?.scenes[i]
    setAiNote(msg + ' — showing stock photos for this scene instead.')
    if (!s0 || s0.act === 'book') return
    const qq = stockQueryOf(s0, momentOf(cur))
    setQ(qq); setPhotoSrc('stock'); setHits([]); search({ q: qq, src: 'stock' })
  }
  const genAi = async () => {
    const cur = pRef.current
    if (!cur || !canEdit || aiBusy) return
    const prompt = aiPrompt.trim()
    if (prompt.length < 8) { setAiNote('Describe the picture first — the place, the light, the mood.'); return }
    setAiBusy(true); setAiNote('')
    const r = await fetch('/api/ads/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, shape: shapeOfFormat(cur.format), n: aiN, sceneIndex: sel }) }).then(x => x.json()).catch(() => null)
    setAiBusy(false)
    if (r?.noKey) { setAiOff(true); aiFallback(String(r.error || AI_KEY_MISSING), sel); return }
    if (!r?.ok) { setAiNote(String(r?.error || 'The image did not come back. Try again, or use Stock.')); return }
    const got: Hit[] = (r.images || []).map((h: any) => ({ url: h.url, view: h.view, thumb: h.thumb, caption: h.caption, unit: 'ai', building: '', width: h.width, source: 'ai', license: h.license, credit: h.credit }))
    setAiHits(prev => got.concat(prev).slice(0, 4))
    setAiNote('Made ' + got.length + (typeof r.costUsd === 'number' ? ' · about $' + r.costUsd.toFixed(2) + (r.estimated ? ' (estimate)' : '') : '') + ' — click one to use it.')
  }
  /** Use an AI result in the open scene. It replaces a stock stand-in; otherwise it is added like any photo. */
  const pickAi = (h: Hit) => {
    const s0 = pRef.current?.scenes[sel]
    if (!s0 || !canEdit) return
    const u = h.view || h.url
    if (s0.photos.indexOf(u) >= 0) { setScene(sel, { photos: s0.photos.filter(x => x !== u) }); return }
    setScene(sel, { photos: s0.aiPending ? [u] : s0.photos.concat([u]).slice(0, 12), src: 'ai', aiPending: false, imgPrompt: aiPrompt.trim() || s0.imgPrompt })
  }
  /** One tap: an AI image for every scene that is waiting for one (the event ad's acts 1 and 2), one per scene. */
  const genAllAi = async () => {
    const cur = pRef.current
    if (!cur || !canEdit || aiBatch || aiBusy) return
    const m = momentOf(cur)
    const todo = cur.scenes.map((x, i) => ({ x, i })).filter(o => o.x.aiPending && o.x.act !== 'book')
    if (!todo.length) return
    setAiNote('')
    let done = 0
    for (const { x, i } of todo) {
      setAiBatch((done + 1) + ' of ' + todo.length)
      const prompt = defaultImagePrompt(x, m, eventIdx(cur, i))
      const r = await fetch('/api/ads/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, shape: shapeOfFormat(cur.format), n: 1, sceneIndex: i }) }).then(y => y.json()).catch(() => null)
      if (r?.noKey) { setAiOff(true); setAiNote(String(r.error || AI_KEY_MISSING) + ' — the stock stand-ins stay in place, nothing else changes.'); break }
      if (!r?.ok) { setAiNote(String(r?.error || 'An image did not come back.') + ' — ' + done + ' of ' + todo.length + ' made; the rest keep their stock stand-in.'); break }
      const u = String(r.images?.[0]?.view || '')
      if (u) { const id = x.id; change(d => ({ ...d, scenes: d.scenes.map(y => (y.id === id ? { ...y, photos: [u], src: 'ai' as const, aiPending: false, imgPrompt: prompt } : y)) })); done++ }
    }
    setAiBatch('')
  }
  // The Generate box follows the open scene: prefilled from it (the event's vibe, the place, or its words).
  useEffect(() => {
    if (photoSrc !== 'ai') return
    const cur = pRef.current, s0 = cur?.scenes[sel]
    if (!cur || !s0) return
    setAiPrompt(defaultImagePrompt(s0, momentOf(cur), eventIdx(cur, sel))); setAiHits([])
  }, [sel, photoSrc, p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A Book scene is always our own photos — the Stock and Generate tabs step aside there.
  useEffect(() => {
    const s0 = pRef.current?.scenes[sel]
    if (s0?.act === 'book' && (photoSrc === 'stock' || photoSrc === 'ai')) { setPhotoSrc('library'); setHits([]); setStockNote('') }
  }, [sel, p?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Quick delete from the front door (Jon, 2026-11-04: "need a quick delete"). */
  const quickDelete = async (id: string) => {
    if (!canDelete) return
    const row = list.find(r => r.id === id)
    if (!window.confirm('Delete "' + (row?.name || 'this piece') + '"? This cannot be undone.')) return
    await fetch('/api/ads?id=' + encodeURIComponent(id), { method: 'DELETE' })
    if (p?.id === id) { setP(null); pRef.current = null }
    loadList()
  }
  const quickDeleteMany = async (ids: string[]) => {
    if (!canDelete || !ids.length) return
    if (!window.confirm('Delete ' + ids.length + ' piece' + (ids.length === 1 ? '' : 's') + '? This cannot be undone.')) return
    setBusy('delete')
    for (const id of ids) await fetch('/api/ads?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => null)
    setBusy('')
    if (p && ids.indexOf(p.id) >= 0) { setP(null); pRef.current = null }
    loadList()
  }
  const quickDuplicate = async (id: string) => {
    const r = await fetch('/api/ads?id=' + encodeURIComponent(id)).then(x => x.json()).catch(() => null)
    if (!r?.ok) return
    const n = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
    if (!n?.ok) return
    const copy: AdProject = { ...r.project, id: n.project.id, name: r.project.name + ' · copy', voice: null, status: 'draft', createdAt: n.project.createdAt, updatedAt: n.project.updatedAt }
    await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: copy }) })
    loadList()
  }
  /** Photos for a flyer/post scene: the library, collages out, nothing repeated. */
  const libPhotos = async (q: string, n: number, avoid: string[] = [], where: AreaKey[] = []): Promise<string[]> => {
    // LOCATION (Jon, 2026-11-04): a Fort Lauderdale moment shows our Fort Lauderdale listings first, Miami → Miami.
    const set = buildingsIn(where)
    const ask = async (qq: string): Promise<Hit[]> => { const r = await fetch('/api/photos/library?search=' + encodeURIComponent(qq)).then(x => x.json()).catch(() => null); return r?.ok ? r.hits || [] : [] }
    let hs: Hit[] = await ask(q)
    if (set.length) {
      const inSet = (h: any) => inBuildings(String(h.building || ''), set)
      if (hs.filter(inSet).length < n) for (const b of set.slice(0, 5)) { hs = hs.concat((await ask(b + ' ' + q)).filter(inSet)); if (hs.filter(inSet).length >= n + 2) break }
      if (hs.filter(inSet).length < n) for (const b of set.slice(0, 5)) hs = hs.concat((await ask(b)).filter(inSet))
      hs = byPlace(hs, set)
    }
    let urls = hs.filter((h: any) => h.active !== false && !COLLAGE.test(String(h.caption || ''))).map(h => h.view || h.url).filter(u => avoid.indexOf(u) < 0)
    if (urls.length) {
      const c = await fetch('/api/ads/photo-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: urls.slice(0, 30) }) }).then(x => x.json()).catch(() => null)
      if (c?.ok && c.collage?.length) urls = urls.filter(u => c.collage.indexOf(u) < 0)
    }
    return urls.slice(0, n)
  }
  /** A flyer: one designed page. From a calendar moment, or blank in the house look. */
  /** Turns a designed preset (lib/ad-presets) into scenes, each with its own photo from the library — our buildings
   *  in the moment's area first, never the same photo twice. */
  const fromPreset = async (ps: PresetScene[], m?: Moment): Promise<AdScene[]> => {
    const used: string[] = []
    const out: AdScene[] = []
    for (let k = 0; k < ps.length; k++) {
      const x = ps[k]
      const photos = await libPhotos(x.q, x.n || 1, used, m?.where || [])
      used.push(...photos)
      out.push({ id: 's' + (k + 1), kind: x.kind, vo: '', head: x.head, sub: x.sub, items: x.items.slice(), photos, dur: x.dur, fx: (x.fx || []).slice(), ...(x.eyebrow ? { eyebrow: x.eyebrow } : {}), ...(x.tr ? { tr: x.tr as AdTransition } : {}) })
    }
    return out
  }
  const startFlyer = async (m?: Moment, angle?: Angle) => {
    const cur = await newAd(); if (!cur) return
    setBusy('template')
    const guests = !m || (angle?.audience || m.audience) !== 'owners'
    const scenes: AdScene[] = m
      ? await fromPreset([angle ? { ...angle.flyer, dur: 6 } : momentFlyer(m, whenShort(m))], m)
      : [{ id: 's1', kind: 'poster', vo: '', head: 'Your South Florida **stay.**', sub: 'Pool mornings, city nights, a real apartment to come back to', items: ['', 'Book at stay-hospitality.com'], photos: await libPhotos('exterior', 1, [], []), dur: 6 }]
    setBusy('')
    change(d => ({ ...d, kind: 'flyer', name: m ? m.name + (angle ? ' · ' + angle.name : '') + ' · photo post' : 'New photo post', format: '4:5', platform: 'feed', audience: guests ? 'guests' : 'owners', goal: guests ? 'bookings' : 'owners', look: DEFAULT_LOOK, tone: undefined, moment: m?.key, captions: false, music: m?.music || d.music, scenes }))
    resetHist(); setStarting(false); setPlan(null); setDraft(null); setShowAudit(false); setTab('scene')
    setSel(0); setT(5.5); setHome(false); try { window.scrollTo(0, 0) } catch { /* fine */ }
  }
  /** An animated post: a designed 3–4 scene sequence for the moment — built for owners when it is for owners. */
  const startPost = async (m?: Moment, angle?: Angle) => {
    const cur = await newAd(); if (!cur) return
    setBusy('template')
    const guests = !m || (angle?.audience || m.audience) !== 'owners'
    let scenes: AdScene[]
    if (m) scenes = await fromPreset(angle ? angle.post : momentPost(m, whenShort(m)), m)
    else {
      const a = await libPhotos('pool', 1, [], []), b = await libPhotos('ocean view', 1, a, [])
      scenes = [
        { id: 's1', kind: 'poster', vo: '', head: 'Your South Florida **stay.**', sub: '', items: ['', '', ''], photos: a, dur: 4 },
        { id: 's2', kind: 'cta', vo: '', head: 'Book **direct.**', sub: '', items: ['Book at stay-hospitality.com'], photos: b, dur: 3, tr: 'fade' },
      ]
    }
    setBusy('')
    change(d => ({ ...d, kind: 'post', name: m ? m.name + (angle ? ' · ' + angle.name : '') + ' · post' : 'New animated post', format: '9:16', platform: 'story', audience: guests ? 'guests' : 'owners', goal: guests ? 'bookings' : 'owners', look: DEFAULT_LOOK, tone: undefined, moment: m?.key, captions: false, music: m?.music || d.music, scenes }))
    resetHist(); setStarting(false); setPlan(null); setDraft(null); setShowAudit(false); setTab('scene')
    setSel(0); setT(1.6); setHome(false); try { window.scrollTo(0, 0) } catch { /* fine */ }
  }
  /** A video ad (for a moment or not): the start page, with the brief and the look already filled in. Nothing is
   *  saved until it is built — abandoned starts used to pile up in Your work as empty drafts. */
  const startVideoFor = (m?: Moment) => {
    openStart('describe')
    if (!m) return
    const owners = m.audience === 'owners'
    startPatch.current = { kind: 'video', moment: m.key, platform: 'reel' }
    setSt(x => ({ ...x, mode: 'describe', prompt: m.brief, vibe: '', look: DEFAULT_LOOK, music: m.music || '', format: '9:16', audience: owners ? 'owners' : 'guests', goal: owners ? 'owners' : m.key === 'basel' || m.key === 'ultra' || m.key === 'f1' || m.key.includes('boat') ? 'event' : 'bookings' }))
  }
  /** "Make the event ad" (Jon, 2026-11-12: "Like Event, things to do, and then hit them with book your Stay now"): a
   *  9:16 guest video in three acts, written for the event straight from the calendar card. Acts 1 and 2 come with stock
   *  stand-ins and an AI image planned for each; act 3 is our own listings in the event's area. */
  const startEventAd = async (m: Moment) => {
    if (!canEdit || busy) return
    const cur = await newAd(); if (!cur) return
    setBusy('write'); setErr(''); setAiNote(''); setAiOff(false)
    const fmt: AdFormat = '9:16'
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: m.brief, seconds: 30, audience: AUD.guests.brief, format: fmt, current: null, where: m.where || [], eventKey: m.key }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok || !r.scenes?.length) { setErr(r?.error || 'The event ad did not come back. Try again.'); setHome(false); return }
    const d0 = pRef.current || cur
    const plat = PLATFORMS.find(x => x.key === 'reel' && x.format === fmt)?.key || PLATFORMS.find(x => x.format === fmt)?.key || d0.platform
    finishBuild({ ...d0, kind: 'video', name: m.name + ' · event ad', prompt: m.brief, moment: m.key, platform: plat, format: fmt, audience: 'guests', goal: 'event', look: DEFAULT_LOOK, music: m.music || d0.music, scenes: r.scenes })
    if (r.warnings?.length) setErr((r.warnings.some((w: string) => /writer did not answer/.test(w)) ? 'The ad is ready — ' : 'Fact check: ') + r.warnings.join(' · '))
    setBrief(m.brief); setStarting(false); setPlan(null); setDraft(null); setHome(false); setTab('scene'); setSel(0); setT(1.6); setUndo(null)
    resetHist()
    try { window.scrollTo(0, 0) } catch { /* fine */ }
  }
  const startStory = () => openStart('story')
  const makeKind = (k: AdKindOf) => { if (k === 'flyer') startFlyer(); else if (k === 'post') startPost(); else if (k === 'story') startStory(); else startVideoFor() }
  // IDEAS FIRST (Jon, 2026-11-10: "give us more options, built into those pre-templated designs"): a moment with more
  // than one angle opens the ideas board; one with a single angle builds straight away.
  const [ideas, setIdeas] = useState<null | { m: Moment; k: 'flyer' | 'post'; rebuild?: boolean }>(null)
  const makeMoment = (m: Moment, k: AdKindOf) => {
    if (k === 'flyer' || k === 'post') { if (momentAngles(m, whenShort(m)).length > 1) setIdeas({ m, k }); else if (k === 'flyer') startFlyer(m); else startPost(m); return }
    startVideoFor(m)
  }
  /** Swap the open piece to another angle (undoable) — same moment, same kind. */
  const reAngle = async (m: Moment, a: Angle, k: 'flyer' | 'post') => {
    setBusy('template')
    const scenes = await fromPreset(k === 'flyer' ? [{ ...a.flyer, dur: 6 }] : a.post, m)
    setBusy('')
    const g = (a.audience || m.audience) !== 'owners'
    change(d => ({ ...d, name: m.name + ' · ' + a.name + (k === 'flyer' ? ' · photo post' : ' · post'), audience: g ? 'guests' : 'owners', goal: g ? 'bookings' : 'owners', scenes }))
    setSel(0); setT(k === 'flyer' ? 5.5 : 1.6)
  }

  // ─────────────────────────────── render ───────────────────────────────
  const sc = p ? p.scenes[sel] : null
  const [FW, FH] = p ? FORMATS[p.format] : [1920, 1080]
  const isFlyer = p?.kind === 'flyer'
  const isSpoken = !!p && (p.kind || 'video') !== 'flyer' && p.kind !== 'post'
  const scriptSide = beside && isSpoken
  /** The start / plan / script pages: full width, no editor chrome. */
  const flow = !home && (starting || !!plan || !!draft)
  const editing = !home && !flow && !!p
  theaterRef.current = theater
  // The picture inside the measured stage, whole, as large as it fits; its pixels follow the size it is shown at.
  const ratio = FW / FH
  const picW = Math.max(120, Math.floor(Math.min(box.w, box.h * ratio))), picH = Math.max(80, Math.floor(picW / ratio))
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1
  const cvK = Math.min(1, 1920 / (Math.max(picW, picH) * dpr))
  const cvW = Math.max(2, Math.round(picW * dpr * cvK)), cvH = Math.max(2, Math.round(picH * dpr * cvK))
  const showScript = scriptSide && !theater
  /** The player column beside the script is as wide as the picture can be at this height (never more than 60%). */
  const playerBasis = Math.round(Math.max(330, box.h * ratio)) + 'px'
  const setCu = (patch: Partial<SceneCustom>) => setMany(x => { const n: any = { ...(x.cu || {}), ...patch }; Object.keys(n).forEach(k => { if (n[k] === '' || n[k] === undefined || n[k] === null || (k === 'zoom' && n[k] === 1) || ((k === 'fx' || k === 'fy') && n[k] === 0)) delete n[k] }); return { cu: Object.keys(n).length ? (n as SceneCustom) : undefined } })
  const totalW = 100 // timeline is % based
  const pct = (x: number) => (tl ? (x / tl.total) * totalW : 0)
  const goHome = () => { stop(); setMenu(false); setHome(true); loadList() }
  keysOn.current = editing && !ideas && !picker && !trPick && !fxPick && !menu && !versions && !watch && !showAudit
  const fit = editing && !showAudit
  const notice = /^(Fact check|The ad is ready|Copied the ad|Saved to your computer)/.test(err)
  const card: React.CSSProperties = { background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 9, padding: 9 }
  const choice = (on: boolean): React.CSSProperties => ({ textAlign: 'left', background: on ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (on ? UI.blue : UI.line), borderRadius: 9, padding: '9px 12px', cursor: 'pointer', color: UI.ink })

  /** Make a music track or a sound effect with ElevenLabs — shown where it is needed. */
  const soundMaker = (kind: 'music' | 'sfx') => (
    <div style={{ ...card, marginTop: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px' }}>{kind === 'music' ? 'Compose a track with ElevenLabs' : 'Make a sound effect with ElevenLabs'}</p>
      <textarea value={sndPrompt} onChange={e => setSndPrompt(e.target.value)} rows={2} style={{ ...field, fontSize: 12 }}
        placeholder={kind === 'music' ? 'e.g. warm lounge house, sunset by the pool, upscale, steady beat' : 'e.g. soft whoosh · camera shutter · ocean waves · cash register ding'} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
        {(kind === 'music' ? [15, 30, 60, 90] : [1, 2, 4, 8]).map(n => <Btn key={n} small on={sndSecs === n} onClick={() => setSndSecs(n)}>{n}s</Btn>)}
        <input value={sndName} onChange={e => setSndName(e.target.value)} placeholder="Name (optional)" style={{ ...field, flex: 1, minWidth: 90, width: 'auto', padding: '5px 8px', fontSize: 12 }} />
      </div>
      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <Btn small tone="blue" disabled={!!busy} onClick={makeSound}>{busy === 'sound' ? (kind === 'music' ? 'Composing… up to a minute' : 'Making…') : 'Generate'}</Btn>
        <Btn small onClick={() => setSndOpen('')}>Close</Btn>
      </div>
    </div>
  )

  return (
    <div style={{ background: UI.bg, color: UI.ink, borderRadius: full ? 0 : 14, border: full ? 0 : '1px solid ' + UI.line, overflow: 'hidden', fontFamily: body, minHeight: full ? '100vh' : undefined, ...(editing ? { display: 'flex', flexDirection: 'column', height: full ? '100vh' : 'calc(100vh - 150px)', minHeight: 560 } : {}) }}>
      {/* ── top bar: one row. Everything rare is behind ⋯ ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, rowGap: 6, flexWrap: 'wrap', padding: '8px 14px', borderBottom: '1px solid ' + UI.line, background: UI.panel, position: 'relative', minHeight: 34 }}>
        {editing && p ? (<>
          <Btn small onClick={goHome} title="Studio home: make something new, the calendar, your work">← Studio</Btn>
          <input value={p.name} disabled={!canEdit} onChange={e => change(d => ({ ...d, name: e.target.value }))} title="The name of this piece" style={{ ...field, width: 'auto', flex: '0 1 280px', minWidth: 110, padding: '6px 10px', fontWeight: 600, resize: 'none' }} />
          <button type="button" onClick={() => setTab('ad')} title="What this is and where it runs — change it under Whole ad"
            style={{ background: 'transparent', border: '1px solid ' + UI.line, color: UI.mut, borderRadius: 8, padding: '5px 9px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {KIND_META[(p.kind || 'video') as AdKindOf].label} · {isFlyer ? (FLYER_SIZES.find(x => x.key === p.format)?.label || p.format) : platformOf(p).label} · {p.format}
          </button>
          {(p.status || 'draft') !== 'draft' ? <span style={{ fontSize: 11, fontWeight: 700, color: p.status === 'approved' ? UI.green : UI.gold, whiteSpace: 'nowrap' }}>{p.status === 'approved' ? '✓ Approved' : 'In review'}</span> : null}
          {canEdit ? (<span style={{ display: 'flex', gap: 3 }}>
            <Btn small disabled={!histN[0]} onClick={() => stepHist(true)} title="Undo (⌘Z)">↶</Btn>
            <Btn small disabled={!histN[1]} onClick={() => stepHist(false)} title="Redo (⇧⌘Z)">↷</Btn>
          </span>) : null}
          <span style={{ fontSize: 11, color: saved === 'dirty' || saved === 'saving' ? UI.gold : UI.mut, whiteSpace: 'nowrap' }}>
            {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Unsaved' : saved === 'saved' ? 'Saved' : ''}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {canEdit && p.moment && (p.kind === 'flyer' || p.kind === 'post') && (() => { const mm = MOMENTS.find(x => x.key === p.moment); return mm && momentAngles(mm, whenShort(mm)).length > 1 ? <Btn small disabled={!!busy} title="The other angles for this moment — swaps the words and the designs (↶ undoes it)" onClick={() => setIdeas({ m: mm, k: p.kind as 'flyer' | 'post', rebuild: true })}>✦ Other ideas</Btn> : null })()}
          <Btn small onClick={() => runAudit()} disabled={!!busy} title="The expert review: hook, idea, rhythm, copy, call to action — with one-click fixes" tone={liveChecks.some(c => c.sev === 'high') ? 'red' : undefined}>{busy === 'audit' ? 'Auditing…' : `Audit${liveChecks.length ? ' · ' + liveChecks.length : ' ✓'}`}</Btn>
          {canEdit && isSpoken ? <Btn small tone={stale || !p.voice ? 'blue' : undefined} disabled={!!busy} onClick={makeVoice} title="Records the whole script as one take and cuts the scenes to it">{busy === 'voice' ? 'Recording…' : p.voice ? (stale ? 'Re-record voice' : 'Voice ✓ · re-record') : 'Make voice'}</Btn> : null}
          {exportPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600, whiteSpace: 'nowrap' }}>Exporting {exportPct}% · keep this tab open</span> : libPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600, whiteSpace: 'nowrap' }}>Saving to the library {libPct}%</span> : (
            <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {isFlyer ? (<>
                <Btn tone="gold" small disabled={!!busy} onClick={exportPng} title="The flyer as an image at full size">Export PNG</Btn>
                <Btn small disabled={!!busy} onClick={exportPdf} title="The flyer as a PDF (Letter prints at 300 dpi)">PDF</Btn>
              </>) : (<>
                <Btn tone="gold" small disabled={!!busy} onClick={exportVideo} title="MP4 with sound, at full size">Export MP4</Btn>
                <Btn small disabled={!!busy} onClick={exportGif} title="An animated GIF, no sound — moves like a post">GIF</Btn>
                <Btn small disabled={!!busy} onClick={exportPng} title="A still of the frame on screen">PNG</Btn>
                {p.scenes.length > 1 ? <Btn small disabled={!!busy} onClick={exportCarousel} title="Every scene as its own photo — an Instagram / Facebook carousel">Carousel</Btn> : null}
              </>)}
            </span>
          )}
          <Btn small on={menu} onClick={() => setMenu(!menu)} title="Status, versions, duplicate, notes, delete">⋯</Btn>
          {menu ? (<>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
            <div style={{ position: 'absolute', right: 12, top: 44, zIndex: 61, width: 300, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: '4px 12px 12px', boxShadow: '0 24px 60px -20px rgba(0,0,0,.9)' }}>
              <Label>Status</Label>
              <div style={{ display: 'flex', gap: 4 }} title="Where this piece is in the team's workflow">
                {([['draft', 'Draft'], ['review', 'In review'], ['approved', 'Approved']] as const).map(([k, l]) => <Btn key={k} small on={(p.status || 'draft') === k} disabled={!canEdit} onClick={() => change(d => ({ ...d, status: k }))}>{k === 'approved' && p.status === k ? '✓ ' : ''}{l}</Btn>)}
              </div>
              {canEdit ? (<>
                <Label>Team notes</Label>
                <textarea rows={3} value={p.notes || ''} onChange={e => change(d => ({ ...d, notes: e.target.value }))} placeholder="For whoever picks this up: what to check, where it runs." style={{ ...field, fontSize: 12 }} />
              </>) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
                <Btn small onClick={() => { setMenu(false); loadVersions() }} title="Earlier saved states of this piece">Versions — go back to an earlier state</Btn>
                {canEdit ? <Btn small onClick={() => duplicateAd()} title="A copy to try a different hook, look or ending">⧉ Duplicate as a variant</Btn> : null}
                {!isFlyer ? (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: UI.mut, padding: '2px 2px' }}>
                    <input type="checkbox" checked={keepCopy} onChange={e => setKeepCopy(e.target.checked)} /> Keep a copy of every MP4 export in Finished videos
                  </label>
                ) : null}
                {!full ? <a href="/ads?full=1" target="_blank" rel="noopener" style={{ fontSize: 11.5, color: UI.mut, textDecoration: 'none', border: '1px solid ' + UI.line, borderRadius: 8, padding: '4px 8px', fontWeight: 600 }}>⤢ Open full screen in a new tab</a> : null}
                {canDelete ? <Btn small tone="red" onClick={async () => { const id = p.id; if (!window.confirm('Delete "' + p.name + '" and its voice takes? This cannot be undone.')) return; setMenu(false); await fetch('/api/ads?id=' + encodeURIComponent(id), { method: 'DELETE' }); setP(null); pRef.current = null; setHome(true); loadList() }} title="Delete this piece">✕ Delete this piece</Btn> : null}
              </div>
            </div>
          </>) : null}
        </>) : (<>
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>Ad Studio</span>
          {flow ? <Btn small onClick={cancelFlow} title="Leave without building">{seed.current?.fresh || starting || !p ? '← Studio' : '← Back to the ad'}</Btn> : null}
          {home && p ? <Btn small onClick={() => setHome(false)} title="Back to the piece you had open">Back to “{p.name.length > 34 ? p.name.slice(0, 32) + '…' : p.name}” →</Btn> : null}
          <span style={{ marginLeft: 'auto' }} />
          {full
            ? <a href="/ads" style={{ fontSize: 11.5, color: UI.mut, textDecoration: 'none', border: '1px solid ' + UI.line, borderRadius: 8, padding: '4px 8px' }} title="Back to Lighthouse">← Lighthouse</a>
            : <a href="/ads?full=1" target="_blank" rel="noopener" style={{ fontSize: 11.5, color: UI.mut, textDecoration: 'none', border: '1px solid ' + UI.line, borderRadius: 8, padding: '4px 8px' }} title="Open the studio on its own, full screen, in a new tab">⤢ Full screen</a>}
        </>)}
      </div>
      {err ? <div style={{ background: notice ? '#3a3016' : '#3a1d1b', color: notice ? '#F0DFB4' : '#F3C2BC', padding: '8px 14px', fontSize: 12.5, display: 'flex', gap: 10 }}><span style={{ flex: 1 }}>{err}</span><button onClick={() => setErr('')} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>Dismiss</button></div> : null}

      {home ? (
        <StudioHome rows={list} canEdit={canEdit} canDelete={canDelete} busy={busy} display={display} last={lastId}
          onMake={makeKind} onMoment={makeMoment} onEventAd={startEventAd} onOpen={id => open(id)} onDelete={quickDelete} onDeleteMany={quickDeleteMany} onDuplicate={quickDuplicate}
          library={lib} onEditVideo={editLibraryVideo} onWatch={v => setWatch(v as LibVideo)} onDeleteVideo={v => delVideo(v as LibVideo)} onUploadVideo={uploadVideo} />
      ) : null}
      <div style={{ display: home ? 'none' : flow ? 'block' : 'grid', gridTemplateColumns: 'minmax(0,1fr) clamp(330px, 27vw, 420px)', gridTemplateRows: 'minmax(0, 1fr)', ...(editing ? { flex: 1, minHeight: 0 } : { minHeight: full ? 'calc(100vh - 210px)' : 560 }) }}>
        {/* ── centre: the start page, the plan, the script, the audit — or the player ── */}
        <div style={{ padding: fit ? 12 : 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 0, minHeight: flow ? (full ? 'calc(100vh - 52px)' : 560) : 0, background: '#0A0D11', ...(editing ? { height: '100%', boxSizing: 'border-box', overflowY: fit ? 'hidden' : 'auto' } : {}) }}>
          {starting && !draft ? (() => {
            // THE START PAGE (Jon, 2026-11-10: "make it easier to use"). It was 8 to 12 screens — how, about, goal,
            // audience, music, look, shape, think, the plan's questions, review — before the plan asked the same
            // questions again. Now it is one page: what it is about, the goal, who it is for, how long, where it
            // runs (look and music only if you want to choose). Then the plan to confirm, then the build.
            const story = st.mode === 'story'
            const H = ({ children, opt }: { children: React.ReactNode; opt?: boolean }) => <p style={{ fontSize: 12.5, fontWeight: 700, margin: '16px 0 6px', color: UI.ink }}>{children}{opt ? <span style={{ fontWeight: 500, color: UI.mut }}> · optional</span> : null}</p>
            const goalRow = (<>
              <H>What should it accomplish?</H>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {GOALS.map(g => <Btn key={g.key} on={st.goal === g.key} title={g.brief.replace(/^Goal: /, '')} onClick={() => setSt(x => ({ ...x, goal: g.key, audience: g.audience }))}>{g.label}</Btn>)}
              </div>
            </>)
            const audRow = (<>
              <H>Who is it for?</H>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {(Object.keys(AUD) as AdAudience[]).map(k => <Btn key={k} on={st.audience === k} title={AUD[k].hint} onClick={() => setSt(x => ({ ...x, audience: k }))}>{AUD[k].label}</Btn>)}
                <input value={st.who} onChange={e => setSt(x => ({ ...x, who: e.target.value }))} placeholder={st.audience === 'guests' ? 'Who exactly? e.g. couples, groups for Art Basel' : st.audience === 'owners' ? 'Who exactly? e.g. owners unhappy with their manager' : 'Who exactly? e.g. realtors in Brickell'} style={{ ...field, flex: 1, minWidth: 220, width: 'auto', padding: '7px 10px' }} />
              </div>
            </>)
            const shapeRow = (<>
              <H>Where will it run?</H>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Btn on={!st.format} onClick={() => setSt(x => ({ ...x, format: '' }))} title="The plan picks the shape that fits">Pick for me</Btn>
                {(['9:16', '4:5', '1:1', '16:9'] as AdFormat[]).map(f => <Btn key={f} on={st.format === f} title={FORMAT_LABEL[f]} onClick={() => setSt(x => ({ ...x, format: f }))}>{f === '9:16' ? 'Reel · Story · TikTok' : f === '4:5' ? 'Feed post' : f === '1:1' ? 'Square' : 'YouTube · web'} <span style={{ opacity: 0.6, fontWeight: 500 }}>{f}</span></Btn>)}
              </div>
            </>)
            const lengthRow = (<>
              <H>How long?</H>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{[15, 30, 45, 60, 90].map(n => <Btn key={n} on={seconds === n} onClick={() => setSeconds(n)}>{n} s</Btn>)}</div>
            </>)
            const more = (<>
              <button type="button" onClick={() => setMoreStart(!moreStart)} style={{ background: 'none', border: 0, color: UI.blue, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 16 }}>
                {moreStart ? '▾' : '▸'} Choose the look and the music yourself <span style={{ color: UI.mut, fontWeight: 500 }}>· {LOOKS.find(l => l.key === st.look)?.label} look · {st.vibe || MUSIC.find(m => m.key === st.music)?.label || sounds.find(x => x.key === st.music)?.name || 'music picked for you'}</span>
              </button>
              {moreStart ? (<>
                <H>Look</H>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 7 }}>
                  {looksShown(st.look).map(l => (
                    <button key={l.key} type="button" title={l.blurb} onClick={() => setSt(x => ({ ...x, look: l.key }))} style={{ padding: 0, border: '2px solid ' + (st.look === l.key ? UI.blue : UI.line), borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'none', color: UI.ink, textAlign: 'left' }}>
                      <span style={{ display: 'block', background: `linear-gradient(135deg, ${l.c.navy2}, ${l.c.deep})`, padding: '10px 10px', fontFamily: display, fontWeight: 800, fontSize: 16, color: l.c.ink }}>Stay <span style={{ color: l.c.gold }}>here</span></span>
                      <span style={{ display: 'block', background: UI.panel2, padding: '5px 8px', fontSize: 11.5, fontWeight: 700 }}>{l.label}</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setMoreLooks(!moreLooks)} style={{ border: '1px dashed ' + UI.line, borderRadius: 10, background: 'transparent', color: UI.mut, fontSize: 12, cursor: 'pointer', minHeight: 60 }}>{moreLooks ? 'Fewer looks' : '+ More looks'}</button>
                </div>
                <H>Music</H>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
                  <button type="button" onClick={() => setSt(x => ({ ...x, music: '', vibe: '' }))} style={{ ...choice(!st.music && !st.vibe), padding: '6px 10px', fontSize: 12.5, fontWeight: 600 }}>Pick for me</button>
                  {MUSIC.filter(m => m.file).map(m => (
                    <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1.5px solid ' + (st.music === m.key ? UI.blue : UI.line), background: st.music === m.key ? '#1d2a3d' : 'transparent', borderRadius: 9, padding: '3px 6px' }}>
                      <Btn small on={hear === m.file} onClick={() => preview(m.file)} title="Listen">{hear === m.file ? '■' : '▶'}</Btn>
                      <button type="button" title={m.mood} onClick={() => setSt(x => ({ ...x, music: m.key, vibe: '' }))} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, color: UI.ink, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</button>
                    </div>
                  ))}
                  {sounds.filter(x => x.kind === 'music').slice(0, 6).map(x => (
                    <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1.5px solid ' + (st.music === x.key ? UI.blue : UI.line), background: st.music === x.key ? '#1d2a3d' : 'transparent', borderRadius: 9, padding: '3px 6px' }}>
                      <Btn small on={hear === x.url} onClick={() => preview(x.url)} title="Listen">{hear === x.url ? '■' : '▶'}</Btn>
                      <button type="button" onClick={() => setSt(s2 => ({ ...s2, music: x.key, vibe: '' }))} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, color: UI.ink, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>♪ {x.name}</button>
                    </div>
                  ))}
                </div>
                <input value={st.vibe} onChange={e => setSt(x => ({ ...x, vibe: e.target.value, music: e.target.value ? '' : x.music }))} placeholder="Or describe a new vibe, e.g. sunset lounge house, warm, upscale — ElevenLabs composes it" style={{ ...field, marginTop: 6 }} />
              </>) : null}
            </>)
            return (
              <div style={{ width: '100%', maxWidth: 820, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.gold }}>{story ? 'New owner story' : 'New video ad'}</span>
                  <span style={{ fontSize: 11.5, color: UI.mut }}>{story ? 'Pick one — it is built and opened for you to edit' : 'One page, then a plan to confirm, then it is built'}</span>
                  <span style={{ marginLeft: 'auto' }}><Btn small onClick={cancelFlow}>Cancel</Btn></span>
                </div>
                {story ? (<>
                  <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '14px 0 4px', letterSpacing: '-0.01em' }}>Which story?</p>
                  <p style={{ fontSize: 12.5, color: UI.mut, margin: '0 0 12px', lineHeight: 1.5 }}>Longer pieces for owners and partners, written from the house facts and filled with photos from the library. Build one, then edit any word, swap photos, make the voice.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8 }}>
                    {STORIES.map(s0 => (
                      <div key={s0.key} style={{ ...card, padding: '11px 12px', display: 'flex', flexDirection: 'column' }}>
                        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{s0.label} <span style={{ fontWeight: 500, color: UI.mut, fontSize: 12 }}>· {s0.length}</span></p>
                        <p style={{ fontSize: 12, color: UI.mut, margin: '4px 0 3px', lineHeight: 1.45, flex: 1 }}>{s0.blurb}</p>
                        <p style={{ fontSize: 11, color: UI.mut, margin: '0 0 8px' }}>For: {s0.who} · {s0.scenes.length} scenes</p>
                        <div><Btn small tone="gold" disabled={!!busy} onClick={() => buildStory(s0)}>{busy === 'template' || busy === 'new' ? 'Building…' : 'Build this story →'}</Btn></div>
                      </div>
                    ))}
                  </div>
                </>) : (<>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 12 }}>
                    {([['describe', '✦ Describe it', 'Tell me in a line. I plan it with you, write the script, then build.'], ['script', '📝 I have a script', 'Paste it. I lay it out into scenes and build the video.'], ['template', '▦ Template', 'A ready layout, filled with our photos. No writing.'], ['revamp', '↻ Revamp one of ours', 'Take an ad we made and make it fresher.'], ['blank', '□ Blank', 'Empty — build it scene by scene.']] as const).map(([k, l, d]) => (
                      <Btn key={k} on={st.mode === k} title={d} onClick={() => { setSt(x => ({ ...x, mode: k })); setErr('') }}>{l}</Btn>
                    ))}
                  </div>

                  {st.mode === 'describe' ? (<>
                    <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 8px', letterSpacing: '-0.01em' }}>What’s the ad about?</p>
                    <textarea autoFocus value={st.prompt} onChange={e => setSt(x => ({ ...x, prompt: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) goPlan() }} rows={3}
                      placeholder="e.g. a cool video for Amrit · a 15-second Reel for Art Basel weekend at 17WEST · why owners switch to Stay" style={{ ...field, fontSize: 15 }} />
                    <p style={{ fontSize: 11.5, color: UI.mut, margin: '6px 0 0' }}>One line is enough. Name a property and its photos are used. <button type="button" onClick={() => setIdeasOpen(!ideasOpen)} style={{ background: 'none', border: 0, color: UI.blue, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: 0 }}>{ideasOpen ? 'Hide the ideas' : 'Need an idea?'}</button></p>
                    {ideasOpen ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6, marginTop: 8, maxHeight: 250, overflowY: 'auto' }}>
                        {IDEAS.map(idea => (
                          <button key={idea.key} type="button" onClick={() => useIdea(idea)} style={{ ...choice(false), padding: '8px 10px' }}>
                            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{idea.title} <span style={{ fontWeight: 500, color: UI.mut }}>· {GOALS.find(g => g.key === idea.goal)?.label}</span></span>
                            <span style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 3, lineHeight: 1.4 }}>{idea.why}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {goalRow}{audRow}{lengthRow}{shapeRow}{more}
                    <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Btn tone="gold" disabled={!!busy || !st.prompt.trim()} onClick={() => goPlan()}>{busy === 'plan' ? 'Planning… about 20 seconds' : 'Plan it →'}</Btn>
                      <span style={{ fontSize: 11.5, color: UI.mut, flex: 1, minWidth: 200 }}>I sharpen this into a plan, check our photos, and ask only what would change the ad. Nothing is built until you say so.</span>
                      <button type="button" disabled={!!busy || !st.prompt.trim()} onClick={() => goPlan(true)} title="Writes and builds it straight away with the choices above" style={{ background: 'none', border: 0, color: UI.blue, cursor: 'pointer', fontSize: 11.5, padding: 0, opacity: busy || !st.prompt.trim() ? 0.5 : 1 }}>{busy === 'write' ? 'Building…' : 'Skip the plan — build it now'}</button>
                    </div>
                  </>) : st.mode === 'script' ? (<>
                    <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 8px', letterSpacing: '-0.01em' }}>Paste your script</p>
                    <textarea autoFocus value={st.script} onChange={e => setSt(x => ({ ...x, script: e.target.value }))} rows={8} placeholder={'Paste the voiceover script. Line breaks help me cut scenes.\n\ne.g.\nWake up to the ocean.\nRooftop pool. Sunset views.\nAmrit, Singer Island.\nBook your stay at stay-hospitality.com.'} style={{ ...field, fontSize: 14 }} />
                    <p style={{ fontSize: 11.5, color: UI.mut, margin: '6px 0 0' }}>{st.script.trim() ? `${st.script.trim().split(/\s+/).length} words · about ${Math.round(st.script.trim().split(/\s+/).length / 2.5)} s spoken · ` : ''}Your words are kept as written. You review the laid-out script before the video is built.</p>
                    {audRow}{shapeRow}{more}
                    <div style={{ marginTop: 20 }}><Btn tone="gold" disabled={!!busy || !st.script.trim()} onClick={async () => { if (await layOutScript()) setStarting(false) }}>{busy === 'script' ? 'Laying it out…' : 'Lay out my script →'}</Btn></div>
                  </>) : st.mode === 'template' ? (<>
                    <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 4px', letterSpacing: '-0.01em' }}>Pick a template</p>
                    <p style={{ fontSize: 12.5, color: UI.mut, margin: '0 0 10px' }}>A ready-made ad that fills itself with photos from the library. Every word is editable after.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 7 }}>
                      {TEMPLATES.map(tp => (
                        <button key={tp.key} type="button" disabled={!!busy} onClick={() => startTemplate(tp)} style={{ ...choice(false), padding: '10px 12px' }}>
                          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{tp.label} <span style={{ color: UI.mut, fontWeight: 500, fontSize: 11.5 }}>· {tp.format} · {AUD[tp.audience].label.toLowerCase()}</span></span>
                          <span style={{ display: 'block', fontSize: 11.5, color: UI.mut, marginTop: 3, lineHeight: 1.45 }}>{tp.blurb}</span>
                        </button>
                      ))}
                    </div>
                    {busy === 'template' || busy === 'new' ? <p style={{ fontSize: 12, color: UI.gold, marginTop: 10 }}>Filling it with photos from the library…</p> : null}
                  </>) : st.mode === 'revamp' ? (<>
                    <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 8px', letterSpacing: '-0.01em' }}>Which ad are we revamping?</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                      {list.filter(a => (a.kind || 'video') !== 'flyer').map(a => (
                        <button key={a.id} type="button" onClick={() => setSt(x => ({ ...x, from: a.id }))} style={{ ...choice(st.from === a.id), padding: '7px 10px' }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                          <span style={{ fontSize: 11, color: UI.mut }}>{a.format} · {a.scenes} scenes</span>
                        </button>
                      ))}
                      {!list.length ? <p style={{ fontSize: 12, color: UI.mut }}>No ads to revamp yet — pick Describe it.</p> : null}
                    </div>
                    <H opt>What should change?</H>
                    <textarea value={st.prompt} onChange={e => setSt(x => ({ ...x, prompt: e.target.value }))} rows={2} placeholder="e.g. make it for guests, faster cuts, open on the rooftop (or leave empty: just make it fresher)" style={{ ...field, fontSize: 13.5 }} />
                    {goalRow}{audRow}{more}
                    <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
                      <Btn tone="gold" disabled={!!busy || !st.from} onClick={startGo}>{busy ? 'Working…' : 'Revamp it →'}</Btn>
                      <span style={{ fontSize: 11.5, color: UI.mut }}>The original stays as it is — the revamp is a new ad.</span>
                    </div>
                  </>) : (<>
                    <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 4px', letterSpacing: '-0.01em' }}>A blank ad</p>
                    <p style={{ fontSize: 12.5, color: UI.mut, margin: 0 }}>Two empty scenes to start from. Add scenes, pick designs and photos yourself.</p>
                    {audRow}{shapeRow}
                    <div style={{ marginTop: 20 }}><Btn tone="gold" disabled={!!busy} onClick={startGo}>{busy ? 'Working…' : 'Create it →'}</Btn></div>
                  </>)}
                </>)}
              </div>
            )
          })() : showAudit && p ? (
            <div style={{ width: '100%', maxWidth: 780, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {(() => { const sc0 = audit ? audit.score : auditScore(liveChecks); const col = sc0 >= 80 ? UI.green : sc0 >= 60 ? UI.gold : UI.red; return (
                  <div style={{ width: 72, height: 72, borderRadius: 36, border: '4px solid ' + col, display: 'grid', placeItems: 'center', fontFamily: display, fontWeight: 800, fontSize: 24, color: col }}>{sc0}</div>
                ) })()}
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: display, fontSize: 20, fontWeight: 800, margin: 0 }}>Ad audit · {p.name}</p>
                  <p style={{ fontSize: 12.5, color: UI.mut, margin: '3px 0 0' }}>{busy === 'audit' ? 'The creative director is reading it… about 20 seconds.' : audit?.verdict || (audit ? 'Checks only — the review did not come back.' : 'Automatic checks. Press Run the review for the expert pass.')}</p>
                </div>
                <span style={{ display: 'flex', gap: 4 }}>
                  <Btn small disabled={!!busy} onClick={() => runAudit()}>{audit ? 'Run again' : 'Run the review'}</Btn>
                  <Btn small onClick={() => { setShowAudit(false); setFirstPass(null) }}>Close</Btn>
                </span>
              </div>
              {firstPass ? (
                <div style={{ marginTop: 14, background: 'rgba(76,196,136,0.08)', border: '1px solid rgba(76,196,136,0.35)', borderRadius: 10, padding: '10px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <b style={{ fontSize: 13 }}>First pass — touched up before you saw it</b>
                    <span style={{ fontSize: 12, color: UI.mut }}>Checks {firstPass.before} → <b style={{ color: firstPass.after >= firstPass.before ? UI.green : UI.gold }}>{firstPass.after}</b></span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <Btn small tone="gold" onClick={() => { setShowAudit(false); setFirstPass(null); start(0) }}>▶ Watch it</Btn>
                    </span>
                  </div>
                  {firstPass.changes.length
                    ? <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>{firstPass.changes.map((x, i) => <li key={i}>{x}</li>)}</ul>
                    : <p style={{ fontSize: 12.5, margin: '6px 0 0', color: UI.mut }}>Nothing needed touching — end card, captions, transitions, photos and pacing were already right.</p>}
                  <p style={{ fontSize: 11, color: UI.mut, margin: '6px 0 0' }}>Below: what the expert review suggests (apply one at a time or all), then the checks still open. Nothing here changes what is said without you pressing Apply.</p>
                </div>
              ) : null}
              {audit?.strengths?.length ? (
                <>
                  <Label>What works</Label>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>{audit.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              ) : null}
              {audit?.issues?.length ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline' }}><Label>Expert fixes</Label>{canEdit ? <span style={{ marginLeft: 'auto' }}><Btn small tone="blue" onClick={() => audit.issues.forEach((_, i) => applyIssue(i))}>Apply all</Btn></span> : null}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {audit.issues.map((is, k) => (
                      <div key={k} style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 9, padding: '8px 11px', opacity: is.done ? 0.5 : 1 }}>
                        <p style={{ fontSize: 12.5, margin: 0 }}><button onClick={() => pick(is.scene)} style={{ background: 'none', border: 0, color: UI.gold, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Scene {is.scene + 1}</button> · {is.problem}</p>
                        <p style={{ fontSize: 12, color: UI.mut, margin: '3px 0 0' }}>{is.fix}</p>
                        {is.patch ? <p style={{ fontSize: 12, margin: '4px 0 0', color: UI.ink }}>{is.patch.head ? <>Headline → <b>{String(is.patch.head).replace(/\*\*/g, '')}</b> </> : null}{is.patch.vo ? <>· Line → <i>{is.patch.vo}</i></> : null}{is.patch.kind ? <> · Design → {is.patch.kind}</> : null}</p> : null}
                        {canEdit && (is.patch || is.remove) ? <div style={{ marginTop: 6 }}><Btn small on={is.done} disabled={is.done} onClick={() => applyIssue(k)}>{is.done ? 'Applied' : is.remove ? 'Delete the scene' : 'Apply'}</Btn></div> : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              <Label>Checks</Label>
              {liveChecks.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {liveChecks.map((c, k) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: c.sev === 'high' ? UI.red : c.sev === 'med' ? UI.gold : UI.mut, flex: 'none' }} />
                      {c.scene != null ? <button onClick={() => pick(c.scene!)} style={{ background: 'none', border: 0, color: UI.gold, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12.5 }}>Scene {c.scene + 1}</button> : null}
                      <span style={{ flex: 1 }}>{c.msg}</span>
                      {canEdit && c.fix ? <Btn small onClick={() => applyCheck(c)}>{c.fix.label}</Btn> : null}
                    </div>
                  ))}
                </div>
              ) : <p style={{ fontSize: 12.5, color: UI.green }}>All checks pass: hook, end card, captions, photos, numbers, length.</p>}
              {audit?.note ? <p style={{ fontSize: 11, color: UI.mut, marginTop: 8 }}>{audit.note}</p> : null}
            </div>
          ) : draft ? (
            <div style={{ width: '100%', maxWidth: 820, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: display, fontSize: 22, fontWeight: 800 }}>The script — read it, fix it, build</span>
                <span style={{ fontSize: 12, color: UI.mut }}>{draft.scenes.length} scenes · about {Math.round(draft.scenes.reduce((a, x) => a + (x.vo.trim() ? x.vo.trim().split(/\s+/).length / 2.55 + 1 : 3), 0) + 4)}s · {AUD[draft.settings.audience].label} · {draft.settings.format}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <Btn small onClick={copyScript} title="Copies the whole script as text">Copy</Btn>
                  <Btn small onClick={() => { setDraft(null); if (!plan) setStarting(true) }}>{plan ? '← Plan' : '← Back'}</Btn>
                </span>
              </div>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ ...field, fontWeight: 700, marginTop: 10 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
                {draft.scenes.map((x, k) => {
                  const put = (patch: Partial<AdScene>) => setDraft({ ...draft, scenes: draft.scenes.map((y, j) => (j === k ? { ...y, ...patch } : y)) })
                  return (
                    <div key={x.id + k} style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderLeft: '4px solid ' + KIND_COLOR[x.kind], borderRadius: 9, padding: '9px 11px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.mut }}>Scene {k + 1}{x.act ? <span style={{ color: ACT_COLOR[x.act] }}> · {ACT_LABEL[x.act]}</span> : null} · {KINDS.find(q => q.kind === x.kind)?.label}</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                          <Btn small disabled={k === 0} onClick={() => { const a = draft.scenes.slice(); [a[k - 1], a[k]] = [a[k], a[k - 1]]; setDraft({ ...draft, scenes: a }) }}>↑</Btn>
                          <Btn small disabled={k === draft.scenes.length - 1} onClick={() => { const a = draft.scenes.slice(); [a[k + 1], a[k]] = [a[k], a[k + 1]]; setDraft({ ...draft, scenes: a }) }}>↓</Btn>
                          <Btn small tone="red" disabled={draft.scenes.length < 2} onClick={() => setDraft({ ...draft, scenes: draft.scenes.filter((_, j) => j !== k) })}>✕</Btn>
                        </span>
                      </div>
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '6px 0 3px' }}>VOICEOVER</p>
                      <textarea value={x.vo} onChange={e => put({ vo: e.target.value })} rows={2} placeholder="(music only)" style={{ ...field, fontSize: 14 }} />
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '6px 0 3px' }}>ON SCREEN</p>
                      <input value={x.head} onChange={e => put({ head: e.target.value })} style={{ ...field, fontSize: 12.5 }} />
                      {riskyWords(x.vo).length ? <p style={{ fontSize: 11, color: UI.red, margin: '4px 0 0' }}>The voice says {riskyWords(x.vo).join(' and ')} wrong — keep it on screen only</p> : null}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
                <input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="Want changes? e.g. warmer, shorter, open with the sunset" style={{ ...field, flex: 1 }} />
                <Btn disabled={!!busy} onClick={rewriteDraft}>{busy === 'script' ? 'Rewriting…' : 'Rewrite'}</Btn>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <Btn tone="gold" disabled={!!busy} onClick={async () => { setBusy('write'); await applyScenes(draft.name, draft.scenes, draft.settings); setBusy('') }}>{busy === 'write' ? 'Building… finding photos' : 'Build the video from this script →'}</Btn>
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 8 }}>Photos, timing and looks are laid out from this script. Then Make voice records it in one take.</p>
            </div>
          ) : plan ? (
            <div style={{ width: '100%', maxWidth: 820, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: display, fontSize: 22, fontWeight: 800 }}>The plan — confirm it</span>
                <span style={{ fontSize: 12, color: UI.mut }}>Change anything, answer the questions, then build. Nothing is saved yet.</span>
              </div>
              <Label>The ad</Label>
              <input value={plan.name} onChange={e => setPlan({ ...plan, name: e.target.value })} style={{ ...field, fontWeight: 700, marginBottom: 6 }} />
              <textarea value={plan.brief} onChange={e => setPlan({ ...plan, brief: e.target.value })} rows={3} style={field} />
              {plan.property ? <p style={{ fontSize: 12, color: UI.gold, margin: '6px 0 0' }}>Property: {plan.property} · photos come from this property only</p> : null}
              {plan.angle ? <p style={{ fontSize: 12.5, margin: '8px 0 0' }}><b>Angle:</b> {plan.angle}</p> : null}
              {plan.hook ? <p style={{ fontSize: 12.5, margin: '4px 0 0' }}><b>Opens on:</b> “{plan.hook}”</p> : null}
              {plan.warnings.length ? <div style={{ marginTop: 8 }}>{plan.warnings.map((w, i) => <p key={i} style={{ fontSize: 11.5, color: '#F3C2BC', margin: '2px 0' }}>⚠ {w}</p>)}</div> : null}

              <Label>Settings</Label>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ display: 'flex', gap: 4 }}>{(Object.keys(AUD) as AdAudience[]).map(k => <Btn key={k} small on={plan.settings.audience === k} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, audience: k } })}>{AUD[k].label}</Btn>)}</span>
                <span style={{ display: 'flex', gap: 4 }}>{(Object.keys(FORMATS) as AdFormat[]).filter(f => f !== 'letter').map(f => <Btn key={f} small on={plan.settings.format === f} title={FORMAT_LABEL[f]} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, format: f } })}>{f}</Btn>)}</span>
                <span style={{ display: 'flex', gap: 4 }}>{[15, 30, 45, 60, 90].map(n => <Btn key={n} small on={plan.settings.seconds === n} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, seconds: n } })}>{n}s</Btn>)}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                <Btn small on={planMusic} onClick={() => setPlanMusic(!planMusic)} title="The track picked for this ad — press to choose another">♪ {MUSIC.find(m => m.key === plan.settings.music)?.label || sounds.find(x => x.key === plan.settings.music)?.name || 'Music picked for you'} · {planMusic ? 'done' : 'change'}</Btn>
                {planMusic ? MUSIC.filter(m => m.file).map(m => <Btn key={m.key} small on={plan.settings.music === m.key} title={m.mood} onClick={() => { setPlan({ ...plan, settings: { ...plan.settings, music: m.key } }); preview(m.file) }}>{hear === m.file ? '■ ' : '▶ '}{m.label}</Btn>) : null}
              </div>

              {plan.questions.length ? <Label>A few questions</Label> : null}
              {plan.questions.map(q => (
                <div key={q.id} style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 5px' }}>{q.q}</p>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {q.options.map((o, k) => <Btn key={o} small on={(answers[q.id] || q.options[0]) === o} onClick={() => setAnswers(a => ({ ...a, [q.id]: o }))}>{o}{k === 0 ? ' ★' : ''}</Btn>)}
                  </div>
                </div>
              ))}

              <Label>Scene plan</Label>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: UI.ink }}>
                {plan.outline.map((o, i) => <li key={i}>{o.replace(/^\d+[.)]\s*/, '')}</li>)}
              </ol>

              <Label>Anything else?</Label>
              <input value={planNote} onChange={e => setPlanNote(e.target.value)} placeholder="Optional, e.g. lead with the rooftop, end on the sunset shot" style={field} />
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <Btn tone="gold" disabled={!!busy} onClick={scriptFromPlan} title="Writes the full script for you to read and edit, then you build the video from it">{busy === 'script' ? 'Writing the script…' : 'Write the script →'}</Btn>
                <Btn disabled={!!busy} onClick={buildFromPlan} title="Writes it and builds the video in one go">{busy === 'write' ? 'Building the ad…' : p && p.scenes.length > 1 && !seed.current?.fresh ? 'Build it now (replaces this ad’s scenes)' : 'Build the video now'}</Btn>
                <Btn disabled={!!busy} onClick={replan} title="Plans again with your answers and note">{busy === 'plan' ? 'Thinking…' : 'Rethink with my answers'}</Btn>
                {seed.current?.fresh ? <Btn disabled={!!busy} onClick={() => { setPlan(null); setStarting(true) }} title="Back to the page before, with what you wrote">← Back</Btn> : null}
                <Btn disabled={!!busy} onClick={cancelFlow}>Cancel</Btn>
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 8 }}>★ = my recommendation. Nothing is built or saved until you press build.</p>
            </div>
          ) : p ? (
            <div style={{ display: 'flex', gap: 12, width: '100%', flex: 1, minHeight: 0 }}>
              {/* the player column — or, in the big preview, the whole window */}
              <div style={theater
                ? { position: 'fixed', inset: 0, zIndex: 70, background: '#05070A', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px 16px' }
                : { flex: showScript ? '0 1 ' + playerBasis : '1 1 auto', maxWidth: showScript ? '60%' : undefined, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {theater ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: display, fontWeight: 800, fontSize: 15 }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: UI.mut }}>Preview · {platformOf(p).label} · {p.format}</span>
                    <span style={{ marginLeft: 'auto' }}><Btn small onClick={() => setTheater(false)} title="Back to the editor (Esc)">✕ Close preview</Btn></span>
                  </div>
                ) : null}
                <div ref={setStageEl} style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  <div onClick={() => { if (!isFlyer) play() }} title={isFlyer ? undefined : 'Click to play or pause'} style={{ position: 'relative', width: picW, height: picH, cursor: isFlyer ? 'default' : 'pointer' }}>
                    <canvas ref={canvasRef} width={cvW} height={cvH} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 8, background: '#000', boxShadow: '0 20px 50px -25px rgba(0,0,0,.8)' }} />
                    <canvas ref={safeRef} width={cvW} height={cvH} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', borderRadius: 8 }} />
                    {!isFlyer && !playing && tl && t < 0.05 ? <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 64, height: 64, borderRadius: 32, background: 'rgba(0,0,0,.55)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, pointerEvents: 'none' }}>▶</span> : null}
                  </div>
                </div>
                {isFlyer ? (
                  <div style={{ fontSize: 12, color: UI.mut, textAlign: 'center' }}>
                    {FLYER_SIZES.find(x => x.key === p.format)?.label} · {FORMATS[p.format][0]}×{FORMATS[p.format][1]} · edit the words here, the photo and design on the right
                  </div>
                ) : (<>
                  {/* the scrub bar: drag to any moment */}
                  <input type="range" min={0} max={tl ? tl.total : 1} step={0.05} value={Math.min(t, tl ? tl.total : 1)} onChange={e => seek(Number(e.target.value))} title="Drag to any moment"
                    style={{ width: '100%', accentColor: UI.gold, margin: 0, height: 14, cursor: 'pointer' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Btn tone="gold" onClick={play} title="Play / pause (space)">{playing ? '❚❚ Pause' : '▶ Play'}</Btn>
                    <Btn small onClick={() => seek(0)} title="Back to the start">⏮</Btn>
                    <Btn small disabled={sel === 0} onClick={() => pick(sel - 1)} title="Previous scene (←)">‹</Btn>
                    <Btn small disabled={sel >= p.scenes.length - 1} onClick={() => pick(sel + 1)} title="Next scene (→)">›</Btn>
                    <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: UI.ink, whiteSpace: 'nowrap' }}>{fmtT(t)} <span style={{ color: UI.mut }}>/ {tl ? fmtT(tl.total) : '0:00'}</span></span>
                    {!showScript ? <span style={{ fontSize: 12, whiteSpace: 'nowrap', color: hasVoice ? UI.green : UI.gold }} title={hasVoice ? 'The scenes are cut to the recorded voice' : 'Scene lengths are estimated from the words until the voice is recorded'}>{p.kind === 'post' ? 'Loop' : hasVoice ? '● Timed to the voice' : p.voice ? '● Script changed — re-record' : '○ Estimated timing'}</span> : null}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {!theater && (platformOf(p).safe.bottom || platformOf(p).safe.top) ? <Btn small on={safe} onClick={() => setSafe(!safe)} title="Shows what the app's own buttons cover on this platform — keep words out of the red">Safe zones</Btn> : null}
                      {isSpoken && !theater ? <Btn small on={beside} onClick={toggleBeside} title="Show or hide the script beside the player — hide it for a bigger picture">Script</Btn> : null}
                      <Btn small on={theater} onClick={() => setTheater(!theater)} title="The player alone, as big as the window (F · Esc closes)">⤢ {theater ? 'Exit preview' : 'Preview'}</Btn>
                    </span>
                  </div>
                </>)}
                {/* the words on screen, right under the picture, when the script is not showing */}
                {sc && canEdit && !showScript && !theater ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }} title="The words of the scene on screen">
                    <input value={sc.head} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Headline on screen — **gold** a word" style={{ ...field, padding: '8px 10px', fontSize: 13.5, fontWeight: 700 }} />
                    {isSpoken
                      ? <input value={sc.vo} onChange={e => setScene(sel, { vo: e.target.value })} placeholder="Spoken line" style={{ ...field, padding: '8px 10px', fontSize: 13.5 }} />
                      : <input value={sc.sub} onChange={e => setScene(sel, { sub: e.target.value })} placeholder="Line under the headline" style={{ ...field, padding: '8px 10px', fontSize: 13.5 }} />}
                  </div>
                ) : null}
              </div>
              {tl && showScript ? (
                <div style={{ flex: '1 1 0', minWidth: 340, minHeight: 0, display: 'flex' }}>
                  <AdScript p={p} tl={tl} t={t} playing={playing} sel={sel} canEdit={canEdit} voiced={hasVoice} stale={!!p.voice && !hasVoice} display={display} fill
                    picked={picked} onTogglePick={togglePick}
                    onPick={i => pick(i)}
                    onPlayFrom={i => { stop(); setSel(i); start(tl.starts[i]) }}
                    setScene={setScene}
                    move={move}
                    del={delSceneAt}
                    addAfter={i => { change(d => { const a = d.scenes.slice(); a.splice(i + 1, 0, { id: newSceneId(d), kind: 'cinema', vo: '', head: '', sub: '', items: [], photos: (d.scenes[i]?.photos || []).slice(0, 1) }); return { ...d, scenes: a } }); setSel(i + 1) }}
                    setScenes={scenes => change(d => ({ ...d, scenes }))} />
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: UI.mut, maxWidth: 380 }}>
              <p style={{ fontFamily: display, fontSize: 22, color: UI.ink, fontWeight: 800 }}>Nothing open</p>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>Pick something to make, or open a piece from Your work.</p>
              <div style={{ marginTop: 12 }}><Btn tone="gold" onClick={goHome}>← Studio home</Btn></div>
            </div>
          )}
        </div>

        {/* ── right: one panel, two tabs — this scene, or the whole ad ── */}
        <div ref={panelRef} style={{ display: flow ? 'none' : 'block', borderLeft: '1px solid ' + UI.line, padding: '0 14px 14px', background: UI.panel, minWidth: 0, overflowY: 'auto', ...(editing ? { height: '100%', boxSizing: 'border-box' } : { maxHeight: full ? 'calc(100vh - 52px)' : 820 }) }}>
          {p && sc ? (
            <>
              <div style={{ position: 'sticky', top: 0, zIndex: 5, background: UI.panel, padding: '10px 0 8px', display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid ' + UI.line }}>
                {([['scene', isFlyer ? 'Words · photo · design' : 'Scene ' + (sel + 1) + ' of ' + p.scenes.length, 'This scene: its words, photos, design, motion'], ['ad', isFlyer ? 'Size · look' : 'Whole ad', isFlyer ? 'The size and the look of the flyer' : 'The whole ad: where it runs, look, music, voice, captions']] as const).map(([k, l, tip]) => (
                  <button key={k} type="button" title={tip} onClick={() => setTab(k)} style={{ flex: 1, background: tab === k ? '#2A3442' : 'transparent', color: tab === k ? UI.ink : UI.mut, border: '1px solid ' + (tab === k ? '#3A4657' : UI.line), borderRadius: 8, padding: '7px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</button>
                ))}
                <button type="button" onClick={() => setAllFolds(!['ai', 'design', 'words', 'photos', 'format', 'look', 'music'].every(k => folded[k]))} title="Collapse or open every section" style={{ background: 'none', border: 0, color: UI.mut, fontSize: 13, cursor: 'pointer', padding: '0 4px' }}>⇕</button>
              </div>
              {tab === 'scene' ? (<div style={{ display: 'flex', flexDirection: 'column' }}>
              {(() => { const n = targetIdx().length; return n > 1 ? (
                <div style={{ marginTop: 12, background: 'rgba(210,176,119,0.1)', border: '1px solid rgba(210,176,119,0.45)', borderRadius: 9, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <b style={{ fontSize: 12.5, color: UI.gold }}>{n} scenes selected</b>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <Btn small onClick={pickAll} disabled={n === p.scenes.length}>All</Btn>
                      <Btn small onClick={() => setPicked([])}>Clear</Btn>
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: UI.mut, margin: '4px 0 0', lineHeight: 1.45 }}>Design, motion, graphics, sound, hold time and photo darkness change on all {n}. Words and photos stay per scene — those edit scene {sel + 1}.</p>
                </div>
              ) : null })()}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }} title="The scene being edited">{(sc.head || sc.vo || KINDS.find(k => k.kind === sc.kind)?.label || '').replace(/\*\*/g, '').replace(/\n/g, ' ')}</span>
                {canEdit && p.scenes.length > 1 && !picked.length ? <button type="button" onClick={pickAll} title="Select every scene, then change design, motion or graphics on all of them" style={{ background: 'none', border: 0, color: UI.gold, fontSize: 10.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Select all</button> : null}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <Btn small disabled={sel === 0} onClick={() => move(sel, sel - 1)} title="Earlier">↑</Btn>
                  <Btn small disabled={sel === p.scenes.length - 1} onClick={() => move(sel, sel + 1)} title="Later">↓</Btn>
                  <Btn small onClick={dupScene} title="Duplicate">⧉</Btn>
                  <Btn small tone="red" disabled={p.scenes.length < 2} onClick={delScene} title="Delete scene">✕</Btn>
                </span>
              </div>
              {canEdit ? (
                <Fold id="ai" title="Change with AI" folded={!!folded['ai']} onToggle={toggleFold}>
                <div style={{ marginTop: 10, background: '#18243a', border: '1px solid #2b4470', borderRadius: 9, padding: 9 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 6px', color: '#BFD4FA' }}>✦ Change this {isFlyer ? 'flyer' : 'scene'} with AI</p>
                  <textarea value={ask} onChange={e => setAsk(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askScene(ask) }}
                    placeholder="e.g. make it punchier · show the rooftop pool · turn it into three numbers · mention Art Basel" style={{ ...field, fontSize: 12.5 }} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    <Btn small tone="blue" disabled={!!busy || !ask.trim()} onClick={() => askScene(ask)}>{busy === 'scene' ? 'Changing…' : 'Change it'}</Btn>
                    {['Punchier', 'Shorter', 'New photos', 'Different look'].map(x => <Btn key={x} small disabled={!!busy} onClick={() => askScene(x === 'New photos' ? 'Swap in different, stronger photos that fit this line' : x === 'Different look' ? 'Pick a different scene kind that shows this better' : x === 'Shorter' ? 'Make the voice line and headline shorter' : 'Make the line and headline punchier')}>{x}</Btn>)}
                    {undo && undo.id === sc.id ? <Btn small onClick={undoScene} title="Back to the scene before the AI change">↶ Undo</Btn> : null}
                  </div>
                </div>
                </Fold>
              ) : null}
              <div style={{ order: isSpoken ? 2 : 0 }}>
              <Fold id="words" title="Words & layout" folded={!!folded['words']} onToggle={toggleFold}>
              {/* SIGNATURE LAYOUT (2026-11-12): pick how this scene is drawn, or leave it to the content. */}
              {wearsSignature(p) ? (<>
                <Label>Layout</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <Btn small on={!sc.sig} disabled={!canEdit} onClick={() => setScene(sel, { sig: undefined })} title="Picked from what the scene holds">Auto</Btn>
                  {SIG_LAYOUTS.map(l => <Btn key={l.key} small on={sc.sig === l.key} disabled={!canEdit} title={l.hint} onClick={() => setScene(sel, { sig: l.key })}>{l.label}</Btn>)}
                </div>
                {PRO_KINDS.indexOf(sc.kind) < 0 ? (<>
                  <Label>Eyebrow (small line above the headline)</Label>
                  <input value={sc.eyebrow || ''} disabled={!canEdit} maxLength={80} onChange={e => setScene(sel, { eyebrow: e.target.value })} placeholder="e.g. 17WEST · Miami" style={{ ...field, padding: '6px 9px' }} />
                </>) : null}
                {['list', 'numbers', 'end'].includes(sc.sig || '') && PRO_KINDS.indexOf(sc.kind) < 0 ? (<>
                  <Label>{sc.sig === 'numbers' ? 'Figures · one per line, number|label' : sc.sig === 'end' ? 'Button text (first line)' : 'Rows · one per line, title|detail'}</Label>
                  <textarea rows={Math.min(6, Math.max(2, sc.items.length + 1))} value={sc.items.join('\n')} disabled={!canEdit} onChange={e => setScene(sel, { items: e.target.value.split('\n') })} style={{ ...field, fontSize: 12.5 }} />
                </>) : null}
              </>) : null}
              {sc.kind === 'poster' ? (<>
                <Label>Poster style</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {([['', 'Auto'], ['dark', 'Dark photo'], ['gallery', 'Gallery mat'], ['neon', 'Neon'], ['band', 'Colour band']] as [string, string][]).map(([v, l]) => (
                    <Btn key={v} small on={(sc.items[2] || '') === v} disabled={!canEdit} onClick={() => setScene(sel, { items: [sc.items[0] || '', sc.items[1] || '', v] })}>{l}</Btn>
                  ))}
                </div>
                <Label>Date pill</Label>
                <input value={sc.items[0] || ''} disabled={!canEdit} onChange={e => setScene(sel, { items: [e.target.value, sc.items[1] || '', sc.items[2] || ''] })} placeholder="e.g. DEC 20–26 (leave empty for none)" style={field} />
                <Label>Button / call to action</Label>
                <input value={sc.items[1] || ''} disabled={!canEdit} onChange={e => setScene(sel, { items: [sc.items[0] || '', e.target.value, sc.items[2] || ''] })} placeholder="e.g. Book at stay-hospitality.com" style={field} />
              </>) : null}
              <Label>{sc.kind === 'poster' ? 'Kicker (top line)' : 'Badge (sticker)'}</Label>
              <input value={sc.badge || ''} disabled={!canEdit} maxLength={22} onChange={e => setScene(sel, { badge: e.target.value })} placeholder="Optional, e.g. Oceanfront · Book direct · Rooftop pool" style={{ ...field, padding: '6px 9px' }} />
              {/* QR CODE ON THE SCENE (Jon, 2026-11-12): one of the free tools, the digital magazine, or any link. */}
              <Label>QR code</Label>
              <select value={!sc.qr ? '' : [TOOL_LINK('income'), TOOL_LINK('inventory'), TOOL_LINK('')].includes(sc.qr) ? sc.qr : 'custom'} disabled={!canEdit}
                onChange={e => { const v = e.target.value; setScene(sel, v === '' ? { qr: '', qrLabel: '' } : v === 'custom' ? { qr: sc.qr && ![TOOL_LINK('income'), TOOL_LINK('inventory'), TOOL_LINK('')].includes(sc.qr) ? sc.qr : 'https://', qrLabel: sc.qrLabel || 'Scan to learn more' } : { qr: v, qrLabel: v === TOOL_LINK('income') ? 'Scan for a free projection' : v === TOOL_LINK('inventory') ? 'Scan for the free checklist' : 'Scan for the free tools' }) }} style={{ ...field, padding: '6px 9px' }}>
                <option value="">None</option>
                <option value={TOOL_LINK('income')}>Projections calculator</option>
                <option value={TOOL_LINK('inventory')}>Supply and linen checklist</option>
                <option value={TOOL_LINK('')}>Both free tools</option>
                <option value="custom">Another link…</option>
              </select>
              {sc.qr ? (<>
                {![TOOL_LINK('income'), TOOL_LINK('inventory'), TOOL_LINK('')].includes(sc.qr) ? <input value={sc.qr} disabled={!canEdit} onChange={e => setScene(sel, { qr: e.target.value.trim() })} placeholder="https://…" style={{ ...field, padding: '6px 9px', marginTop: 6 }} /> : null}
                <input value={sc.qrLabel || ''} disabled={!canEdit} maxLength={34} onChange={e => setScene(sel, { qrLabel: e.target.value })} placeholder="Line under the code, e.g. Scan for a free projection" style={{ ...field, padding: '6px 9px', marginTop: 6 }} />
              </>) : null}

              {!isFlyer ? (<>
              <Label>Voice line</Label>
              <textarea rows={3} value={sc.vo} disabled={!canEdit} onChange={e => setScene(sel, { vo: e.target.value })} placeholder="Leave empty for a music-only beat" style={field} />
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 4 }}>
                {sc.vo.trim() ? `${sc.vo.trim().split(/\s+/).length} words · about ${(sc.vo.trim().split(/\s+/).length / 2.55).toFixed(1)}s spoken` : 'Music only'}
                {riskyWords(sc.vo).length ? <span style={{ color: UI.red }}> · The voice says {riskyWords(sc.vo).join(' and ')} wrong — keep it on screen only</span> : null}
              </p>
              </>) : null}

              {sc.kind !== 'contact' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline' }}><Label>Headline on screen</Label>{canEdit ? <span style={{ marginLeft: 'auto' }}><Btn small disabled={!!busy} onClick={headOptions} title="Three alternative headline + line pairs to pick from">{busy === 'options' ? '…' : '3 options'}</Btn></span> : null}</div>
                  <textarea rows={2} value={sc.head} disabled={!canEdit} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Short. **Gold** a word. Enter = new line." style={field} />
                  {options && options.id === sc.id && options.list.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                      {options.list.map((o, k) => (
                        <button key={k} onClick={() => { setScene(sel, { head: o.head, vo: o.vo }); setOptions(null) }} style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 7, padding: '6px 9px', cursor: 'pointer', color: UI.ink }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{o.head.replace(/\*\*/g, '').replace(/\n/g, ' / ')}</span>
                          <span style={{ display: 'block', fontSize: 11, color: UI.mut }}>{o.vo}</span>
                        </button>
                      ))}
                      <button onClick={() => setOptions(null)} style={{ background: 'none', border: 0, color: UI.mut, fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>Keep mine</button>
                    </div>
                  ) : null}
                  <Label>Line under it</Label>
                  <input value={sc.sub} disabled={!canEdit} onChange={e => setScene(sel, { sub: e.target.value })} style={field} />
                  {PRO_KINDS.indexOf(sc.kind) >= 0 ? (
                    <>
                      <p style={{ fontSize: 11, color: UI.gold, margin: '8px 0 0', lineHeight: 1.45 }}>{(KINDS.find(k => k.kind === sc.kind)?.hint || '').replace(/^Pro · /, '')}</p>
                      <Label>Eyebrow (small top line)</Label>
                      <input value={sc.eyebrow || ''} disabled={!canEdit} maxLength={80} onChange={e => setScene(sel, { eyebrow: e.target.value })} placeholder="e.g. NIGHTLY RATE · NEXT 5 WEEKS" style={field} />
                      <Label>Rows · one per line</Label>
                      <textarea rows={Math.min(9, Math.max(3, sc.items.length + 1))} value={sc.items.join('\n')} disabled={!canEdit} onChange={e => setScene(sel, { items: e.target.value.split('\n') })} style={{ ...field, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
                      <Label>Photo behind</Label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {([[1, 'Light'], [0, 'Normal'], [2, 'Dark']] as [number, string][]).map(([v, l]) => <Btn key={v} small disabled={!canEdit} on={(sc.dim ?? PRO_DIM_OF(sc.kind)) === v} onClick={() => setMany(() => ({ dim: v }))}>{l}</Btn>)}
                      </div>
                    </>
                  ) : null}
                  {['stats', 'cards', 'feed', 'checks', 'rise', 'wall', 'timeline', 'team', 'callouts'].indexOf(sc.kind) >= 0 ? (
                    <>
                      <Label>Rows · one per line</Label>
                      <textarea rows={4} value={sc.items.join('\n')} disabled={!canEdit} onChange={e => setScene(sel, { items: e.target.value.split('\n') })} style={{ ...field, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Label>Headline</Label>
                  <input value={sc.head} disabled={!canEdit} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Book a **call.**" style={field} />
                  <Label>Contact card</Label>
                  {(['name', 'role', 'phone', 'email'] as const).map(k => (
                    <input key={k} value={p.contact[k]} disabled={!canEdit} placeholder={k} onChange={e => change(d => ({ ...d, contact: { ...d.contact, [k]: e.target.value } }))} style={{ ...field, marginBottom: 6 }} />
                  ))}
                </>
              )}

              {!hasVoice ? (
                <>
                  <Label>Hold for (seconds)</Label>
                  <input type="number" min={1} max={30} step={0.5} value={sc.dur || ''} placeholder={tl ? tl.durs[sel].toFixed(1) + ' (auto)' : ''} disabled={!canEdit} onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setMany(() => ({ dur: v })) }} style={{ ...field, width: 140 }} />
                </>
              ) : null}

              </Fold>
              </div>
              <div style={{ order: 1 }}>
              <Fold id="photos" title={'Photos' + (sc.act ? ' · ' + ACT_LABEL[sc.act] : '')} folded={!!folded['photos']} onToggle={toggleFold}>
              {(() => {
                // EVENT AD (2026-11-12): which act this scene is in, where its picture comes from, and — while scenes are
                // still waiting for their AI image — one button to make them all.
                const waiting = p.scenes.filter(x => x.aiPending && x.act !== 'book').length
                return (<>
                  {sc.act ? (
                    <p style={{ fontSize: 11.5, color: UI.mut, margin: '6px 0 0', lineHeight: 1.45 }}>
                      <span style={{ fontWeight: 800, color: ACT_COLOR[sc.act] }}>{ACT_LABEL[sc.act]}</span>
                      {' · '}{sc.act === 'book' ? 'our own listing photos, always' : sc.aiPending ? 'AI image planned — a stock stand-in for now' : sc.src === 'ai' ? 'AI-generated for Stay Hospitality' : sc.src === 'stock' ? 'licensed stock' : 'our photos'}
                    </p>
                  ) : null}
                  {canEdit && waiting ? (
                    <div style={{ ...card, marginTop: 8, borderColor: 'rgba(210,176,119,0.45)' }}>
                      <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{waiting} scene{waiting === 1 ? ' is' : 's are'} set for an AI image</p>
                      <p style={{ fontSize: 11, color: UI.mut, margin: '3px 0 6px', lineHeight: 1.45 }}>The event and the things to do, made for this ad — the Book scenes keep our own photos. {IMAGE_COST_HINT[0].toUpperCase() + IMAGE_COST_HINT.slice(1)}.</p>
                      <Btn small tone="gold" disabled={!!aiBatch || aiBusy || aiOff} onClick={genAllAi} title="One AI image per waiting scene, replacing its stock stand-in">{aiBatch ? 'Generating ' + aiBatch + '…' : aiOff ? 'AI images are off' : 'Generate ' + (waiting === 1 ? 'it' : 'all ' + waiting)}</Btn>
                    </div>
                  ) : null}
                </>)
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 4 }}>
                {sc.photos.map((u, k) => (
                  <div key={u + k} style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 6, overflow: 'hidden', background: UI.panel2 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {u.startsWith('video:') ? (
                      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#000', backgroundImage: (() => { const v = lib.find(x => 'video:' + (x.builtin ? x.url : x.key) === u); return v && v.thumb ? `url(${v.thumb})` : 'none' })(), backgroundSize: 'cover', backgroundPosition: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>▶ Video</span>
                      </div>
                    ) : <img src={proxied(u)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {canEdit ? <button onClick={() => setScene(sel, { photos: sc.photos.filter((_, j) => j !== k) })} title="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, border: 0, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>✕</button> : null}
                    {canEdit && k > 0 ? <button onClick={() => { const a = sc.photos.slice(); const [x] = a.splice(k, 1); a.unshift(x); setScene(sel, { photos: a }) }} title="Make first" style={{ position: 'absolute', bottom: 3, left: 3, borderRadius: 5, border: 0, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 10, padding: '2px 5px', cursor: 'pointer' }}>First</button> : null}
                  </div>
                ))}
              </div>
              {canEdit ? (
                <>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    <Btn small on={photoSrc === 'library'} onClick={() => { setPhotoSrc('library'); setHits([]); setStockNote('') }} title="Our own photos — every property, every unit">Our photos</Btn>
                    <Btn small on={photoSrc === 'stock'} disabled={sc.act === 'book'} onClick={() => { setPhotoSrc('stock'); setHits([]) }} title={sc.act === 'book' ? 'Book scenes always show our own listings' : 'Licensed stock photos we may use in marketing (Pexels, Unsplash, public domain)'}>Stock</Btn>
                    <Btn small on={photoSrc === 'ai'} disabled={sc.act === 'book'} onClick={() => { setPhotoSrc('ai'); setHits([]); setStockNote('') }} title={sc.act === 'book' ? 'Book scenes always show our own listings' : 'A photo made for this scene by AI — no logos, no real people, no text'}>Generate (AI)</Btn>
                    {!isFlyer ? <Btn small on={photoSrc === 'video'} onClick={() => { setPhotoSrc('video'); setHits([]); setStockNote('') }} title="A clip from Finished videos, playing behind this scene">Video clips</Btn> : null}
                  </div>
                  {sc.act === 'book' ? <p style={{ fontSize: 11, color: UI.mut, margin: '6px 0 0', lineHeight: 1.45 }}>Book your Stay shows our real listings{momentOf(p)?.where?.length ? ' in ' + buildingsIn(momentOf(p)?.where || []).slice(0, 5).join(', ') : ''} — stock and AI pictures stay in the first two acts.</p> : null}
                  {photoSrc === 'ai' ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3} style={{ ...field, fontSize: 12 }}
                        placeholder="Describe the picture: the place, the light, the mood — e.g. a rooftop lounge at dusk over a glittering skyline" />
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                        <span style={{ fontSize: 11, color: UI.mut }}>Make</span>
                        {([1, 2, 4] as const).map(n => <Btn key={n} small on={aiN === n} onClick={() => setAiN(n)}>{n}</Btn>)}
                        <Btn small tone="blue" disabled={aiBusy || !!aiBatch || aiOff} onClick={genAi} title={'OpenAI image, medium quality — ' + IMAGE_COST_HINT}>{aiBusy ? 'Generating… up to a minute' : aiHits.length ? 'Regenerate' : 'Generate'}</Btn>
                        <Btn small disabled={aiBusy} onClick={() => { const cur = pRef.current; if (cur && sc) setAiPrompt(defaultImagePrompt({ ...sc, imgPrompt: '' }, momentOf(cur), eventIdx(cur, sel))) }} title="Back to the prompt written for this scene">Reset</Btn>
                      </div>
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '5px 0 0', lineHeight: 1.45 }}>{IMAGE_COST_HINT[0].toUpperCase() + IMAGE_COST_HINT.slice(1)}. Photoreal, Miami light — never logos, text, real people or real artworks. {EVENT_NAME_NOTE}</p>
                      {aiNote ? <p style={{ fontSize: 11, color: UI.gold, margin: '6px 0 0', lineHeight: 1.45 }}>{aiNote}</p> : null}
                      {aiHits.length ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 5, marginTop: 8 }}>
                          {aiHits.map(h => {
                            const on = sc.photos.indexOf(h.view || h.url) >= 0
                            return (
                              <button key={h.url} type="button" title={(h.license || '') + (h.caption ? ' · ' + h.caption : '')} onClick={() => pickAi(h)}
                                style={{ padding: 0, border: '2px solid ' + (on ? UI.gold : 'transparent'), borderRadius: 6, overflow: 'hidden', aspectRatio: '3/4', cursor: 'pointer', background: UI.panel2 }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={h.thumb || h.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : photoSrc === 'video' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
                      {lib.map(v => (
                        <div key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, padding: 5 }}>
                          <button type="button" onClick={() => setWatch(v)} title="Watch" style={{ width: 64, height: 36, flex: 'none', borderRadius: 5, border: 0, cursor: 'pointer', background: '#000 center/cover no-repeat', backgroundImage: v.thumb ? `url(${v.thumb})` : 'none' }} />
                          <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span><span style={{ fontSize: 10.5, color: UI.mut }}>{fmtT(v.dur).replace(/\.\d$/, '')}{v.format ? ' · ' + v.format : ''}</span></span>
                          <Btn small onClick={() => useVideo(v)} title="Puts this clip behind the selected scene">Use</Btn>
                        </div>
                      ))}
                      {!lib.length ? <p style={{ fontSize: 11.5, color: UI.mut }}>No videos in the library yet — export an MP4 or upload one from Studio home.</p> : null}
                    </div>
                  ) : (<>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder={photoSrc === 'stock' ? 'e.g. christmas lights palm trees · miami skyline night · art gallery' : 'Search the library: 17west pool'} style={{ ...field, padding: '6px 9px' }} />
                    <Btn small onClick={() => search()}>{searching ? '…' : 'Find'}</Btn>
                  </div>
                  {stockNote ? <p style={{ fontSize: 11, color: UI.gold, margin: '6px 0 0', lineHeight: 1.45 }}>{stockNote}</p> : null}
                  {photoSrc === 'stock' && aiOff && aiNote ? <p style={{ fontSize: 11, color: UI.gold, margin: '6px 0 0', lineHeight: 1.45 }}>{aiNote}</p> : null}
                  {hits.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
                      {hits.map(h => {
                        const on = sc.photos.indexOf(h.view || h.url) >= 0 || sc.photos.indexOf(h.url) >= 0
                        return (
                          <button key={h.url} title={(h.source ? h.source + ' · ' + (h.license || '') + (h.credit ? ' · ' + h.credit : '') : h.unit) + (h.caption ? ' · ' + h.caption : '')} onClick={() => { const u = h.view || h.url; setScene(sel, on ? { photos: sc.photos.filter(x => x !== u && x !== h.url) } : { photos: (sc.aiPending ? [] : sc.photos).concat([u]).slice(0, 12), ...(sc.act === 'book' ? {} : { src: (photoSrc === 'stock' ? 'stock' : 'ours') as 'stock' | 'ours' }), ...(sc.aiPending ? { aiPending: false } : {}) }) }}
                            style={{ padding: 0, border: '2px solid ' + (on ? UI.gold : 'transparent'), borderRadius: 6, overflow: 'hidden', aspectRatio: '4/3', cursor: 'pointer', background: UI.panel2 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={h.thumb || h.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  </>)}
                </>
              ) : null}

              </Fold>
              </div>
              <div style={{ order: 1 }}>
              <Fold id="design" title={'Design · ' + (KINDS.find(k => k.kind === sc.kind)?.label || sc.kind)} folded={!!folded['design']} onToggle={toggleFold}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <span style={{ width: 10, height: 34, borderRadius: 3, background: KIND_COLOR[sc.kind], flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{KINDS.find(k => k.kind === sc.kind)?.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: UI.mut, lineHeight: 1.4 }}>{(KINDS.find(k => k.kind === sc.kind)?.hint || '').replace(/^Pro · /, '').split('. ')[0]}.</span>
                </span>
              </div>
              {canEdit ? <div style={{ marginTop: 8 }}><Btn tone="blue" small onClick={() => setPicker('change')} title="See this scene in every design and pick one">Change the design — see them all</Btn></div> : null}
              </Fold>
              </div>
              <div style={{ order: 1 }}>
              <Fold id="custom" title={'Customise' + (hasCustom(sc) ? ' · on' : '')} folded={!!folded['custom']} onToggle={toggleFold}>
              {(() => {
                const cu: SceneCustom = sc.cu || {}
                const photo = sc.photos.find(u => !u.startsWith('video:')) || ''
                const sw = (cur: string | undefined, onSet: (v: string) => void) => (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                    <Btn small on={!cur} disabled={!canEdit} onClick={() => onSet('')}>Look’s own</Btn>
                    {SWATCHES.map(c => <button key={c} type="button" disabled={!canEdit} title={c} onClick={() => onSet(c)} style={{ width: 22, height: 22, borderRadius: 11, background: c, border: '2px solid ' + ((cur || '').toLowerCase() === c.toLowerCase() ? UI.gold : 'rgba(255,255,255,0.25)'), cursor: 'pointer', padding: 0 }} />)}
                    <label title="Any colour" style={{ position: 'relative', width: 24, height: 24, borderRadius: 12, background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer', border: '2px solid ' + (cur && !SWATCHES.some(x => x.toLowerCase() === cur.toLowerCase()) ? UI.gold : 'transparent') }}>
                      <input type="color" disabled={!canEdit} value={cur || '#D2B077'} onChange={e => onSet(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                    </label>
                  </div>
                )
                return (<>
                  <p style={{ fontSize: 11.5, color: UI.mut, margin: '8px 0 0', lineHeight: 1.45 }}>This scene’s own styling, on top of the look. {targetIdx().length > 1 ? 'Changes go to the ' + targetIdx().length + ' selected scenes.' : 'Select several scenes to style them together.'}</p>
                  <Label>Headline size</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CU_SIZE.map(x => <Btn key={x.key || 'n'} small disabled={!canEdit} on={(cu.size || '') === x.key} onClick={() => setCu({ size: (x.key || undefined) as SceneCustom['size'] })}>{x.label}</Btn>)}</div>
                  <Label>Headline font</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CU_FONTS.map(x => <Btn key={x.key || 'n'} small disabled={!canEdit} on={(cu.font || '') === x.key} onClick={() => setCu({ font: (x.key || undefined) as SceneCustom['font'] })}>{x.label}</Btn>)}</div>
                  <Label>Accent colour · the gold words, lines, buttons</Label>
                  {sw(cu.accent, v => setCu({ accent: v || undefined }))}
                  <Label>Text colour</Label>
                  {sw(cu.text, v => setCu({ text: v || undefined }))}
                  <Label>Over the photo</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CU_SHADES.map(x => <Btn key={x.key || 'n'} small disabled={!canEdit} title={x.hint} on={(cu.shade || '') === x.key} onClick={() => setCu({ shade: (x.key || undefined) as SceneCustom['shade'] })}>{x.label}</Btn>)}</div>
                  <Label>Photo colour</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CU_GRADES.map(x => <Btn key={x.key || 'n'} small disabled={!canEdit} on={(cu.grade || '') === x.key} onClick={() => setCu({ grade: (x.key || undefined) as SceneCustom['grade'] })}>{x.label}</Btn>)}</div>
                  <Label>Photo crop · click the part to keep in view</Label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative', width: 132, height: 99, borderRadius: 8, overflow: 'hidden', flex: 'none', background: photo ? `url(${proxied(photo)}) center/cover` : UI.panel2, border: '1px solid ' + UI.line, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' }}>
                      {[-1, 0, 1].map(fy => [-1, 0, 1].map(fx => { const on = (cu.fx || 0) === fx && (cu.fy || 0) === fy; return (
                        <button key={fx + ',' + fy} type="button" disabled={!canEdit} title={(fy < 0 ? 'Top' : fy > 0 ? 'Bottom' : 'Middle') + ' ' + (fx < 0 ? 'left' : fx > 0 ? 'right' : 'centre')} onClick={() => setCu({ fx, fy })}
                          style={{ border: '1px solid rgba(255,255,255,0.28)', background: on ? 'rgba(210,176,119,0.55)' : 'rgba(0,0,0,0.12)', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14 }}>{on ? '●' : ''}</button>
                      ) }))}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: UI.mut, display: 'block', marginBottom: 4 }}>Zoom in</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{CU_ZOOMS.map(z => <Btn key={z} small disabled={!canEdit} on={(cu.zoom || 1) === z} onClick={() => setCu({ zoom: z })}>{z === 1 ? 'None' : z + '×'}</Btn>)}</div>
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '6px 0 0', lineHeight: 1.4 }}>Zoom in a little to give the crop room to move.</p>
                    </div>
                  </div>
                  {canEdit ? (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
                      {p.scenes.length > 1 ? <Btn small disabled={!hasCustom(sc)} title="Puts this size, font, colours and photo treatment on every scene (the crop stays per photo)" onClick={() => change(d => ({ ...d, scenes: d.scenes.map(x => { const n: any = { ...(x.cu || {}) }; (['size', 'font', 'accent', 'text', 'shade', 'grade'] as const).forEach(k => { if ((cu as any)[k]) n[k] = (cu as any)[k]; else delete n[k] }); return { ...x, cu: Object.keys(n).length ? n : undefined } }) }))}>→ Style every scene like this</Btn> : null}
                      <Btn small tone="red" disabled={!hasCustom(sc)} onClick={() => setMany(() => ({ cu: undefined }))} title="Back to the look’s own styling">Reset</Btn>
                    </div>
                  ) : null}
                </>)
              })()}
              </Fold>
              </div>
              <div style={{ order: 3 }}>
              <Fold id="motion" title="Motion" folded={!!folded['motion']} onToggle={toggleFold}>
              {sel > 0 || targetIdx().length > 1 ? (
                <>
                  <Label>Transition into this scene</Label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 12.5 }}>{trMeta(sc.tr || 'auto')?.label || 'Auto'}</b>
                    <span style={{ fontSize: 11, color: UI.mut, flex: 1, minWidth: 120 }}>{trMeta(sc.tr || 'auto')?.hint}</span>
                    {canEdit ? <Btn small tone="blue" onClick={() => setTrPick(true)} title="Every transition, playing on your two scenes — like Final Cut's browser">Browse transitions</Btn> : null}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {(['fade', 'crosszoom', 'push', 'dip', 'leak', 'cut'] as AdTransition[]).map(x => <Btn key={x} small on={(sc.tr || 'auto') === x} disabled={!canEdit} title={trMeta(x)?.hint} onClick={() => setTr({ tr: x })}>{trMeta(x)?.label}</Btn>)}
                  </div>
                  {(sc.tr || 'auto') !== 'cut' ? (
                    <FxRow name="Length">{(['short', 'normal', 'long'] as TrLen[]).map(x => <Btn key={x} small on={(sc.trs || 'normal') === x} disabled={!canEdit} onClick={() => setTr({ trs: x === 'normal' ? undefined : x })}>{x === 'short' ? 'Quick' : x === 'normal' ? 'Normal' : 'Slow'}</Btn>)}</FxRow>
                  ) : null}
                  {TR_DIRECTIONAL.indexOf(sc.tr || 'auto') >= 0 ? (
                    <FxRow name="From">{([['right', '→ Right'], ['left', '← Left'], ['down', '↓ Bottom'], ['up', '↑ Top']] as [TrDir, string][]).map(([k, l]) => <Btn key={k} small on={(sc.trd || (sc.tr === 'slide' ? 'down' : sc.tr === 'wipe' ? 'left' : 'right')) === k} disabled={!canEdit} title={'The new scene comes in from the ' + (k === 'down' ? 'bottom' : k === 'up' ? 'top' : k)} onClick={() => setTr({ trd: k })}>{l}</Btn>)}</FxRow>
                  ) : null}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    <Btn small onClick={() => { if (tl) start(Math.max(0, tl.starts[sel] - 0.8)) }} title="Plays from just before the cut">▶ Play the cut</Btn>
                    {canEdit && p.scenes.length > 2 ? <Btn small title="Use this transition, length and direction on every scene change" onClick={() => change(d => ({ ...d, scenes: d.scenes.map((x, k) => (k > 0 ? { ...x, tr: sc.tr || 'auto', trs: sc.trs, trd: sc.trd } : x)) }))}>→ Every scene change</Btn> : null}
                  </div>
                </>
              ) : null}
              {!isFlyer ? (<>
              <Label>Headline animation</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {TEXT_ANIMS.map(x => <Btn key={x.key} small on={(sc.anim || 'auto') === x.key} disabled={!canEdit} onClick={() => { setMany(() => ({ anim: x.key as AdTextAnim })); if (tl) setT(tl.starts[sel] + 0.05) }}>{x.label}</Btn>)}
              </div>
              <Label>Camera</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {CAMS.map(x => <Btn key={x.key} small on={(sc.cam || 'auto') === x.key} disabled={!canEdit} onClick={() => setMany(() => ({ cam: x.key as AdCam }))}>{x.label}</Btn>)}
              </div>
              </>) : null}
              </Fold>
              </div>
              <div style={{ order: 3 }}>
              <Fold id="graphics" title="Graphics" folded={!!folded['graphics']} onToggle={toggleFold}>
              {canEdit && p.scenes.length > 1 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10 }} title="Where graphic changes go">
                  <span style={{ fontSize: 11, color: UI.mut, marginRight: 2 }}>Changes go to</span>
                  <Btn small on={!fxAll} onClick={() => setFxAll(false)}>{targetIdx().length > 1 ? 'The ' + targetIdx().length + ' selected' : 'This scene'}</Btn>
                  <Btn small on={fxAll} onClick={() => setFxAll(true)} title="Adding, removing or changing a graphic does it on every scene">All {p.scenes.length} scenes</Btn>
                </div>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, alignItems: 'center' }}>
                {canEdit ? <Btn small tone="blue" onClick={() => setFxPick(true)} title="Every graphic, moving on this scene — click to add">＋ Add graphics</Btn> : null}
                {(sc.fx || []).map(k => <Btn key={k} small on disabled={!canEdit} title={'Remove ' + (fxMeta(k)?.label || k)} onClick={() => toggleFx(k)}>{fxMeta(k)?.label || k} ✕</Btn>)}
                {(sc.fx || []).length ? <Btn small tone="red" disabled={!canEdit} onClick={() => setFx(() => ({ fx: [], fxo: {} }))}>Clear{fxAll ? ' all scenes' : ''}</Btn> : null}
                {canEdit && p.scenes.length > 1 && !fxAll && (sc.fx || []).length ? <Btn small title="Put these graphics, with their settings, on every scene" onClick={() => change(d => ({ ...d, scenes: d.scenes.map(x => ({ ...x, fx: (sc.fx || []).slice(), fxo: { ...(sc.fxo || {}) } })) }))}>→ Copy to all scenes</Btn> : null}
              </div>
              <p style={{ fontSize: 10.5, color: UI.mut, marginTop: 4 }}>{(sc.fx || []).length ? 'Up to six per scene. Each has its own placement, size and colour below.' : 'None on this scene' + ((LOOKS.find(l => l.key === (p.look || DEFAULT_LOOK))?.c.def?.fx || []).length ? ' — the look’s own graphics show.' : '.')}</p>
              {(sc.fx || []).map(k => {
                const m = fxMeta(k); if (!m) return null
                const o = fxOpts(sc, k)
                const set = (patch: Partial<FxOpts>) => setFx(x => ((x.fx || []).indexOf(k) >= 0 ? { fxo: { ...(x.fxo || {}), [k]: { ...((x.fxo || {})[k] || {}), ...patch } } } : {}))
                return (
                  <div key={k} style={{ marginTop: 8, padding: '8px 10px', background: UI.panel2, borderRadius: 8, border: '1px solid ' + UI.line }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <b style={{ fontSize: 11.5 }}>{m.label}</b>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <Btn small disabled={!canEdit || !(sc.fxo && sc.fxo[k])} title="Back to this graphic’s defaults" onClick={() => setFx(x => { const n = { ...(x.fxo || {}) }; delete n[k]; return { fxo: n } })}>Reset</Btn>
                        <Btn small tone="red" disabled={!canEdit} title="Remove" onClick={() => toggleFx(k)}>✕</Btn>
                      </span>
                    </div>
                    {m.variants ? <FxRow name="Style">{m.variants.map(v => <Btn key={v.key} small on={o.variant === v.key} disabled={!canEdit} onClick={() => set({ variant: v.key })}>{v.label}</Btn>)}</FxRow> : null}
                    {m.pos ? <FxRow name="Place">{m.pos.map(x => <Btn key={x} small on={o.pos === x} disabled={!canEdit} onClick={() => set({ pos: x })}>{FX_POS_LABEL[x] || x}</Btn>)}</FxRow> : null}
                    {m.has.indexOf('size') >= 0 ? <FxRow name="Size">{(['S', 'M', 'L'] as const).map(x => <Btn key={x} small on={o.size === x} disabled={!canEdit} onClick={() => set({ size: x })}>{x === 'S' ? 'Small' : x === 'M' ? 'Medium' : 'Large'}</Btn>)}</FxRow> : null}
                    {m.has.indexOf('amt') >= 0 ? <FxRow name="Amount">{(['low', 'med', 'high'] as const).map(x => <Btn key={x} small on={o.amt === x} disabled={!canEdit} onClick={() => set({ amt: x })}>{x === 'low' ? 'Few' : x === 'med' ? 'Some' : 'Lots'}</Btn>)}</FxRow> : null}
                    {m.has.indexOf('speed') >= 0 ? <FxRow name="Speed">{(['slow', 'normal', 'fast'] as const).map(x => <Btn key={x} small on={o.speed === x} disabled={!canEdit} onClick={() => set({ speed: x })}>{x === 'slow' ? 'Slow' : x === 'normal' ? 'Normal' : 'Fast'}</Btn>)}</FxRow> : null}
                    {m.colors ? <FxRow name="Colour">{m.colors.map(x => <Btn key={x} small on={o.color === x} disabled={!canEdit} onClick={() => set({ color: x })}>{FX_COLOR_LABEL[x] || x}</Btn>)}</FxRow> : null}
                    {m.has.indexOf('blink') >= 0 ? <FxRow name="Blink">{(['on', 'off'] as const).map(x => <Btn key={x} small on={o.blink === x} disabled={!canEdit} onClick={() => set({ blink: x })}>{x === 'on' ? 'Blinking' : 'Steady'}</Btn>)}</FxRow> : null}
                  </div>
                )
              })}
              </Fold>
              </div>
              <div style={{ order: 3 }}>
              <Fold id="sound" title="Sound effect" folded={!!folded['sound']} onToggle={toggleFold}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <Btn small on={!sc.sfx} disabled={!canEdit} onClick={() => setMany(() => ({ sfx: '' }))}>None</Btn>
                {sounds.filter(x => x.kind === 'sfx').slice(0, 12).map(x => <Btn key={x.key} small on={sc.sfx === x.key} disabled={!canEdit} title={x.prompt} onClick={() => { setMany(() => ({ sfx: x.key })); preview(x.url) }}>{x.name}</Btn>)}
                {canEdit ? <Btn small on={sndOpen === 'sfx'} onClick={() => { setSndOpen(sndOpen === 'sfx' ? '' : 'sfx'); setSndKind('sfx'); setSndSecs(2) }}>+ Make one</Btn> : null}
              </div>
              {!sounds.some(x => x.kind === 'sfx') && sndOpen !== 'sfx' ? <p style={{ fontSize: 11, color: UI.mut, marginTop: 6 }}>No effects yet — make one (a whoosh, a shutter, waves) and it plays as the scene lands.</p> : null}
              {sndOpen === 'sfx' ? soundMaker('sfx') : null}
              </Fold>
              </div>
              </div>) : (<>
              {canEdit && p.scenes.length ? (
                <div style={{ marginTop: 12, background: '#18243a', border: '1px solid #2b4470', borderRadius: 9, padding: 9 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 6px', color: '#BFD4FA' }}>✦ Change the whole {isFlyer ? 'flyer' : 'ad'} with AI</p>
                  <textarea value={adAsk} onChange={e => setAdAsk(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && adAsk.trim()) write(true, adAsk.trim()) }} placeholder="e.g. make it faster · open on the rooftop · add a scene about guidebooks" style={{ ...field, fontSize: 12.5 }} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    <Btn small tone="blue" disabled={!!busy || !adAsk.trim()} onClick={() => write(true, adAsk.trim())}>{busy === 'adask' ? 'Changing…' : 'Change it'}</Btn>
                    {!isFlyer ? <Btn small disabled={!!busy} onClick={() => write(true)} title="Keeps what works and tightens the rest">{busy === 'rewrite' ? 'Rewriting…' : 'Tighten the draft'}</Btn> : null}
                    <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>↶ undoes it</span>
                  </div>
                </div>
              ) : null}
              <Fold id="caption" title={'Post caption' + (p.social ? ' · written' : '')} folded={!!folded['caption']} onToggle={toggleFold}>
              <p style={{ fontSize: 11, color: UI.mut, margin: '8px 0 6px' }}>The words that go out with the {isFlyer ? 'photo' : p.kind === 'post' ? 'post' : 'video'} on Instagram or Facebook — written from what the piece says.</p>
              {canEdit ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Btn small tone="blue" disabled={!!capBusy} onClick={() => writeCaption('instagram')}>{capBusy === 'instagram' ? 'Writing…' : '✦ Write for Instagram'}</Btn>
                <Btn small tone="blue" disabled={!!capBusy} onClick={() => writeCaption('facebook')}>{capBusy === 'facebook' ? 'Writing…' : '✦ Write for Facebook'}</Btn>
              </div> : null}
              {capOpts.length ? capOpts.map((o, k) => (
                <div key={k} style={{ marginTop: 8, padding: '8px 10px', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontSize: 11.5 }}>{o.label}</b><span style={{ marginLeft: 'auto' }}><Btn small disabled={!canEdit} onClick={() => { change(d => ({ ...d, social: o.text })); setCapOpts([]) }}>Use this</Btn></span></div>
                  <p style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0 0', lineHeight: 1.45 }}>{o.text}</p>
                </div>
              )) : null}
              <textarea value={p.social || ''} disabled={!canEdit} onChange={e => { const v = e.target.value; change(d => ({ ...d, social: v })) }} rows={6} placeholder="Write it, or press one of the buttons above." style={{ ...field, fontSize: 12.5, marginTop: 8 }} />
              <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
                <Btn small disabled={!p.social} onClick={() => { try { navigator.clipboard.writeText(p.social || ''); setCapCopied(true); setTimeout(() => setCapCopied(false), 1500) } catch { /* */ } }}>{capCopied ? '✓ Copied' : 'Copy caption'}</Btn>
                <span style={{ fontSize: 10.5, color: (p.social || '').length > 2200 ? UI.red : UI.mut }}>{(p.social || '').length} / 2,200</span>
              </div>
              </Fold>
              <Fold id="format" title="Where it runs" folded={!!folded['format']} onToggle={toggleFold}>
              <Label>{isFlyer ? 'Size' : 'Platform · sets the shape and the safe zones'}</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {isFlyer
                  ? FLYER_SIZES.map(x => <Btn key={x.key} small on={p.format === x.key} disabled={!canEdit} title={x.hint} onClick={() => change(d => ({ ...d, format: x.key, platform: x.key === '9:16' ? 'story' : x.key === '4:5' ? 'feed' : x.key === '1:1' ? 'square' : 'web' }))}>{x.label}</Btn>)
                  : PLATFORMS.map(x => <Btn key={x.key} small on={platformOf(p).key === x.key} disabled={!canEdit} title={`${FORMAT_LABEL[x.format]} · best ${x.best}`} onClick={() => change(d => ({ ...d, platform: x.key, format: x.format }))}>{x.label} <span style={{ opacity: 0.55, fontWeight: 500 }}>{x.format}</span></Btn>)}
              </div>
              {!isFlyer && canEdit ? (<>
                <Label>Same ad, another channel · a copy re-fitted to that shape and its safe zones</Label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PLATFORMS.filter(x => x.key !== platformOf(p).key && x.format !== p.format).filter((x, k, a) => a.findIndex(y => y.format === x.format) === k).map(x => <Btn key={x.key} small onClick={() => duplicateAd(x.key)} title={'Makes a copy of this ad as ' + FORMAT_LABEL[x.format] + ' — check the photo crops, then export'}>⧉ {x.format === '9:16' ? 'Reels · TikTok · Shorts' : x.label} <span style={{ opacity: 0.55, fontWeight: 500 }}>{x.format}</span></Btn>)}
                </div>
              </>) : null}
              <Label>Audience · decides the facts and the end card</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(Object.keys(AUD) as AdAudience[]).map(k => <Btn key={k} small on={p.audience === k} disabled={!canEdit} title={AUD[k].hint} onClick={() => change(d => ({ ...d, audience: k }))}>{AUD[k].label}</Btn>)}
              </div>
              </Fold>
              <Fold id="look" title={'Look · ' + (LOOKS.find(l => l.key === (p.look || DEFAULT_LOOK))?.label || '')} folded={!!folded['look']} onToggle={toggleFold}>
              <div style={{ height: 8 }} />
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '0 0 6px' }}>Vibe · one tap sets look, style, graphics and music</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {VIBES.map(v => <Btn key={v.key} small disabled={!canEdit} title={v.blurb} onClick={() => applyVibe(v)}>{v.label}</Btn>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 6px' }}>
                <p style={{ fontSize: 11.5, color: UI.mut, margin: 0 }}>Look · {LOOKS.find(l => l.key === (p.look || DEFAULT_LOOK))?.label}</p>
                {canEdit ? <span style={{ marginLeft: 'auto' }}><Btn small onClick={surprise} title="A random look and style — keep pressing to explore">🎲 Surprise me</Btn></span> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6, marginBottom: 6 }}>
                {looksShown(p.look).map(l => (
                  <button key={l.key} disabled={!canEdit} title={l.blurb} onClick={() => change(d => ({ ...d, look: l.key, style: { ...STYLE_DEFAULT, pace: d.style?.pace || 'normal', frame: d.style?.frame || 'none' } }))}
                    style={{ padding: 0, border: '2px solid ' + ((p.look || DEFAULT_LOOK) === l.key ? UI.gold : UI.line), borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: UI.panel2, color: UI.ink, textAlign: 'left' }}>
                    <LookPreview proj={p} look={l.key} style={{}} assets={assets} w={100} />
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  </button>
                ))}
              </div>
              <div style={{ marginBottom: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {canEdit ? <Btn small disabled={(p.look || DEFAULT_LOOK) === DEFAULT_LOOK && JSON.stringify({ ...STYLE_DEFAULT, pace: (p.style || STYLE_DEFAULT).pace }) === JSON.stringify({ ...STYLE_DEFAULT, ...(p.style || {}) }) && !p.scenes.some(x => x.cu?.accent || x.cu?.text)}
                  title="Back to the house look — Stay black, white type, the Stay logo — and clear colour overrides (photos, words and graphics stay)"
                  onClick={() => change(d => ({ ...d, look: DEFAULT_LOOK, style: { ...STYLE_DEFAULT, pace: d.style?.pace || STYLE_DEFAULT.pace }, scenes: d.scenes.map(x => { if (!x.cu) return x; const n: any = { ...x.cu }; delete n.accent; delete n.text; return { ...x, cu: Object.keys(n).length ? n : undefined } }) }))}>↺ Default look</Btn> : null}
                <Btn small onClick={() => setMoreLooks(!moreLooks)}>{moreLooks ? 'Fewer looks' : 'More looks (' + (LOOKS.length - LOOKS_FEATURED.length) + ')'}</Btn>
              </div>
              </Fold>
              {!isFlyer ? (
              <Fold id="music" title={'Music · ' + track(p.music).label} folded={!!folded['music']} onToggle={toggleFold}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, maxHeight: 250, overflowY: 'auto', border: '1px solid ' + UI.line, borderRadius: 9, padding: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: p.music === 'none' ? '#232C38' : 'transparent', borderRadius: 7, padding: '3px 5px' }}>
                  <span style={{ width: 30 }} /><span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>No music</span>
                  {canEdit ? <Btn small on={p.music === 'none'} onClick={() => change(d => ({ ...d, music: 'none' }))}>{p.music === 'none' ? 'In use' : 'Use'}</Btn> : null}
                </div>
                {sounds.filter(x => x.kind === 'music').map(x => (
                  <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: p.music === x.key ? '#232C38' : 'transparent', borderRadius: 7, padding: '3px 5px' }}>
                    <Btn small on={hear === x.url} onClick={() => preview(x.url)} title="Listen">{hear === x.url ? '■' : '▶'}</Btn>
                    <span style={{ flex: 1, minWidth: 0 }} title={x.prompt}><span style={{ display: 'block', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>♪ {x.name}</span><span style={{ fontSize: 10.5, color: UI.mut }}>Made with ElevenLabs · {Math.round(x.dur)} s</span></span>
                    {canEdit ? <Btn small on={p.music === x.key} onClick={() => change(d => ({ ...d, music: x.key }))}>{p.music === x.key ? 'In use' : 'Use'}</Btn> : null}
                    {canDelete ? <Btn small tone="red" onClick={() => delSound(x)} title="Delete this track">✕</Btn> : null}
                  </div>
                ))}
                {MUSIC.filter(m => m.file).map(m => (
                  <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: p.music === m.key ? '#232C38' : 'transparent', borderRadius: 7, padding: '3px 5px' }}>
                    <Btn small on={hear === m.file} onClick={() => preview(m.file)} title="Listen">{hear === m.file ? '■' : '▶'}</Btn>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span><span style={{ display: 'block', fontSize: 10.5, color: UI.mut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.mood}</span></span>
                    {canEdit ? <Btn small on={p.music === m.key} onClick={() => change(d => ({ ...d, music: m.key }))}>{p.music === m.key ? 'In use' : 'Use'}</Btn> : null}
                  </div>
                ))}
              </div>
              {p.music !== 'none' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: UI.mut, marginTop: 8 }}>
                  Level <input type="range" min={0.05} max={0.6} step={0.01} value={p.musicVol} disabled={!canEdit} onChange={e => change(d => ({ ...d, musicVol: Number(e.target.value) }))} style={{ flex: 1 }} />
                </label>
              ) : null}
              {canEdit ? <div style={{ marginTop: 8 }}><Btn small on={sndOpen === 'music'} onClick={() => { setSndOpen(sndOpen === 'music' ? '' : 'music'); setSndKind('music'); setSndSecs(30) }}>+ Compose a new track</Btn></div> : null}
              {sndOpen === 'music' ? soundMaker('music') : null}
              </Fold>
              ) : null}
              {isSpoken ? (
              <Fold id="voice" title={'Voice · ' + (p.voiceName || VOICES.find(v => v.id === p.voiceId)?.name || 'house voice')} folded={!!folded['voice']} onToggle={toggleFold}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={p.captions} onChange={e => change(d => ({ ...d, captions: e.target.checked }))} /> Burn in captions (most people watch muted)
              </label>
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '8px 0 6px' }}>House voices</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {VOICES.map(v => <Btn key={v.id} small on={p.voiceId === v.id} title={v.blurb} onClick={() => change(d => ({ ...d, voiceId: v.id, voiceName: v.name }))}>{v.name}</Btn>)}
                {!VOICES.some(v => v.id === p.voiceId) ? <Btn small on>{p.voiceName || 'Library voice'}</Btn> : null}
              </div>
              <div style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, padding: 8, marginTop: 8 }}>
                <p style={{ fontSize: 11, color: UI.mut, margin: '0 0 6px' }}>Browse the ElevenLabs voice library</p>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input value={vq} onChange={e => setVq(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') findVoices() }} placeholder="e.g. warm, luxury, narrator, British" style={{ ...field, padding: '5px 8px', fontSize: 12 }} />
                  <Btn small onClick={() => findVoices()}>{vBusy ? '…' : 'Find'}</Btn>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  {([['', 'Any'], ['female', 'Female'], ['male', 'Male']] as const).map(([k, l]) => <Btn key={k} small on={vGender === k} onClick={() => { setVGender(k); findVoices(k) }}>{l}</Btn>)}
                </div>
                {vHits ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                    {vHits.map(v => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {v.preview ? <Btn small on={hear === v.preview} onClick={() => preview(v.preview)} title="Hear a sample">{hear === v.preview ? '■' : '▶'}</Btn> : null}
                        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>{v.name}</span><span style={{ display: 'block', fontSize: 10.5, color: UI.mut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.blurb}>{v.blurb}</span></span>
                        {canEdit ? <Btn small on={p.voiceId === v.id} onClick={() => change(d => ({ ...d, voiceId: v.id, voiceName: v.name }))}>{p.voiceId === v.id ? 'In use' : 'Use'}</Btn> : null}
                      </div>
                    ))}
                    {!vHits.length ? <p style={{ fontSize: 11.5, color: UI.mut }}>No voices matched.</p> : null}
                  </div>
                ) : null}
              </div>
              {(() => {
                const vs = p.voiceSettings || VOICE_DEFAULTS
                const row = (k: 'stability' | 'style' | 'speed', label: string, lo: string, hi: string, min: number, max: number) => (
                  <label key={k} style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 6 }}>
                    <span style={{ display: 'flex' }}><span>{label}</span><span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace' }}>{vs[k].toFixed(2)}</span></span>
                    <input type="range" min={min} max={max} step={0.01} value={vs[k]} disabled={!canEdit} onChange={e => change(d => ({ ...d, voiceSettings: { ...(d.voiceSettings || VOICE_DEFAULTS), [k]: Number(e.target.value) } }))} style={{ width: '100%' }} />
                    <span style={{ display: 'flex', fontSize: 10 }}><span>{lo}</span><span style={{ marginLeft: 'auto' }}>{hi}</span></span>
                  </label>
                )
                return (
                  <div style={{ marginTop: 6 }}>
                    {row('stability', 'Delivery', 'More expressive', 'Steadier', 0, 1)}
                    {row('style', 'Style', 'Plain', 'Dramatic', 0, 1)}
                    {row('speed', 'Pace', 'Slower', 'Faster', 0.7, 1.2)}
                    <p style={{ fontSize: 10.5, color: UI.mut, marginTop: 4 }}>Changes take effect when you re-record the voice.</p>
                  </div>
                )
              })()}
              </Fold>
              ) : null}
              <Fold id="style" title="Fine-tune the style" folded={!!folded['style']} onToggle={toggleFold}>
              <div style={{ height: 6 }} />
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '6px 0 4px' }}>Colours · any colour, on top of the look</p>
              {([['accent', 'Accent (highlights, buttons)'], ['base', 'Background'], ['text', 'Text']] as ['accent' | 'base' | 'text', string][]).map(([k, lab]) => {
                const cur = (p.style || STYLE_DEFAULT)[k] || ''
                const setC = (v: string) => change(d => ({ ...d, style: { ...STYLE_DEFAULT, ...(d.style || {}), [k]: v } }))
                return (
                  <div key={k} style={{ marginBottom: 7 }}>
                    <span style={{ fontSize: 10.5, color: UI.mut, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>{lab}
                      {cur ? <button disabled={!canEdit} onClick={() => setC('')} style={{ marginLeft: 'auto', background: 'none', border: 0, color: UI.blue, fontSize: 10.5, cursor: 'pointer' }}>Look’s own</button> : <span style={{ marginLeft: 'auto' }}>Look’s own</span>}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                      {SWATCHES.map(c => <button key={c} disabled={!canEdit} title={c} onClick={() => setC(c)} style={{ width: 20, height: 20, borderRadius: 10, background: c, border: '2px solid ' + (cur.toLowerCase() === c.toLowerCase() ? UI.gold : 'rgba(255,255,255,0.25)'), cursor: 'pointer', padding: 0 }} />)}
                      <label title="Any colour" style={{ position: 'relative', width: 22, height: 22, borderRadius: 11, background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer', border: '2px solid ' + (cur && !SWATCHES.some(x => x.toLowerCase() === cur.toLowerCase()) ? UI.gold : 'transparent') }}>
                        <input type="color" disabled={!canEdit} value={cur || '#D2B077'} onChange={e => setC(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                      </label>
                      {cur ? <span style={{ fontSize: 10.5, color: UI.mut, fontFamily: 'ui-monospace, Menlo, monospace' }}>{cur}</span> : null}
                    </div>
                  </div>
                )
              })}
              {([['font', 'Type'], ['caps', 'Case'], ['grade', 'Photo grade'], ['wash', 'Photo wash'], ['pace', 'Pace'], ['finish', 'Finish'], ['frame', 'Frame'], ['logo', 'Stay logo'], ['dress', 'Logo for the season']] as [keyof AdStyle, string][]).map(([k, lab]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, color: UI.mut, display: 'block', marginBottom: 3 }}>{lab}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(STYLE_OPTIONS[k] as { key: string; label: string }[]).map(o => <Btn key={o.key} small disabled={!canEdit} on={((p.style || STYLE_DEFAULT)[k] || STYLE_DEFAULT[k]) === o.key} onClick={() => change(d => ({ ...d, style: { ...STYLE_DEFAULT, ...(d.style || {}), [k]: o.key } }))}>{o.label}</Btn>)}
                  </div>
                </div>
              ))}
              </Fold>
              {!isFlyer ? (
              <Fold id="brief" title="Brief · plan it again" folded={!!folded['brief']} onToggle={toggleFold}>
              <Label>Brief</Label>
              <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} disabled={!canEdit} placeholder="What is this ad for? Even one line works." style={{ ...field, fontSize: 12.5 }} />
              <Label>Length</Label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{[15, 30, 45, 60, 90].map(n => <Btn key={n} small on={seconds === n} onClick={() => setSeconds(n)}>{n}s</Btn>)}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <Btn small tone="blue" disabled={!canEdit || !!busy || !brief.trim()} onClick={() => { seed.current = null; planAd() }} title="Plans it again from this brief; you confirm before this ad's scenes are replaced">{busy === 'plan' ? 'Thinking…' : 'Plan it again'}</Btn>
                <Btn small disabled={!canEdit || !!busy || !brief.trim()} onClick={() => write(false)} title="Writes new scenes from this brief straight away (↶ undoes it)">{busy === 'write' ? 'Writing…' : 'Rewrite from the brief'}</Btn>
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 8, lineHeight: 1.5 }}>House facts only — no made-up numbers.</p>
              </Fold>
              ) : null}
              </>)}
            </>
          ) : <p style={{ fontSize: 12, color: UI.mut, marginTop: 16 }}>Nothing open.</p>}
        </div>
      </div>

      {/* ── timeline ── */}
      {p && tl && editing && p.kind !== 'flyer' ? (
        <div style={{ borderTop: '1px solid ' + UI.line, padding: '8px 14px 10px', background: UI.panel, flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut }}>Timeline</span>
            {canEdit ? <Btn small tone="blue" onClick={() => setPicker('add')} title="Add a scene after the selected one — pick its design from pictures">＋ Add scene</Btn> : null}
            {sc && canEdit ? (<>
              <span style={{ width: 1, height: 18, background: UI.line, margin: '0 4px' }} />
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>Scene {sel + 1}</span>
              <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: UI.mut }}>{tl.durs[sel].toFixed(1)} s</span>
              {!hasVoice ? (<>
                <Btn small onClick={() => nudge(sel, -0.5)} title="Half a second shorter">−</Btn>
                <Btn small onClick={() => nudge(sel, 0.5)} title="Half a second longer">+</Btn>
                {sc.dur ? <Btn small onClick={() => setScene(sel, { dur: null })} title="Back to automatic timing from the spoken line">Auto</Btn> : null}
              </>) : <span style={{ fontSize: 11, color: UI.mut }} title="Shorten the spoken line, then re-record the voice">timed to the voice</span>}
              <Btn small disabled={sel === 0} onClick={() => move(sel, sel - 1)} title="Move this scene earlier">◀</Btn>
              <Btn small disabled={sel === p.scenes.length - 1} onClick={() => move(sel, sel + 1)} title="Move this scene later">▶</Btn>
              <Btn small onClick={dupScene} title="Duplicate this scene">⧉</Btn>
              <Btn small tone="red" disabled={p.scenes.length < 2} onClick={() => delSceneAt(sel)} title="Delete this scene (Delete key)">✕</Btn>
            </>) : null}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              {canEdit && !hasVoice && tl.total > 6 ? (<>
                <span style={{ fontSize: 11, color: UI.mut }}>Fit the whole ad into</span>
                {[6, 10, 15, 30].map(n => <Btn key={n} small disabled={tl.total <= n} onClick={() => cutTo(n)} title="Cuts every scene's hold down together so the whole ad fits">{n} s</Btn>)}
              </>) : null}
              {canEdit && p.scenes.length > 1 ? (picked.length
                ? <><span style={{ fontSize: 11, color: UI.gold, fontWeight: 700 }}>{targetIdx().length} selected</span><Btn small onClick={() => setPicked([])}>Clear</Btn></>
                : <Btn small onClick={pickAll} title="Select every scene, then change design, motion or graphics on all of them (or shift / ⌘-click scenes)">Select all</Btn>) : null}
            </span>
          </div>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '64px 1fr', rowGap: 6 }}>
            <span />
            <div onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); seek((e.clientX - r.left) / r.width * tl.total) }}
              style={{ position: 'relative', height: 18, cursor: 'pointer', borderBottom: '1px solid ' + UI.line }}>
              {Array.from({ length: Math.floor(tl.total / 5) + 1 }, (_, k) => k * 5).map(s => (
                <span key={s} style={{ position: 'absolute', left: pct(s) + '%', fontSize: 9.5, color: UI.mut, fontFamily: 'ui-monospace, Menlo, monospace', transform: 'translateX(-50%)' }}>{fmtT(s).replace(/\.0$/, '')}</span>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Scenes</span>
            <div style={{ position: 'relative', height: 50 }}>
              {p.scenes.map((s, i) => (
                <div key={s.id} draggable={canEdit} onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom != null) move(dragFrom, i); setDragFrom(null) }}
                  onClick={e => { if (e.shiftKey || e.metaKey || e.ctrlKey) { togglePick(i); return } pick(i) }} title={(s.head || s.vo || KINDS.find(k => k.kind === s.kind)?.label || '').replace(/\*\*/g, '') + ' · shift / ⌘-click to select several'}
                  style={{ position: 'absolute', left: pct(tl.starts[i]) + '%', width: `calc(${pct(tl.durs[i])}% - 3px)`, top: 0, bottom: 0, borderRadius: 7, cursor: 'pointer', overflow: 'hidden',
                    background: (s.photos[0] && !s.photos[0].startsWith('video:') ? `linear-gradient(rgba(10,14,20,${i === sel ? 0.35 : 0.6}), rgba(10,14,20,${i === sel ? 0.55 : 0.8})), url(${proxied(s.photos[0])}) center/cover` : KIND_COLOR[s.kind] + (i === sel ? '' : '55')), border: '2px solid ' + (picked.indexOf(s.id) >= 0 ? UI.gold : i === sel ? '#fff' : 'transparent'), boxShadow: 'inset 4px 0 0 ' + KIND_COLOR[s.kind], padding: '4px 6px 4px 9px', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>{picked.indexOf(s.id) >= 0 ? '✓ ' : ''}{i + 1} · {s.act ? <span style={{ color: ACT_COLOR[s.act] }}>{ACT_LABEL[s.act]} · </span> : null}{KINDS.find(k => k.kind === s.kind)?.label}{s.aiPending ? ' · AI…' : s.src === 'ai' ? ' · AI' : ''}{s.sfx ? ' · 🔊' : ''}{(s.fx || []).length ? ' · ✦' : ''}{hasCustom(s) ? ' · 🎨' : ''}</span>
                  <span style={{ display: 'block', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(s.head || s.vo).replace(/\*\*/g, '').replace(/\n/g, ' ')}</span>
                  {canEdit && p.scenes.length > 1 ? (
                    <button type="button" onClick={e => { e.stopPropagation(); delSceneAt(i) }} title="Delete this scene"
                      style={{ position: 'absolute', top: 3, right: 4, width: 18, height: 18, borderRadius: 9, border: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11, lineHeight: '18px', cursor: 'pointer', opacity: i === sel ? 1 : 0.6, padding: 0 }}>✕</button>
                  ) : null}
                </div>
              ))}
              {/* the transitions, sitting on the seams like Final Cut's — click one to change it */}
              {p.scenes.map((s, i) => i === 0 ? null : (
                <button key={'tr' + s.id} type="button" disabled={!canEdit} onClick={e => { e.stopPropagation(); pick(i); setTrPick(true) }}
                  title={'Transition: ' + (trMeta(s.tr || 'auto')?.label || 'Auto') + (s.tr === 'cut' ? '' : ' · ' + (s.trs === 'short' ? 'quick' : s.trs === 'long' ? 'slow' : 'normal')) + ' — click to change'}
                  style={{ position: 'absolute', left: `calc(${pct(tl.starts[i])}% - 13px)`, top: 27, width: 22, height: 20, borderRadius: 5, border: '1px solid ' + (i === sel ? '#fff' : 'rgba(255,255,255,.35)'), background: s.tr === 'cut' ? '#2A313C' : 'linear-gradient(90deg, #3a4657 0 50%, #59677a 50% 100%)', color: '#fff', fontSize: 10, lineHeight: '18px', padding: 0, cursor: canEdit ? 'pointer' : 'default', zIndex: 2, boxShadow: '0 1px 4px rgba(0,0,0,.5)' }}>
                  {s.tr === 'cut' ? '|' : '⋈'}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Voice</span>
            <div style={{ position: 'relative', height: 22 }}>
              {tl.voiced ? tl.spans.map((s, k) => (
                <div key={k} style={{ position: 'absolute', left: pct(s.from) + '%', width: pct(s.to - s.from) + '%', top: 4, bottom: 4, borderRadius: 4, background: 'repeating-linear-gradient(90deg,#4C8DF6 0 2px,#2c5aa8 2px 4px)' }} />
              )) : p.scenes.map((s, i) => s.vo.trim() ? (
                <div key={i} style={{ position: 'absolute', left: pct(tl.starts[i] + 0.4) + '%', width: `calc(${pct(Math.max(0.5, tl.durs[i] - (i === p.scenes.length - 1 ? 3 : 1)))}%)`, top: 4, bottom: 4, borderRadius: 4, border: '1px dashed #4C8DF6' }} />
              ) : null)}
            </div>
            <span style={{ fontSize: 10.5, color: UI.mut, alignSelf: 'center' }}>Music</span>
            <div style={{ position: 'relative', height: 22 }}>
              {p.music !== 'none' ? (
                <div style={{ position: 'absolute', left: 0, right: 0, top: 4, bottom: 4, borderRadius: 4, background: `linear-gradient(90deg, rgba(210,176,119,.15), rgba(210,176,119,.55) ${pct(1)}%, rgba(210,176,119,.55) ${pct(tl.voiced ? tl.voEnd + 0.3 : tl.total - 4)}%, rgba(210,176,119,0) 100%)` }}>
                  <span style={{ fontSize: 9.5, color: UI.ink, padding: '0 6px', lineHeight: '14px' }}>{track(p.music).label} · ducks under the voice · fades out on the end card</span>
                </div>
              ) : null}
            </div>
            {/* playhead */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(64px + (100% - 64px) * ${tl.total ? t / tl.total : 0})`, width: 2, background: UI.red, pointerEvents: 'none' }} />
          </div>
        </div>
      ) : null}
      {ideas ? (() => { const list = momentAngles(ideas.m, whenShort(ideas.m)); const KL = (k: string) => KINDS.find(x => x.kind === k)?.label || k; return (
        <div onClick={() => setIdeas(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(980px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, color: UI.ink, padding: '14px 18px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: display, fontWeight: 800, fontSize: 19 }}>{ideas.m.emoji} {ideas.m.name} · {list.length} ideas</span>
              <span style={{ fontSize: 12.5, color: UI.mut }}>{ideas.m.audience === 'owners' ? 'Written for owners' : ideas.m.audience === 'both' ? 'For guests, with an owner version' : 'Written for guests'} · a {ideas.k === 'flyer' ? 'photo post' : 'animated post'} · pick the angle</span>
              <span style={{ marginLeft: 'auto' }}><Btn small onClick={() => setIdeas(null)}>Close</Btn></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {list.map(a => { const first = ideas.k === 'flyer' ? a.flyer : a.post[0]; return (
                <button key={a.key} type="button" onClick={() => { const it = ideas; setIdeas(null); if (it.rebuild) reAngle(it.m, a, it.k); else if (it.k === 'flyer') startFlyer(it.m, a); else startPost(it.m, a) }}
                  style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 10, padding: '10px 12px', color: UI.ink, cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800 }}>{a.name}{a.audience === 'owners' && ideas.m.audience !== 'owners' ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0E1116', background: '#fff', borderRadius: 6, padding: '1px 6px' }}>OWNERS</span> : null}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: UI.mut, margin: '2px 0 8px' }}>{a.pitch}</span>
                  <span style={{ display: 'block', fontFamily: display, fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>“{first.head.replace(/\*\*/g, '').replace(/\n/g, ' ')}”</span>
                  {first.sub ? <span style={{ display: 'block', fontSize: 11.5, color: UI.mut, marginTop: 4 }}>{first.sub}</span> : null}
                  <span style={{ display: 'block', fontSize: 10.5, color: UI.mut, marginTop: 8, letterSpacing: '0.02em' }}>{ideas.k === 'flyer' ? 'Photo post · ' + (first.items[2] || 'auto') + ' style' : a.post.map(x => KL(x.kind)).join(' → ')}</span>
                </button>
              ) })}
            </div>
          </div>
        </div>
      ) })() : null}
      {trPick && p && sc && sel > 0 ? (
        <TransitionPicker proj={p} from={p.scenes[sel - 1]} to={sc} current={sc.tr || 'auto'} assets={assets} display={display}
          scope={trAll ? 'all' : 'one'} onScope={k => setTrAll(k === 'all')} onClose={() => setTrPick(false)}
          onPick={k => { setTr({ tr: k }, trAll); setTrPick(false) }} />
      ) : null}
      {fxPick && p && sc ? (
        <GraphicsPicker proj={p} scene={sc} on={sc.fx || []} assets={assets} display={display}
          scope={fxAll ? 'all' : 'one'} onScope={k => setFxAll(k === 'all')} onClose={() => setFxPick(false)} onToggle={toggleFx} />
      ) : null}
      {picker && p && sc ? (
        <AdDesignPicker proj={p} assets={assets} display={display} onClose={() => setPicker(null)}
          scene={picker === 'add' ? { id: 'new', kind: 'cinema', vo: '', head: '', sub: '', items: [], photos: sc.photos.filter(u => !u.startsWith('video:')).slice(0, 1) } : sc}
          current={picker === 'change' ? sc.kind : undefined}
          title={picker === 'add' ? 'Add a scene' : targetIdx().length > 1 ? 'Design for the ' + targetIdx().length + ' selected scenes' : 'Design for scene ' + (sel + 1)}
          sub={picker === 'add' ? 'Pick how it looks — it goes in after scene ' + (sel + 1) + '. Words and photos come next.' : 'This scene, drawn in every design. Pick one.'}
          onPick={kind => { if (picker === 'add') { addScene(kind); setTab('scene') } else setMany(() => ({ kind })); setPicker(null) }} />
      ) : null}
      {versions ? (
        <div onClick={() => setVersions(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ fontFamily: display, fontWeight: 800, fontSize: 16 }}>Versions</span><span style={{ marginLeft: 'auto' }}><Btn small onClick={() => setVersions(null)}>Close</Btn></span></div>
            <p style={{ fontSize: 11.5, color: UI.mut, margin: '4px 0 10px' }}>Every real change keeps the state before it (last 12). Restoring keeps today's state as a version too.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
              {versions.map(v => (
                <div key={v.ts} style={{ display: 'flex', alignItems: 'center', gap: 8, background: UI.panel2, borderRadius: 8, padding: '7px 10px' }}>
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{new Date(v.ts).toLocaleString()}</span><span style={{ fontSize: 11, color: UI.mut }}>{v.scenes} scenes · {LOOKS.find(l => l.key === v.look)?.label || v.look} · {v.by}</span></span>
                  {canEdit ? <Btn small onClick={() => restore(v.ts)}>Restore</Btn> : null}
                </div>
              ))}
              {!versions.length ? <p style={{ fontSize: 12, color: UI.mut }}>No earlier versions yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      {watch ? (
        <div onClick={() => setWatch(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 80, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(960px, 100%)' }}>
            <video src={watch.url} controls autoPlay style={{ width: '100%', maxHeight: '80vh', borderRadius: 10, background: '#000' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, color: '#fff' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{watch.name}</span>
              <button onClick={() => setWatch(null)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #555', color: '#fff', borderRadius: 8, padding: '5px 12px', cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
