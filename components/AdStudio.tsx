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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AdProject, type AdScene, type AdKind, type AdFormat, type AdAssets, type AdAudience, type AdTemplate,
  FORMATS, FORMAT_LABEL, VOICES, MUSIC, LOOKS, GOALS, TRANSITIONS, type AdTransition, STYLE_OPTIONS, STYLE_DEFAULT, type AdStyle, TEXT_ANIMS, CAMS, SWATCHES, type AdTextAnim, type AdCam, VOICE_DEFAULTS, KINDS, LEAD, TEMPLATES, timeline, drawFrame, sceneAt, voiceSig, riskyWords, newSceneId,
} from '@/lib/ad-engine'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

type ListRow = { id: string; name: string; updatedAt: string; updatedBy: string; scenes: number; format: string }
type Sound = { key: string; name: string; kind: 'music' | 'sfx'; url: string; dur: number; prompt: string; createdAt: string; by: string; path: string }
type LibVoice = { id: string; name: string; blurb: string; preview: string }
type Plan = {
  name: string; property: string; brief: string
  settings: { audience: AdAudience; format: AdFormat; seconds: number; music: string }
  angle: string; hook: string
  questions: { id: string; q: string; options: string[] }[]
  outline: string[]; warnings: string[]
}
type Hit = { url: string; view?: string; thumb: string; caption: string; unit: string; building: string; width: number | null }
type LibVideo = { key: string; name: string; url: string; thumb: string; dur: number; format: string; builtin: boolean; createdAt: string; by: string; path?: string }

const UI = {
  bg: '#0E1116', panel: '#151A21', panel2: '#1B222B', line: '#262E39', ink: '#E8EBEF', mut: '#8C96A3', gold: '#D2B077', blue: '#4C8DF6', red: '#E5675C', green: '#4CC488',
}
const KIND_COLOR: Record<AdKind, string> = {
  cta: '#E0A64C', mask: '#E0C04C', panel: '#7FA6C9', ticker: '#E06C4C', callouts: '#4CC4A8', polaroid: '#C9B79A', event: '#A06CE0', cinema: '#C98B5E', kinetic: '#E06C9F', reveal: '#5FB8C9', title: '#C9A15E', photo: '#5C8FD6', stats: '#6CB28C', wall: '#9A7FD1', cards: '#D07F5C', feed: '#4FA7B8', checks: '#8FB04A', rise: '#D4677C', contact: '#B58B3E',
}
const AUD: Record<AdAudience, { label: string; brief: string; hint: string }> = {
  owners: { label: 'Owners', brief: 'property owners', hint: 'Sell management: revenue, team, Lighthouse; ends on Nick' },
  partners: { label: 'Partners', brief: 'realtors, lenders and tax advisors who refer owners', hint: 'For referral partners; ends on Nick' },
  guests: { label: 'Guests', brief: 'travellers choosing where to stay in South Florida', hint: 'Sell the stay; ends on Book at stay-hospitality.com' },
}
/** Jon, 2026-11-02: "never use a collage photo ever" — photos captioned as grids/collages are left out. */
const COLLAGE = /collage|grid|mosaic|side[- ]by[- ]side|split view|multiple (photos|images|views)|before.{0,4}after|floor ?plan/i
const proxied = (u: string) => (!u ? '' : u.startsWith('/') ? u : /guesty|cloudinary|muscache/i.test(u) ? '/api/img-proxy?url=' + encodeURIComponent(u) : u)
const fmtT = (s: number) => { const m = Math.floor(s / 60); const r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) }

function Btn({ on, children, onClick, title, tone, disabled, small }: { on?: boolean; children: React.ReactNode; onClick?: () => void; title?: string; tone?: 'gold' | 'blue' | 'red'; disabled?: boolean; small?: boolean }) {
  const bg = tone === 'gold' ? UI.gold : tone === 'blue' ? UI.blue : tone === 'red' ? 'transparent' : on ? '#2A3442' : 'transparent'
  const fg = tone === 'gold' ? '#1B1408' : tone === 'blue' ? '#fff' : tone === 'red' ? UI.red : on ? UI.ink : UI.mut
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      style={{ background: bg, color: fg, border: '1px solid ' + (tone ? (tone === 'red' ? '#5a2a26' : 'transparent') : on ? '#3A4657' : UI.line), borderRadius: 8, padding: small ? '4px 8px' : '7px 12px', fontSize: small ? 11.5 : 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
const Label = ({ children }: { children: React.ReactNode }) => <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut, margin: '14px 0 6px' }}>{children}</p>
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

export default function AdStudio({ display, body, serif, condensed, elegant, canEdit, canDelete, full }: { display: string; body: string; serif?: string; condensed?: string; elegant?: string; canEdit: boolean; canDelete: boolean; full?: boolean }) {
  const [list, setList] = useState<ListRow[]>([])
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
  const [side, setSide] = useState<'ads' | 'templates' | 'videos' | 'sounds'>('ads')
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
  const [ws, setWs] = useState(0)
  const [draft, setDraft] = useState<{ name: string; scenes: AdScene[]; settings: Plan['settings']; note: string } | null>(null)
  const [st, setSt] = useState<{ mode: 'describe' | 'script' | 'template' | 'revamp' | 'blank'; prompt: string; goal: string; music: string; vibe: string; look: string; format: AdFormat | ''; from: string; audience: AdAudience; who: string; why: string; script: string }>({ mode: 'describe', prompt: '', goal: 'bookings', music: '', vibe: '', look: 'stay', format: '', from: '', audience: 'guests', who: '', why: '', script: '' })
  const seed = useRef<{ fresh: boolean; look: string; goal: string; music: string; vibe: string } | null>(null)
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
  const [searching, setSearching] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
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
    const r = await fetch('/api/ads?id=' + encodeURIComponent(id)).then(x => x.json()).catch(() => null)
    if (!r?.ok) {
      // The last ad opened was deleted: forget it quietly instead of showing an error on arrival.
      if (quiet) { try { localStorage.removeItem('adstudio.last') } catch { /* fine */ } return }
      setErr(r?.error || 'Could not open that ad.'); return
    }
    setErr(''); setPlan(null)
    setP(r.project); setAudioUrl(r.audioUrl || null); setSel(0); setT(1.6); setSaved('saved'); setBrief(r.project.prompt || '')
    try { localStorage.setItem('adstudio.last', id) } catch { /* fine */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadList().then(() => {
      let last = ''
      try { last = localStorage.getItem('adstudio.last') || '' } catch { /* fine */ }
      if (last) open(last, true)
    })
    const l = new Image(); l.src = '/ads/stay-logo-gold.png'; l.onload = () => { logo.current = l; logos.current.gold = l }
    ;(['black', 'white'] as const).forEach(c => { const im = new Image(); im.src = '/ads/stay-logo-' + c + '.png'; im.onload = () => { logos.current[c] = im } })
    loadLib(); loadSounds()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const newAd = async (): Promise<AdProject | null> => {
    setBusy('new'); setErr('')
    const r = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'Could not start a new ad.'); return null }
    stop(); setP(r.project); pRef.current = r.project; setAudioUrl(null); setSel(0); setT(1.6); setSaved('saved'); setBrief('')
    loadList()
    return r.project
  }
  const openStart = () => { stop(); setPlan(null); setErr(''); setWs(0); setStarting(true); setSt(x => ({ ...x, prompt: '', vibe: '', from: '', who: '', why: '', script: '' })); setDraft(null) }
  const goalOf = (k: string) => GOALS.find(g => g.key === k)
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
  const startGo = async () => {
    const g = goalOf(st.goal)
    const look = st.look, music = st.music, vibe = st.vibe
    if (st.mode === 'describe') {
      if (!st.prompt.trim()) { setErr('Describe the ad first — even one line, e.g. a cool video for Amrit.'); return }
      seed.current = { fresh: true, look, goal: st.goal, music, vibe }
      setBrief(st.prompt.trim()); setStarting(false)
      await planAd(st.prompt.trim() + '\n\n' + seedLines(), { audience: st.audience, format: st.format || undefined })
      return
    }
    if (st.mode === 'revamp') {
      if (!st.from) { setErr('Pick the ad to revamp.'); return }
      const src = await fetch('/api/ads?id=' + encodeURIComponent(st.from)).then(x => x.json()).catch(() => null)
      if (!src?.ok) { setErr('Could not open that ad.'); return }
      const S: AdProject = src.project
      const n = await newAd(); if (!n) return
      setStarting(false); setBusy('adask')
      let scenes = S.scenes.map(x => ({ ...x, items: x.items.slice(), photos: x.photos.slice() }))
      const base: AdProject = { ...n, name: S.name + ' · revamp', format: (st.format || S.format) as AdFormat, audience: st.audience, music: music || S.music, look, goal: st.goal, contact: S.contact, captions: S.captions, voiceId: S.voiceId, voiceName: S.voiceName, voiceSettings: S.voiceSettings, scenes }
      const ask = 'REVAMP THIS AD: keep what works, make it fresher and stronger. ' + (st.prompt.trim() ? 'What to change: ' + st.prompt.trim() + '. ' : '') + seedLines()
      const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: ask, seconds, audience: AUD[base.audience].brief, format: base.format, current: base }) }).then(x => x.json()).catch(() => null)
      setBusy('')
      if (r?.ok && r.scenes?.length) scenes = r.scenes
      else setErr('Copied the ad, but the rewrite did not come back — it is the original scenes for now. Try "Change the whole ad".')
      change(() => ({ ...base, prompt: st.prompt, scenes }))
      setSel(0); setT(1.6)
      vibeTrack(vibe)
      return
    }
    const n = await newAd(); if (!n) return
    change(d => ({ ...d, look, goal: st.goal, audience: st.audience, music: music || d.music, format: (st.format || d.format) as AdFormat }))
    setStarting(false)
    if (st.mode === 'template') { setSide('templates'); vibeTrack(vibe); return }
    vibeTrack(vibe)
  }

  // ── editing + autosave ────────────────────────────────────────────────
  const change = (fn: (d: AdProject) => AdProject) => {
    if (!canEdit) return
    setP(cur => (cur ? fn(cur) : cur))
    setSaved('dirty')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 1200)
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

  // ── AI: write / rewrite ───────────────────────────────────────────────
  const write = async (rewrite: boolean, change_?: string) => {
    if (!p) return
    setBusy(change_ ? 'adask' : rewrite ? 'rewrite' : 'write'); setErr('')
    const prompt = change_ ? (brief ? brief + '\n\n' : '') + 'CHANGE REQUESTED FOR THE WHOLE AD (keep everything else): ' + change_ : brief
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds, audience: AUD[p.audience].brief, format: p.format, current: rewrite ? p : null }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok) { setErr(r?.error || 'The writer did not answer. Try again.'); return }
    if (r.warnings?.length) setErr('Fact check: ' + r.warnings.join(' · '))
    change(d => ({ ...d, prompt: brief, name: d.name === 'Untitled ad' && r.name ? r.name : d.name, scenes: r.scenes }))
    setSel(0); setT(1.6); setUndo(null)
    if (change_) setAdAsk('')
  }
  // ── plan first: sharpen the brief and confirm the details before anything is built ──
  const planAd = async (override?: string, opt?: { audience?: AdAudience; format?: AdFormat }) => {
    const b = override || brief
    if (!b.trim()) { setErr('Write a line about the ad first, e.g. "a cool video for Amrit".'); return }
    if (!override) seed.current = null
    stop(); setBusy('plan'); setErr('')
    const r = await fetch('/api/ads/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: b, seconds, format: opt?.format || p?.format || '16:9', audience: opt?.audience || p?.audience || 'owners' }) }).then(x => x.json()).catch(() => null)
    setBusy('')
    if (!r?.ok || !r.plan) { setErr(r?.error || 'Could not plan that one. Try again.'); return }
    const pl: Plan = r.plan
    // What was picked in the chooser wins over the planner's suggestion.
    const sd = seed.current
    if (sd?.music) pl.settings.music = sd.music
    if (opt?.format) pl.settings.format = opt.format
    setPlan(pl); setPlanNote('')
    setAnswers(Object.fromEntries(pl.questions.map(q => [q.id, q.options[0]])))
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
    const r = await fetch('/api/ads/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds: set.seconds, audience: AUD[set.audience].brief, format: set.format, current: current || null }) }).then(x => x.json()).catch(() => null)
    if (!r?.ok || !r.scenes?.length) { setErr(r?.error || 'The writer did not answer. Try again.'); return null }
    if (r.warnings?.length) setErr('Fact check: ' + r.warnings.join(' · '))
    return { name: r.name || '', scenes: r.scenes }
  }
  /** Put finished scenes into an ad (a new one when the guide started it), with the chosen settings. */
  const applyScenes = async (name: string, scenes: AdScene[], set: Plan['settings']) => {
    const sd = seed.current
    let base = sd?.fresh ? null : pRef.current
    if (!base) {
      const n = await fetch('/api/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new: true }) }).then(x => x.json()).catch(() => null)
      if (!n?.ok) { setErr(n?.error || 'Could not start a new ad.'); return }
      base = n.project as AdProject
      setP(base); pRef.current = base; setAudioUrl(null); loadList()
    }
    setSeconds(set.seconds)
    change(d => ({ ...d, prompt: brief, name: name || d.name, audience: set.audience, format: set.format, music: set.music || d.music, look: sd?.look || d.look, goal: sd?.goal || d.goal, scenes }))
    setPlan(null); setDraft(null); setSel(0); setT(1.6); setUndo(null)
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
    seed.current = { fresh: true, look: st.look, goal: st.goal, music: st.music, vibe: st.vibe }
    setBrief(st.prompt || 'From a script')
    setBusy('script')
    const w = await writeScenes('LAY OUT THIS SCRIPT AS SCENES. Keep the spoken words exactly as written (only split them across scenes; fix nothing but obvious typos). Choose the scene kinds, on-screen headlines and photoQuery words that fit each line.\n\n' + seedLines() + '\n\nTHE SCRIPT:\n' + st.script.trim(), set)
    setBusy('')
    if (!w) return false
    setDraft({ name: w.name || 'Scripted ad', scenes: w.scenes, settings: set, note: '' })
    return true
  }

  /** Jon: "a wide range of styles and looks" — one tap for a fresh combination. */
  const surprise = () => {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
    const look = pick(LOOKS.filter(l => l.key !== (pRef.current?.look || 'stay'))).key
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
        let now = tRef.current
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

  // Follow the playhead with the selection while playing; seek to a scene when it is picked.
  useEffect(() => { if (playing && tl) { const i = sceneAt(tl, t); if (i !== sel) setSel(i) } }, [t]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (i: number) => { setSel(i); if (tl && !playing) setT(tl.starts[i] + Math.min(1.6, tl.durs[i] * 0.6)) }
  const seek = (x: number) => { const was = !!play0.current; stop(); const to = Math.max(0, x); setT(to); tRef.current = to; if (was) start(to) }

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
    const vs = (cv as any).captureStream(30) as MediaStream
    const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()])
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    const mime = types.find(x => (window as any).MediaRecorder && MediaRecorder.isTypeSupported(x)) || ''
    if (!mime) { setErr('This browser cannot record video. Use Chrome or Safari.'); return }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<void>(res => { rec.onstop = () => res() })
    live.current = true
    drawFrame(g, p, tl, 0, assets())
    rec.start(500)
    const at = c.currentTime + 0.15
    const nodes = wire(c, dest, 0, v, m, at, fx)
    setExportPct(0)
    await new Promise<void>(res => {
      const step = () => {
        const x = Math.max(0, c.currentTime - at)
        drawFrame(g, p, tl, Math.min(x, tl.total - 0.001), assets())
        setExportPct(Math.min(100, Math.round(x / tl.total * 100)))
        if (x >= tl.total + 0.2) { res(); return }
        setTimeout(step, 1000 / 30)
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
    drawFrame(cv.getContext('2d')!, p, tl, Math.min(t, tl.total - 0.01), assets())
    const b = await new Promise<Blob | null>(res => cv.toBlob(x => res(x), 'image/png'))
    if (b) download(b, 'png')
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
  const applyTemplate = async (tp: AdTemplate) => {
    const p = pRef.current
    if (!p || !canEdit) return
    if (p.scenes.length > 2 && !window.confirm('Replace the scenes in "' + p.name + '" with the ' + tp.label + ' template?')) return
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
      scenes.push({ id: 's' + (i + 1), kind: s.kind, vo: s.vo, head: s.head, sub: s.sub, items: s.items.slice(), photos, dur: s.dur || null })
    }
    setBusy('')
    change(d => ({ ...d, name: d.name === 'Untitled ad' ? tp.name : d.name, format: d.goal ? d.format : tp.format, audience: tp.audience, scenes }))
    setSel(0); setT(1.6); setSide('ads')
  }

  // ── photos ────────────────────────────────────────────────────────────
  const search = async () => {
    if (!q.trim()) return
    setSearching(true)
    const r = await fetch('/api/photos/library?search=' + encodeURIComponent(q.trim())).then(x => x.json()).catch(() => null)
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

  const del = async () => {
    if (!p || !canDelete) return
    if (!window.confirm('Delete "' + p.name + '" and its voice takes? This cannot be undone.')) return
    await fetch('/api/ads?id=' + encodeURIComponent(p.id), { method: 'DELETE' })
    setP(null); loadList()
  }

  // ─────────────────────────────── render ───────────────────────────────
  const sc = p ? p.scenes[sel] : null
  const [FW, FH] = p ? FORMATS[p.format] : [1920, 1080]
  const pw = FW >= FH ? (full ? 1280 : 960) : 540 * (FW / FH) * 1.6
  const totalW = 100 // timeline is % based
  const pct = (x: number) => (tl ? (x / tl.total) * totalW : 0)

  return (
    <div style={{ background: UI.bg, color: UI.ink, borderRadius: full ? 0 : 14, border: full ? 0 : '1px solid ' + UI.line, overflow: 'hidden', fontFamily: body, minHeight: full ? '100vh' : undefined }}>
      {/* ── top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid ' + UI.line, flexWrap: 'wrap', background: UI.panel }}>
        <span style={{ fontFamily: display, fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>Ad Studio</span>
        {full
          ? <a href="/ads" style={{ fontSize: 11.5, color: UI.mut, textDecoration: 'none', border: '1px solid ' + UI.line, borderRadius: 8, padding: '4px 8px' }} title="Back to Lighthouse">← Lighthouse</a>
          : <a href="/ads?full=1" target="_blank" rel="noopener" style={{ fontSize: 11.5, color: UI.mut, textDecoration: 'none', border: '1px solid ' + UI.line, borderRadius: 8, padding: '4px 8px' }} title="Open the editor on its own, full screen, in a new tab">⤢ Full screen</a>}
        {canEdit ? <Btn tone="gold" small onClick={openStart} title="Guided: describe it, answer a few questions, then build">✦ Create new ad</Btn> : null}
        {p ? (
          <input value={p.name} disabled={!canEdit} onChange={e => change(d => ({ ...d, name: e.target.value }))} style={{ ...field, width: 260, padding: '6px 10px', fontWeight: 600 }} />
        ) : null}
        {p ? (
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(FORMATS) as AdFormat[]).map(f => <Btn key={f} small on={p.format === f} title={FORMAT_LABEL[f]} onClick={() => change(d => ({ ...d, format: f }))}>{f}</Btn>)}
          </div>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: saved === 'dirty' || saved === 'saving' ? UI.gold : UI.mut }}>
          {saved === 'saving' ? 'Saving…' : saved === 'dirty' ? 'Unsaved changes' : saved === 'saved' ? 'Saved' : ''}
        </span>
        {p && canEdit ? <Btn tone={stale || !p.voice ? 'blue' : undefined} disabled={!!busy} onClick={makeVoice} title="Records the whole script as one take and cuts the scenes to it">{busy === 'voice' ? 'Recording voice…' : p.voice ? (stale ? 'Re-record voice (script changed)' : 'Re-record voice') : 'Make voice'}</Btn> : null}
        {p ? (exportPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600 }}>Exporting {exportPct}% · keep this tab open</span> : libPct != null ? <span style={{ fontSize: 12, color: UI.gold, fontWeight: 600 }}>Saving to the library {libPct}%</span> : (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Btn tone="gold" disabled={!!busy} onClick={exportVideo} title="MP4 with sound, at full size">Export MP4</Btn>
            <Btn small disabled={!!busy} onClick={exportGif} title="An animated GIF, no sound — moves like a post">GIF</Btn>
            <Btn small disabled={!!busy} onClick={exportPng} title="A still of the frame on screen">PNG</Btn>
          </span>
        )) : null}
      </div>
      {err ? <div style={{ background: '#3a1d1b', color: '#F3C2BC', padding: '8px 14px', fontSize: 12.5, display: 'flex', gap: 10 }}><span style={{ flex: 1 }}>{err}</span><button onClick={() => setErr('')} style={{ background: 'none', border: 0, color: '#F3C2BC', cursor: 'pointer' }}>Dismiss</button></div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: full ? '280px minmax(0,1fr) 360px' : '260px minmax(0,1fr) 330px', minHeight: full ? 'calc(100vh - 230px)' : 560 }}>
        {/* ── left: brief + ads ── */}
        <div style={{ borderRight: '1px solid ' + UI.line, padding: '4px 14px 14px', background: UI.panel, minWidth: 0 }}>
          <Label>Brief</Label>
          <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} disabled={!canEdit} placeholder="What is this ad for? Even one line works, e.g. a cool video for Amrit. I'll work through the details with you first." style={field} />
          <Label>Length</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{[15, 30, 45, 60, 90].map(s => <Btn key={s} small on={seconds === s} onClick={() => setSeconds(s)}>{s}s</Btn>)}</div>
          <Label>Audience</Label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(Object.keys(AUD) as AdAudience[]).map(k => <Btn key={k} small on={p?.audience === k} disabled={!p || !canEdit} title={AUD[k].hint} onClick={() => change(d => ({ ...d, audience: k }))}>{AUD[k].label}</Btn>)}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <Btn tone="blue" disabled={!canEdit || !!busy || !brief.trim()} onClick={() => planAd()} title="Works through the details with you first, then builds">{busy === 'plan' ? 'Thinking…' : busy === 'write' ? 'Writing…' : 'Plan the ad'}</Btn>
            <Btn disabled={!p || !canEdit || !!busy || !p?.scenes.length} onClick={() => write(true)} title="Keeps what works and tightens the rest">{busy === 'rewrite' ? 'Rewriting…' : 'Improve draft'}</Btn>
          </div>
          <p style={{ fontSize: 11, color: UI.mut, marginTop: 8, lineHeight: 1.5 }}>I sharpen the brief, ask what matters, and show the scene plan before anything is built. House facts only — no made-up numbers.{p && canEdit ? <> <button onClick={() => write(false)} disabled={!!busy} style={{ background: 'none', border: 0, padding: 0, color: UI.blue, cursor: 'pointer', fontSize: 11 }}>Skip — write it now</button></> : null}</p>
          {p && canEdit && p.scenes.length ? (
            <>
              <Label>Change the whole ad</Label>
              <textarea value={adAsk} onChange={e => setAdAsk(e.target.value)} rows={2} placeholder="e.g. make it faster, open on the rooftop, add a scene about guidebooks" style={field} />
              <div style={{ marginTop: 6 }}><Btn small tone="blue" disabled={!!busy || !adAsk.trim()} onClick={() => write(true, adAsk.trim())}>{busy === 'adask' ? 'Changing…' : 'Apply to the ad'}</Btn></div>
            </>
          ) : null}

          <div style={{ display: 'flex', gap: 4, marginTop: 16, borderTop: '1px solid ' + UI.line, paddingTop: 12 }}>
            {([['ads', 'Ads'], ['templates', 'Templates'], ['videos', 'Videos'], ['sounds', 'Sounds']] as const).map(([k, l]) => <Btn key={k} small on={side === k} onClick={() => setSide(k)}>{l}</Btn>)}
          </div>
          {side === 'templates' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEMPLATES.map(tp => (
                <button key={tp.key} disabled={!p || !canEdit || !!busy} onClick={() => applyTemplate(tp)} style={{ textAlign: 'left', background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, padding: '8px 9px', cursor: 'pointer', color: UI.ink, opacity: !p ? 0.5 : 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{tp.label} <span style={{ color: UI.mut, fontWeight: 500 }}>· {tp.format}</span></span>
                  <span style={{ display: 'block', fontSize: 11, color: UI.mut, marginTop: 2 }}>{tp.blurb}</span>
                </button>
              ))}
              {busy === 'template' ? <p style={{ fontSize: 11.5, color: UI.gold }}>Filling it with photos from the library…</p> : null}
              {!p ? <p style={{ fontSize: 11.5, color: UI.mut }}>Start an ad first (+ New ad), then pick a template.</p> : null}
            </div>
          ) : side === 'sounds' ? (
            <div style={{ marginTop: 10 }}>
              {canEdit ? (
                <div style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, padding: 9 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px' }}>Make a sound with ElevenLabs</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Btn small on={sndKind === 'music'} onClick={() => { setSndKind('music'); setSndSecs(30) }}>Music track</Btn>
                    <Btn small on={sndKind === 'sfx'} onClick={() => { setSndKind('sfx'); setSndSecs(2) }}>Sound effect</Btn>
                  </div>
                  <textarea value={sndPrompt} onChange={e => setSndPrompt(e.target.value)} rows={3} style={{ ...field, marginTop: 6, fontSize: 12 }}
                    placeholder={sndKind === 'music' ? 'e.g. warm lounge house, sunset by the pool, upscale, steady beat' : 'e.g. soft whoosh transition / camera shutter / ocean waves / cash register ding'} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    {(sndKind === 'music' ? [15, 30, 60, 90] : [1, 2, 4, 8]).map(n => <Btn key={n} small on={sndSecs === n} onClick={() => setSndSecs(n)}>{n}s</Btn>)}
                  </div>
                  <input value={sndName} onChange={e => setSndName(e.target.value)} placeholder="Name (optional)" style={{ ...field, marginTop: 6, padding: '6px 9px', fontSize: 12 }} />
                  <div style={{ marginTop: 6 }}><Btn small tone="blue" disabled={!!busy} onClick={makeSound}>{busy === 'sound' ? (sndKind === 'music' ? 'Composing… up to a minute' : 'Making…') : 'Generate'}</Btn></div>
                </div>
              ) : null}
              <Label>Playlist · bundled</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {MUSIC.filter(m => m.file).map(m => (
                  <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: p?.music === m.key ? '#232C38' : 'transparent', borderRadius: 7, padding: '4px 6px' }}>
                    <Btn small on={hear === m.file} onClick={() => preview(m.file)} title="Listen">{hear === m.file ? '■' : '▶'}</Btn>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>{m.label}</span><span style={{ fontSize: 10.5, color: UI.mut }}>{m.mood}</span></span>
                    {p && canEdit ? <Btn small on={p.music === m.key} onClick={() => change(d => ({ ...d, music: m.key }))}>{p.music === m.key ? 'In use' : 'Use'}</Btn> : null}
                  </div>
                ))}
              </div>
              <Label>Made with ElevenLabs</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                {sounds.map(x => (
                  <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: p?.music === x.key || (sc && sc.sfx === x.key) ? '#232C38' : 'transparent', borderRadius: 7, padding: '4px 6px' }}>
                    <Btn small on={hear === x.url} onClick={() => preview(x.url)} title={x.prompt}>{hear === x.url ? '■' : '▶'}</Btn>
                    <span style={{ flex: 1, minWidth: 0 }} title={x.prompt}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                      <span style={{ fontSize: 10.5, color: UI.mut }}>{x.kind === 'music' ? 'Music' : 'Effect'} · {Math.round(x.dur)}s</span>
                    </span>
                    {p && canEdit ? (x.kind === 'music'
                      ? <Btn small on={p.music === x.key} onClick={() => change(d => ({ ...d, music: x.key }))}>{p.music === x.key ? 'In use' : 'Use'}</Btn>
                      : <Btn small on={!!sc && sc.sfx === x.key} title="Plays as the selected scene lands" onClick={() => setScene(sel, { sfx: sc && sc.sfx === x.key ? '' : x.key })}>{sc && sc.sfx === x.key ? 'On scene' : 'Add to scene'}</Btn>) : null}
                    {canDelete ? <Btn small tone="red" onClick={() => delSound(x)} title="Delete">✕</Btn> : null}
                  </div>
                ))}
                {!sounds.length ? <p style={{ fontSize: 11.5, color: UI.mut }}>Nothing generated yet. Describe a track or an effect above.</p> : null}
              </div>
            </div>
          ) : side === 'videos' ? (
            <div style={{ marginTop: 10 }}>
              {canEdit ? (
                <label style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: UI.ink, border: '1px solid ' + UI.line, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                  + Upload a video
                  <input type="file" accept="video/mp4,video/quicktime,video/webm" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadVideo(f); e.target.value = '' }} />
                </label>
              ) : null}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, color: UI.mut, marginTop: 8 }}>
                <input type="checkbox" checked={keepCopy} onChange={e => setKeepCopy(e.target.checked)} /> Keep a copy of every MP4 export here
              </label>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto' }}>
                {lib.map(v => (
                  <div key={v.key} style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderRadius: 8, overflow: 'hidden' }}>
                    <button onClick={() => setWatch(v)} title="Watch" style={{ display: 'block', width: '100%', aspectRatio: '16/9', border: 0, padding: 0, cursor: 'pointer', background: '#000 center/cover no-repeat', backgroundImage: v.thumb ? `url(${v.thumb})` : 'none', position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,.65)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>▶ {fmtT(v.dur).replace(/\.\d$/, '')}</span>
                    </button>
                    <div style={{ padding: '6px 8px' }}>
                      <p style={{ fontSize: 12, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</p>
                      <p style={{ fontSize: 10.5, color: UI.mut, margin: '2px 0 6px' }}>{v.builtin ? 'Sales video' : (v.format || 'video') + ' · ' + (v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '')}</p>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {canEdit && p ? <Btn small onClick={() => useVideo(v)} title="Puts this clip behind the selected scene">Use in scene</Btn> : null}
                        <a href={v.url} download style={{ fontSize: 11.5, color: UI.mut, padding: '4px 6px' }}>Download</a>
                        {!v.builtin && canDelete ? <Btn small tone="red" onClick={() => delVideo(v)}>Delete</Btn> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {!lib.length ? <p style={{ fontSize: 12, color: UI.mut }}>Loading the library…</p> : null}
              </div>
            </div>
          ) : (<>
          <Label>Ads</Label>
          {canEdit ? <Btn small disabled={!!busy} onClick={openStart}>✦ Create new ad</Btn> : null}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {list.map(a => (
              <button key={a.id} onClick={() => open(a.id)} style={{ textAlign: 'left', background: p?.id === a.id ? '#232C38' : 'transparent', border: 0, borderRadius: 7, padding: '7px 8px', cursor: 'pointer', color: UI.ink }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <span style={{ fontSize: 10.5, color: UI.mut }}>{a.format} · {a.scenes} scenes · {new Date(a.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
            {!list.length ? <p style={{ fontSize: 12, color: UI.mut }}>No ads yet. Start one with + New ad.</p> : null}
          </div>
          {p && canDelete ? <div style={{ marginTop: 14 }}><Btn small tone="red" onClick={del}>Delete this ad</Btn></div> : null}
          </>)}
        </div>

        {/* ── centre: viewer ── */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 0, background: '#0A0D11' }}>
          {starting && !draft ? (() => {
            // A guided "Create new ad" (Jon, 2026-11-02: "create new ad, then guide you through prompt,
            // questions, etc."): one question per step, Back/Next, the AI's questions folded in.
            const pre: string[] = st.mode === 'describe' ? ['how', 'prompt', 'goal', 'audience', 'music', 'look', 'shape']
              : st.mode === 'script' ? ['how', 'script', 'goal', 'audience', 'music', 'look', 'shape']
              : st.mode === 'revamp' ? ['how', 'pick', 'change', 'goal', 'audience', 'music', 'look', 'shape']
              : st.mode === 'template' ? ['how', 'goal', 'audience', 'music', 'look', 'shape'] : ['how', 'goal', 'audience', 'look', 'shape']
            const steps = st.mode === 'describe' ? (plan ? pre.concat(['think'], plan.questions.map((_, i) => 'q' + i), ['review']) : pre.concat(['think'])) : pre
            const i = Math.min(ws, steps.length - 1), key = steps[i]
            const last = i === steps.length - 1
            const next = async () => {
              if (key === 'script' && !st.script.trim()) { setErr('Paste the script first.'); return }
              if (key === 'prompt' && !st.prompt.trim()) { setErr('Say what the ad is about first — even one line.'); return }
              if (key === 'pick' && !st.from) { setErr('Pick the ad to revamp.'); return }
              setErr('')
              if (key === 'think' && plan) { setWs(i + 1); return }
              if (key === 'think') {
                seed.current = { fresh: true, look: st.look, goal: st.goal, music: st.music, vibe: st.vibe }
                setBrief(st.prompt.trim())
                await planAd(st.prompt.trim() + '\n\n' + seedLines(), { audience: st.audience, format: st.format || undefined })
                setWs(i + 1)
                return
              }
              if (last) {
                if (st.mode === 'describe') { setStarting(false); return } // → the plan to review and build
                if (st.mode === 'script') { if (await layOutScript()) setStarting(false); return } // → the script to review
                await startGo(); return
              }
              setWs(i + 1)
            }
            const pickNext = (fn: () => void) => { fn(); setTimeout(() => setWs(w => Math.max(w, i + 1)), 160) }
            const title: Record<string, string> = {
              how: 'How do you want to start?', prompt: 'What’s the ad about?', goal: 'What are you trying to accomplish?', audience: 'Who is it for?', review: 'Here’s the plan', music: 'What’s the vibe?',
              look: 'Pick a look', shape: 'Where will it run?', pick: 'Which ad are we revamping?', change: 'What should change?',
              think: 'Ready — let me work it through', script: 'Paste your script',
            }
            const q = key.startsWith('q') && plan ? plan.questions[Number(key.slice(1))] : null
            return (
              <div style={{ width: '100%', maxWidth: 720, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.gold }}>Create new ad</span>
                  <span style={{ fontSize: 11, color: UI.mut }}>Step {i + 1} of {steps.length}{st.mode === 'describe' && !plan ? '+' : ''}</span>
                  <span style={{ marginLeft: 'auto' }}><Btn small onClick={() => { setStarting(false); setPlan(null) }}>Cancel</Btn></span>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {steps.map((x, k) => <span key={x} onClick={() => k < i && setWs(k)} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= i ? UI.gold : UI.line, cursor: k < i ? 'pointer' : 'default' }} />)}
                </div>
                <p style={{ fontFamily: display, fontSize: 24, fontWeight: 800, margin: '18px 0 4px', letterSpacing: '-0.01em' }}>{q ? q.q : title[key]}</p>
                {q ? <p style={{ fontSize: 12, color: UI.mut, margin: '0 0 12px' }}>A question from the plan · ★ is my recommendation</p> : null}

                <div style={{ marginTop: 12 }}>
                  {key === 'how' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
                      {([['describe', '✦ Describe it', 'Tell me in your words. I ask a few questions, write the script, then build.'], ['script', '📝 From a script', 'Paste a script you have. I lay it out into scenes and build the video.'], ['revamp', '↻ Revamp an ad', 'Take one we made and make it fresher.'], ['template', '▦ From a template', 'A ready layout, filled with our photos.'], ['blank', '□ Blank', 'Empty — build it scene by scene.']] as const).map(([k, l, d]) => (
                        <button key={k} onClick={() => pickNext(() => { setSt(x => ({ ...x, mode: k })); setPlan(null) })} style={{ textAlign: 'left', background: st.mode === k ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (st.mode === k ? UI.blue : UI.line), borderRadius: 11, padding: '14px 14px', cursor: 'pointer', color: UI.ink }}>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{l}</span>
                          <span style={{ display: 'block', fontSize: 12, color: UI.mut, marginTop: 4, lineHeight: 1.45 }}>{d}</span>
                        </button>
                      ))}
                    </div>
                  ) : key === 'prompt' ? (
                    <>
                      <textarea autoFocus value={st.prompt} onChange={e => setSt(x => ({ ...x, prompt: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) next() }} rows={4}
                        placeholder="e.g. a cool video for Amrit · a 15-second Reel for Art Basel weekend at 17WEST · why owners switch to Stay" style={{ ...field, fontSize: 15 }} />
                      <p style={{ fontSize: 11.5, color: UI.mut, marginTop: 6 }}>One line is enough. Name a property and I’ll use its photos.</p>
                    </>
                  ) : key === 'script' ? (
                    <>
                      <textarea autoFocus value={st.script} onChange={e => setSt(x => ({ ...x, script: e.target.value }))} rows={9} placeholder={'Paste the voiceover script. Line breaks help me cut scenes.\n\ne.g.\nWake up to the ocean.\nRooftop pool. Sunset views.\nAmrit, Singer Island.\nBook your stay at stay-hospitality.com.'} style={{ ...field, fontSize: 14 }} />
                      <p style={{ fontSize: 11.5, color: UI.mut, marginTop: 6 }}>{st.script.trim() ? `${st.script.trim().split(/\s+/).length} words · about ${Math.round(st.script.trim().split(/\s+/).length / 2.5)}s spoken · ` : ''}Your words are kept as written. You review the laid-out script before the video is built.</p>
                    </>
                  ) : key === 'pick' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                      {list.map(a => (
                        <button key={a.id} onClick={() => pickNext(() => setSt(x => ({ ...x, from: a.id })))} style={{ textAlign: 'left', background: st.from === a.id ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (st.from === a.id ? UI.blue : UI.line), borderRadius: 9, padding: '9px 11px', cursor: 'pointer', color: UI.ink }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{a.name}</span> <span style={{ fontSize: 11.5, color: UI.mut }}>· {a.format} · {a.scenes} scenes</span>
                        </button>
                      ))}
                      {!list.length ? <p style={{ fontSize: 12, color: UI.mut }}>No ads to revamp yet — go back and pick Describe it.</p> : null}
                    </div>
                  ) : key === 'change' ? (
                    <>
                      <textarea autoFocus value={st.prompt} onChange={e => setSt(x => ({ ...x, prompt: e.target.value }))} rows={3} placeholder="e.g. make it for guests, faster cuts, open on the rooftop (or leave empty: just make it fresher)" style={{ ...field, fontSize: 14 }} />
                      <p style={{ fontSize: 11.5, color: UI.mut, marginTop: 6 }}>The original stays as it is — the revamp is a new ad.</p>
                    </>
                  ) : key === 'goal' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {GOALS.map(g => (
                        <button key={g.key} onClick={() => setSt(x => ({ ...x, goal: g.key, audience: g.audience }))} style={{ textAlign: 'left', background: st.goal === g.key ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (st.goal === g.key ? UI.blue : UI.line), borderRadius: 9, padding: '10px 12px', cursor: 'pointer', color: UI.ink }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{g.label}</span> <span style={{ fontSize: 11.5, color: UI.mut }}>· {g.brief.replace(/^Goal: /, '')}</span>
                        </button>
                      ))}
                      <Label>In your words (optional)</Label>
                      <input value={st.why} onChange={e => setSt(x => ({ ...x, why: e.target.value }))} placeholder="e.g. fill the empty weekdays in December · get 5 owner calls this month" style={field} />
                    </div>
                  ) : key === 'audience' ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(Object.keys(AUD) as AdAudience[]).map(k => (
                          <button key={k} onClick={() => setSt(x => ({ ...x, audience: k }))} style={{ textAlign: 'left', background: st.audience === k ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (st.audience === k ? UI.blue : UI.line), borderRadius: 9, padding: '10px 12px', cursor: 'pointer', color: UI.ink }}>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{AUD[k].label}</span> <span style={{ fontSize: 11.5, color: UI.mut }}>· {AUD[k].hint}</span>
                          </button>
                        ))}
                      </div>
                      <Label>Who exactly? (optional)</Label>
                      <input value={st.who} onChange={e => setSt(x => ({ ...x, who: e.target.value }))} placeholder={st.audience === 'guests' ? 'e.g. couples, families, groups for Art Basel, remote workers' : st.audience === 'owners' ? 'e.g. owners unhappy with their manager, new buyers in Miami' : 'e.g. realtors selling condos in Brickell'} style={field} />
                    </>
                  ) : key === 'review' && plan ? (
                    <div style={{ fontSize: 13, lineHeight: 1.65 }}>
                      <p style={{ margin: 0 }}><b>{plan.name}</b>{plan.property ? <span style={{ color: UI.gold }}> · {plan.property}</span> : null}</p>
                      <p style={{ margin: '4px 0 0', color: UI.mut }}>{plan.brief}</p>
                      {plan.hook ? <p style={{ margin: '6px 0 0' }}><b>Opens on:</b> “{plan.hook}”</p> : null}
                      <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{plan.outline.map((o, k) => <li key={k}>{o.replace(/^\d+[.)]\s*/, '')}</li>)}</ol>
                      <p style={{ fontSize: 12, color: UI.mut, marginTop: 8 }}>Next you can tweak any of it, then build.</p>
                    </div>
                  ) : key === 'music' ? (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={() => setSt(x => ({ ...x, music: '', vibe: '' }))} style={{ textAlign: 'left', background: !st.music && !st.vibe ? '#1d2a3d' : 'transparent', border: '1.5px solid ' + (!st.music && !st.vibe ? UI.blue : UI.line), borderRadius: 9, padding: '8px 11px', cursor: 'pointer', color: UI.ink, fontSize: 13, fontWeight: 600 }}>Pick for me <span style={{ color: UI.mut, fontWeight: 500 }}>· the plan chooses a track that fits</span></button>
                        {MUSIC.filter(m => m.file).map(m => (
                          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: st.music === m.key ? '#1d2a3d' : 'transparent', border: '1.5px solid ' + (st.music === m.key ? UI.blue : UI.line), borderRadius: 9, padding: '5px 8px' }}>
                            <Btn small on={hear === m.file} onClick={() => preview(m.file)} title="Listen">{hear === m.file ? '■' : '▶'}</Btn>
                            <button onClick={() => setSt(x => ({ ...x, music: m.key, vibe: '' }))} style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, color: UI.ink, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{m.label} <span style={{ color: UI.mut, fontWeight: 500 }}>· {m.mood.toLowerCase()}</span></button>
                          </div>
                        ))}
                        {sounds.filter(x => x.kind === 'music').slice(0, 6).map(x => (
                          <div key={x.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: st.music === x.key ? '#1d2a3d' : 'transparent', border: '1.5px solid ' + (st.music === x.key ? UI.blue : UI.line), borderRadius: 9, padding: '5px 8px' }}>
                            <Btn small on={hear === x.url} onClick={() => preview(x.url)}>{hear === x.url ? '■' : '▶'}</Btn>
                            <button onClick={() => setSt(s2 => ({ ...s2, music: x.key, vibe: '' }))} style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, color: UI.ink, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>♪ {x.name} <span style={{ color: UI.mut, fontWeight: 500 }}>· made with ElevenLabs</span></button>
                          </div>
                        ))}
                      </div>
                      <Label>Or describe a new vibe</Label>
                      <input value={st.vibe} onChange={e => setSt(x => ({ ...x, vibe: e.target.value, music: e.target.value ? '' : x.music }))} placeholder="e.g. sunset lounge house, warm, upscale — ElevenLabs composes it" style={field} />
                    </>
                  ) : key === 'look' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, maxHeight: 460, overflowY: 'auto' }}>
                      {LOOKS.map(l => (
                        <button key={l.key} onClick={() => pickNext(() => setSt(x => ({ ...x, look: l.key })))} style={{ padding: 0, border: '2px solid ' + (st.look === l.key ? UI.blue : UI.line), borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'none', color: UI.ink, textAlign: 'left' }}>
                          {p && p.scenes.some(x => x.photos.length) ? <LookPreview proj={p} look={l.key} style={{}} assets={assets} w={200} /> : <span style={{ display: 'block', height: 64, background: `linear-gradient(135deg, ${l.c.navy2}, ${l.c.deep})`, padding: '12px 12px', fontFamily: display, fontWeight: 800, fontSize: 18, color: l.c.ink }}>Stay <span style={{ color: l.c.gold }}>here</span></span>}
                          <span style={{ display: 'block', background: UI.panel2, padding: '7px 10px' }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{l.label}</span><span style={{ fontSize: 10.5, color: UI.mut }}>{l.blurb}</span></span>
                        </button>
                      ))}
                    </div>
                  ) : key === 'shape' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {([['', 'Pick for me', 'the plan chooses from where it fits best']] as [AdFormat | '', string, string][]).concat((Object.keys(FORMATS) as AdFormat[]).map(f => [f, f, FORMAT_LABEL[f]])).map(([f, l, d]) => (
                        <button key={l} onClick={() => pickNext(() => setSt(x => ({ ...x, format: f })))} style={{ textAlign: 'left', background: st.format === f ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + (st.format === f ? UI.blue : UI.line), borderRadius: 9, padding: '10px 12px', cursor: 'pointer', color: UI.ink }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{l}</span> <span style={{ fontSize: 11.5, color: UI.mut }}>· {d}</span>
                        </button>
                      ))}
                    </div>
                  ) : key === 'think' ? (
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: UI.ink }}>
                      <p style={{ margin: 0 }}><b>Ad:</b> {st.prompt}</p>
                      <p style={{ margin: 0 }}><b>Goal:</b> {goalOf(st.goal)?.label}{st.why ? ' — ' + st.why : ''} · <b>For:</b> {AUD[st.audience].label}{st.who ? ' (' + st.who + ')' : ''} · <b>Vibe:</b> {st.vibe || MUSIC.find(m => m.key === st.music)?.label || 'pick for me'} · <b>Look:</b> {LOOKS.find(l => l.key === st.look)?.label} · <b>Shape:</b> {st.format || 'pick for me'}</p>
                      <p style={{ fontSize: 12, color: UI.mut, marginTop: 8 }}>Next, I sharpen this into a plan, check our photos of the property, and ask you only what would change the ad.</p>
                    </div>
                  ) : q ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {q.options.map((o, k) => (
                        <button key={o} onClick={() => pickNext(() => setAnswers(a => ({ ...a, [q.id]: o })))} style={{ textAlign: 'left', background: (answers[q.id] || q.options[0]) === o ? '#1d2a3d' : UI.panel2, border: '1.5px solid ' + ((answers[q.id] || q.options[0]) === o ? UI.blue : UI.line), borderRadius: 9, padding: '10px 12px', cursor: 'pointer', color: UI.ink, fontSize: 13.5, fontWeight: 600 }}>
                          {o}{k === 0 ? <span style={{ color: UI.gold }}> ★</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
                  {i > 0 ? <Btn disabled={!!busy} onClick={() => setWs(i - 1)}>← Back</Btn> : null}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: UI.mut }}>{busy === 'plan' ? 'Working it through… about 20–30 seconds' : ''}</span>
                  <Btn tone="gold" disabled={!!busy} onClick={next}>{busy === 'plan' ? 'Thinking…' : busy ? 'Working…' : key === 'think' ? (plan ? 'Next →' : 'Work it through →') : last ? (st.mode === 'describe' ? 'Review the plan →' : st.mode === 'script' ? (busy === 'script' ? 'Laying it out…' : 'Lay out my script →') : st.mode === 'revamp' ? 'Revamp it →' : st.mode === 'template' ? 'Next: pick a template →' : 'Create it →') : 'Next →'}</Btn>
                </div>
              </div>
            )
          })() : draft ? (
            <div style={{ width: '100%', maxWidth: 760, background: UI.panel, border: '1px solid ' + UI.line, borderRadius: 14, padding: '18px 22px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: display, fontSize: 22, fontWeight: 800 }}>The script</span>
                <span style={{ fontSize: 12, color: UI.mut }}>{draft.scenes.length} scenes · about {Math.round(draft.scenes.reduce((a, x) => a + (x.vo.trim() ? x.vo.trim().split(/\s+/).length / 2.55 + 1 : 3), 0) + 4)}s · {AUD[draft.settings.audience].label} · {draft.settings.format}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <Btn small onClick={copyScript} title="Copies the whole script as text">Copy</Btn>
                  <Btn small onClick={() => setDraft(null)}>{plan ? '← Plan' : 'Cancel'}</Btn>
                </span>
              </div>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ ...field, fontWeight: 700, marginTop: 10 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
                {draft.scenes.map((x, k) => {
                  const put = (patch: Partial<AdScene>) => setDraft({ ...draft, scenes: draft.scenes.map((y, j) => (j === k ? { ...y, ...patch } : y)) })
                  return (
                    <div key={x.id + k} style={{ background: UI.panel2, border: '1px solid ' + UI.line, borderLeft: '4px solid ' + KIND_COLOR[x.kind], borderRadius: 9, padding: '9px 11px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: UI.mut }}>Scene {k + 1} · {KINDS.find(q => q.kind === x.kind)?.label}</span>
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
            <div style={{ width: '100%', maxWidth: 720, background: UI.panel, border: '1px solid #2b4470', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: display, fontSize: 19, fontWeight: 800 }}>Before I build it</span>
                <span style={{ fontSize: 12, color: UI.mut }}>Check the plan, answer the questions, then build.</span>
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
                <span style={{ display: 'flex', gap: 4 }}>{(Object.keys(FORMATS) as AdFormat[]).map(f => <Btn key={f} small on={plan.settings.format === f} title={FORMAT_LABEL[f]} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, format: f } })}>{f}</Btn>)}</span>
                <span style={{ display: 'flex', gap: 4 }}>{[15, 30, 45, 60, 90].map(n => <Btn key={n} small on={plan.settings.seconds === n} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, seconds: n } })}>{n}s</Btn>)}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {MUSIC.filter(m => m.file).map(m => <Btn key={m.key} small on={plan.settings.music === m.key} title={m.mood} onClick={() => setPlan({ ...plan, settings: { ...plan.settings, music: m.key } })}>♪ {m.label}</Btn>)}
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
                <Btn disabled={!!busy} onClick={buildFromPlan}>{busy === 'write' ? 'Building the ad…' : p && p.scenes.length > 1 && !seed.current?.fresh ? 'Skip to the video (replaces this ad’s scenes)' : 'Skip to the video'}</Btn>
                <Btn disabled={!!busy} onClick={replan} title="Plans again with your answers and note">{busy === 'plan' ? 'Thinking…' : 'Rethink with my answers'}</Btn>
                <Btn disabled={!!busy} onClick={() => setPlan(null)}>Cancel</Btn>
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 8 }}>★ = my recommendation. Nothing is built or saved until you press build.</p>
            </div>
          ) : p ? (
            <>
              <canvas ref={canvasRef} width={FW >= FH ? 960 : Math.round(960 * FW / FH)} height={FW >= FH ? Math.round(960 * FH / FW) : 960}
                style={{ ...(FW >= FH ? { width: '100%', maxWidth: pw } : { height: full ? 'calc(100vh - 330px)' : 560, maxHeight: 640, width: 'auto' }), aspectRatio: `${FW}/${FH}`, borderRadius: 8, background: '#000', boxShadow: '0 20px 50px -25px rgba(0,0,0,.8)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: FW >= FH ? pw : 520 }}>
                <Btn tone="gold" onClick={play}>{playing ? '❚❚ Pause' : '▶ Play'}</Btn>
                <Btn small onClick={() => seek(0)}>⏮ Start</Btn>
                <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: UI.mut }}>{fmtT(t)} / {tl ? fmtT(tl.total) : '0:00'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: hasVoice ? UI.green : UI.gold }}>
                  {hasVoice ? 'Timed to the voice' : p.voice ? 'Script changed since the voice — re-record' : 'Estimated timing · make the voice to lock it'}
                </span>
              </div>
            </>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: UI.mut, maxWidth: 380 }}>
              <p style={{ fontFamily: display, fontSize: 22, color: UI.ink, fontWeight: 800 }}>Make an ad</p>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>Start a new ad, write a one-line brief, and let the writer lay out the scenes with photos from our library. Then edit, make the voice, and export for any platform.</p>
              {canEdit ? <div style={{ marginTop: 12 }}><Btn tone="gold" onClick={openStart}>✦ Create new ad</Btn></div> : null}
            </div>
          )}
        </div>

        {/* ── right: inspector ── */}
        <div style={{ borderLeft: '1px solid ' + UI.line, padding: '4px 14px 14px', background: UI.panel, minWidth: 0, maxHeight: full ? 'calc(100vh - 230px)' : 760, overflowY: 'auto' }}>
          {p && sc ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Scene {sel + 1} of {p.scenes.length}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <Btn small disabled={sel === 0} onClick={() => move(sel, sel - 1)} title="Earlier">↑</Btn>
                  <Btn small disabled={sel === p.scenes.length - 1} onClick={() => move(sel, sel + 1)} title="Later">↓</Btn>
                  <Btn small onClick={dupScene} title="Duplicate">⧉</Btn>
                  <Btn small tone="red" disabled={p.scenes.length < 2} onClick={delScene} title="Delete scene">✕</Btn>
                </span>
              </div>
              {canEdit ? (
                <div style={{ marginTop: 10, background: '#18243a', border: '1px solid #2b4470', borderRadius: 9, padding: 9 }}>
                  <p style={{ fontSize: 11.5, fontWeight: 700, margin: '0 0 6px', color: '#BFD4FA' }}>✦ Change this scene with AI</p>
                  <textarea value={ask} onChange={e => setAsk(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askScene(ask) }}
                    placeholder="e.g. make it punchier · show the rooftop pool · turn it into three numbers · mention Art Basel" style={{ ...field, fontSize: 12.5 }} />
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                    <Btn small tone="blue" disabled={!!busy || !ask.trim()} onClick={() => askScene(ask)}>{busy === 'scene' ? 'Changing…' : 'Change it'}</Btn>
                    {['Punchier', 'Shorter', 'New photos', 'Different look'].map(x => <Btn key={x} small disabled={!!busy} onClick={() => askScene(x === 'New photos' ? 'Swap in different, stronger photos that fit this line' : x === 'Different look' ? 'Pick a different scene kind that shows this better' : x === 'Shorter' ? 'Make the voice line and headline shorter' : 'Make the line and headline punchier')}>{x}</Btn>)}
                    {undo && undo.id === sc.id ? <Btn small onClick={undoScene} title="Back to the scene before the AI change">↶ Undo</Btn> : null}
                  </div>
                </div>
              ) : null}
              <Label>Look</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {KINDS.map(k => <Btn key={k.kind} small on={sc.kind === k.kind} title={k.hint} onClick={() => setScene(sel, { kind: k.kind })}>{k.label}</Btn>)}
              </div>
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 6 }}>{KINDS.find(k => k.kind === sc.kind)?.hint}</p>
              {sel > 0 ? (
                <>
                  <Label>Comes in with</Label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {TRANSITIONS.map(x => <Btn key={x} small on={(sc.tr || 'auto') === x} disabled={!canEdit} onClick={() => { setScene(sel, { tr: x as AdTransition }); if (tl) setT(tl.starts[sel] - 0.15) }}>{x === 'auto' ? 'Auto' : x[0].toUpperCase() + x.slice(1)}</Btn>)}
                  </div>
                </>
              ) : null}
              <Label>Headline animation</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {TEXT_ANIMS.map(x => <Btn key={x.key} small on={(sc.anim || 'auto') === x.key} disabled={!canEdit} onClick={() => { setScene(sel, { anim: x.key as AdTextAnim }); if (tl) setT(tl.starts[sel] + 0.05) }}>{x.label}</Btn>)}
              </div>
              <Label>Camera</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {CAMS.map(x => <Btn key={x.key} small on={(sc.cam || 'auto') === x.key} disabled={!canEdit} onClick={() => setScene(sel, { cam: x.key as AdCam })}>{x.label}</Btn>)}
              </div>
              <Label>Badge (sticker)</Label>
              <input value={sc.badge || ''} disabled={!canEdit} maxLength={22} onChange={e => setScene(sel, { badge: e.target.value })} placeholder="Optional, e.g. Oceanfront · Book direct · Rooftop pool" style={{ ...field, padding: '6px 9px' }} />

              <Label>Voice line</Label>
              <textarea rows={3} value={sc.vo} disabled={!canEdit} onChange={e => setScene(sel, { vo: e.target.value })} placeholder="Leave empty for a music-only beat" style={field} />
              <p style={{ fontSize: 11, color: UI.mut, marginTop: 4 }}>
                {sc.vo.trim() ? `${sc.vo.trim().split(/\s+/).length} words · about ${(sc.vo.trim().split(/\s+/).length / 2.55).toFixed(1)}s spoken` : 'Music only'}
                {riskyWords(sc.vo).length ? <span style={{ color: UI.red }}> · The voice says {riskyWords(sc.vo).join(' and ')} wrong — keep it on screen only</span> : null}
              </p>

              {sc.kind !== 'contact' ? (
                <>
                  <Label>Headline on screen</Label>
                  <textarea rows={2} value={sc.head} disabled={!canEdit} onChange={e => setScene(sel, { head: e.target.value })} placeholder="Short. **Gold** a word. Enter = new line." style={field} />
                  <Label>Line under it</Label>
                  <input value={sc.sub} disabled={!canEdit} onChange={e => setScene(sel, { sub: e.target.value })} style={field} />
                  {['stats', 'cards', 'feed', 'checks', 'rise', 'wall'].indexOf(sc.kind) >= 0 ? (
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
                  <input type="number" min={1} max={30} step={0.5} value={sc.dur || ''} placeholder={tl ? tl.durs[sel].toFixed(1) + ' (auto)' : ''} disabled={!canEdit} onChange={e => setScene(sel, { dur: e.target.value ? Number(e.target.value) : null })} style={{ ...field, width: 140 }} />
                </>
              ) : null}

              <Label>Photos</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
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
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }} placeholder="Search the library: 17west pool" style={{ ...field, padding: '6px 9px' }} />
                    <Btn small onClick={search}>{searching ? '…' : 'Find'}</Btn>
                  </div>
                  {hits.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
                      {hits.map(h => {
                        const on = sc.photos.indexOf(h.view || h.url) >= 0 || sc.photos.indexOf(h.url) >= 0
                        return (
                          <button key={h.url} title={h.unit + (h.caption ? ' · ' + h.caption : '')} onClick={() => { const u = h.view || h.url; setScene(sel, { photos: on ? sc.photos.filter(x => x !== u && x !== h.url) : sc.photos.concat([u]).slice(0, 12) }) }}
                            style={{ padding: 0, border: '2px solid ' + (on ? UI.gold : 'transparent'), borderRadius: 6, overflow: 'hidden', aspectRatio: '4/3', cursor: 'pointer', background: UI.panel2 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={h.thumb || h.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}

              <Label>Sound effect</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <Btn small on={!sc.sfx} disabled={!canEdit} onClick={() => setScene(sel, { sfx: '' })}>None</Btn>
                {sounds.filter(x => x.kind === 'sfx').slice(0, 12).map(x => <Btn key={x.key} small on={sc.sfx === x.key} disabled={!canEdit} title={x.prompt} onClick={() => { setScene(sel, { sfx: x.key }); preview(x.url) }}>{x.name}</Btn>)}
                {canEdit ? <Btn small onClick={() => { setSide('sounds'); setSndKind('sfx'); setSndSecs(2) }}>+ Make one</Btn> : null}
              </div>

              <Label>Whole ad</Label>
              <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 6px' }}>
                <p style={{ fontSize: 11.5, color: UI.mut, margin: 0 }}>Look · {LOOKS.find(l => l.key === (p.look || 'stay'))?.label}</p>
                {canEdit ? <span style={{ marginLeft: 'auto' }}><Btn small onClick={surprise} title="A random look and style — keep pressing to explore">🎲 Surprise me</Btn></span> : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6, marginBottom: 10 }}>
                {LOOKS.map(l => (
                  <button key={l.key} disabled={!canEdit} title={l.blurb} onClick={() => change(d => ({ ...d, look: l.key, style: { ...STYLE_DEFAULT, pace: d.style?.pace || 'normal', frame: d.style?.frame || 'none' } }))}
                    style={{ padding: 0, border: '2px solid ' + ((p.look || 'stay') === l.key ? UI.gold : UI.line), borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: UI.panel2, color: UI.ink, textAlign: 'left' }}>
                    <LookPreview proj={p} look={l.key} style={{}} assets={assets} w={100} />
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '4px 0 6px' }}>Style · fine-tune the look</p>
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
              {([['font', 'Type'], ['caps', 'Case'], ['grade', 'Photo grade'], ['pace', 'Pace'], ['finish', 'Finish'], ['frame', 'Frame'], ['logo', 'Stay logo']] as [keyof AdStyle, string][]).map(([k, lab]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, color: UI.mut, display: 'block', marginBottom: 3 }}>{lab}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(STYLE_OPTIONS[k] as { key: string; label: string }[]).map(o => <Btn key={o.key} small disabled={!canEdit} on={((p.style || STYLE_DEFAULT)[k] || STYLE_DEFAULT[k]) === o.key} onClick={() => change(d => ({ ...d, style: { ...STYLE_DEFAULT, ...(d.style || {}), [k]: o.key } }))}>{o.label}</Btn>)}
                  </div>
                </div>
              ))}
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '0 0 6px' }}>Voice{p.voiceName && !VOICES.some(v => v.id === p.voiceId) ? <span style={{ color: UI.gold }}> · using {p.voiceName}</span> : null}</p>
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
              <p style={{ fontSize: 11.5, color: UI.mut, margin: '12px 0 6px' }}>Music · {track(p.music).label}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {MUSIC.map(m => <Btn key={m.key} small on={p.music === m.key} title={m.mood} onClick={() => change(d => ({ ...d, music: m.key }))}>{m.label}</Btn>)}
                {sounds.filter(x => x.kind === 'music').slice(0, 8).map(x => <Btn key={x.key} small on={p.music === x.key} title={x.prompt} onClick={() => change(d => ({ ...d, music: x.key }))}>♪ {x.name}</Btn>)}
                <Btn small onClick={() => { setSide('sounds'); setSndKind('music'); setSndSecs(30) }}>+ Generate</Btn>
              </div>
              {p.music !== 'none' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: UI.mut, marginTop: 8 }}>
                  Level <input type="range" min={0.05} max={0.6} step={0.01} value={p.musicVol} onChange={e => change(d => ({ ...d, musicVol: Number(e.target.value) }))} style={{ flex: 1 }} />
                </label>
              ) : null}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={p.captions} onChange={e => change(d => ({ ...d, captions: e.target.checked }))} /> Burn in captions (most people watch muted)
              </label>
            </>
          ) : <p style={{ fontSize: 12, color: UI.mut, marginTop: 16 }}>Pick a scene on the timeline to edit it.</p>}
        </div>
      </div>

      {/* ── timeline ── */}
      {p && tl ? (
        <div style={{ borderTop: '1px solid ' + UI.line, padding: '10px 14px 14px', background: UI.panel }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: UI.mut }}>Timeline</span>
            <span style={{ fontSize: 11, color: UI.mut }}>Drag scenes to reorder · click to edit · click the ruler to jump</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {canEdit ? KINDS.map(k => <Btn key={k.kind} small onClick={() => addScene(k.kind)} title={'Add a ' + k.label + ' scene after this one'}>+ {k.label}</Btn>) : null}
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
            <div style={{ position: 'relative', height: 58 }}>
              {p.scenes.map((s, i) => (
                <div key={s.id} draggable={canEdit} onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom != null) move(dragFrom, i); setDragFrom(null) }}
                  onClick={() => pick(i)} title={(s.head || s.vo || KINDS.find(k => k.kind === s.kind)?.label || '').replace(/\*\*/g, '')}
                  style={{ position: 'absolute', left: pct(tl.starts[i]) + '%', width: `calc(${pct(tl.durs[i])}% - 3px)`, top: 0, bottom: 0, borderRadius: 7, cursor: 'pointer', overflow: 'hidden',
                    background: KIND_COLOR[s.kind] + (i === sel ? '' : '55'), border: '2px solid ' + (i === sel ? '#fff' : 'transparent'), padding: '4px 6px', color: i === sel ? '#111' : UI.ink }}>
                  <span style={{ display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>{i + 1} · {KINDS.find(k => k.kind === s.kind)?.label}{s.sfx ? ' · 🔊' : ''}</span>
                  <span style={{ display: 'block', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(s.head || s.vo).replace(/\*\*/g, '').replace(/\n/g, ' ')}</span>
                </div>
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
