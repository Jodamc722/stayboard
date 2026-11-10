// AD STUDIO — storage and the two AI jobs (script, voice). See lib/ad-engine.ts for the renderer.
//
// NO MIGRATION, ON PURPOSE. A project is one JSON file in a private storage bucket and a voice take
// is one MP3 beside it, the way Training keeps its videos. Ads are a handful of documents edited by
// two or three people, not rows anything else needs to join to, and it means the tab works the day it
// ships without a SQL run.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { SALES_CONTACT_KEY, type ContactCard } from '@/lib/sales-copy'
import { type AdProject, type AdContact, type AdScene, type AdKind, cleanCustom, blankProject, spokenText, voiceSig, HOUSE_FACTS, GUEST_FACTS, KINDS, BUILTIN_VIDEOS, VOICE_DEFAULTS, TRANSITIONS, type AdTransition, STYLE_DEFAULT, STYLE_OPTIONS, TEXT_ANIMS, CAMS, type AdTextAnim, type AdCam, PLATFORMS, FX } from '@/lib/ad-engine'

const BUCKET = 'ad-studio'
const SIGN_TTL = 60 * 60 * 6

async function ensureBucket(): Promise<void> {
  const sb = supabaseAdmin()
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message)
}
const safeId = (id: string) => String(id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40)

/** Nick's card by default — the presenter saved once for the sales deck, else the house values. */
/** The ElevenLabs key — under the standard name, or as it was saved in Vercel ("ElevenLabs", 2026-11-04). */
function elevenKey(): string {
  const raw = String(process.env.ELEVENLABS_API_KEY || process.env.ElevenLabs || process.env.ELEVENLABS || process.env.ELEVEN_API_KEY || '')
  // a value pasted with a label around it ("ELEVENLABS_API_KEY=sk_…", "xi-api-key: sk_…", quotes) — keep just the key
  const m = raw.match(/sk_[A-Za-z0-9]{20,}/)
  return m ? m[0] : raw.trim().replace(/^["'\s]+|["'\s]+$/g, '')
}
/** The SHAPE of the saved key, never its value — so a bad paste can be diagnosed without exposing it. */
export function elevenKeyShape(): { set: boolean; name: string; length: number; startsSk: boolean; hadExtra: boolean; spaces: boolean } {
  const name = process.env.ELEVENLABS_API_KEY ? 'ELEVENLABS_API_KEY' : process.env.ElevenLabs ? 'ElevenLabs' : process.env.ELEVENLABS ? 'ELEVENLABS' : process.env.ELEVEN_API_KEY ? 'ELEVEN_API_KEY' : ''
  const raw = String((name && process.env[name]) || ''), k = elevenKey()
  return { set: !!raw, name, length: k.length, startsSk: k.startsWith('sk_'), hadExtra: raw.length !== k.length, spaces: /\s/.test(k) }
}

export async function defaultContact(): Promise<AdContact> {
  const c = await getSetting<Partial<ContactCard>>(SALES_CONTACT_KEY, {})
  return {
    name: String(c.name || 'Nick Carline'),
    role: String(c.role || 'Business Development') + (String(c.role || '').match(/stay/i) ? '' : ' · Stay Hospitality'),
    phone: String(c.phone || '651.200.8283'),
    email: String(c.email || 'nicholas@stay-hospitality.com'),
    photo: '/ads/nick-carline.jpg',
  }
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string; updatedBy: string; scenes: number; format: string; status: string; kind: string; look: string; thumb: string; moment: string }[]> {
  await ensureBucket()
  const sb = supabaseAdmin()
  const { data } = await sb.storage.from(BUCKET).list('projects', { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } })
  const files = (data || []).filter(f => /\.json$/.test(f.name))
  const out = await Promise.all(files.slice(0, 60).map(async f => {
    const p = await getProject(f.name.replace(/\.json$/, ''))
    const thumb = p ? (p.scenes.map(x => x.photos.find(u => !u.startsWith('video:')) || '').find(Boolean) || '') : ''
    return p ? { id: p.id, name: p.name, updatedAt: p.updatedAt, updatedBy: p.updatedBy, scenes: p.scenes.length, format: p.format, status: p.status || 'draft', kind: p.kind || 'video', look: p.look || 'stay', thumb, moment: p.moment || '' } : null
  }))
  return out.filter(Boolean).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt))) as any
}

export async function getProject(id: string): Promise<AdProject | null> {
  await ensureBucket()
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`projects/${safeId(id)}.json`)
  if (error || !data) return null
  try { return normalize(JSON.parse(await data.text())) } catch { return null }
}

export async function saveProject(p: AdProject, by: string): Promise<AdProject> {
  await ensureBucket()
  const clean = normalize({ ...p, updatedAt: new Date().toISOString(), updatedBy: by })
  // VERSIONS (2026-11-03): when the scenes or the look change, the previous state is kept (last 12) so the
  // team can go back. Autosave fires often, so only a real change makes a version.
  try {
    const prev = await getProject(clean.id)
    const sig = (x: AdProject) => JSON.stringify([x.scenes.map(s => [s.kind, s.vo, s.head, s.sub, s.items, s.photos]), x.look, x.style, x.format, x.music])
    if (prev && prev.scenes.length && sig(prev) !== sig(clean)) {
      const sb = supabaseAdmin().storage.from(BUCKET)
      const ts = (prev.updatedAt || new Date().toISOString()).replace(/[:.]/g, '-')
      await sb.upload(`versions/${clean.id}/${ts}.json`, new Blob([JSON.stringify(prev)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
      const { data } = await sb.list(`versions/${clean.id}`, { limit: 100 })
      const old = (data || []).map(f => f.name).sort().slice(0, -12)
      if (old.length) await sb.remove(old.map(n => `versions/${clean.id}/${n}`))
    }
  } catch { /* versions are best effort */ }
  const body = new Blob([JSON.stringify(clean)], { type: 'application/json' })
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(`projects/${clean.id}.json`, body, { upsert: true, contentType: 'application/json' })
  if (error) throw new Error('save: ' + error.message)
  return clean
}

export async function deleteProject(id: string): Promise<void> {
  const sb = supabaseAdmin()
  const sid = safeId(id)
  const { data } = await sb.storage.from(BUCKET).list(`audio/${sid}`, { limit: 100 })
  const paths = [`projects/${sid}.json`].concat((data || []).map(f => `audio/${sid}/${f.name}`))
  await sb.storage.from(BUCKET).remove(paths)
}

export async function newProject(by: string): Promise<AdProject> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return saveProject(blankProject(id, by, await defaultContact()), by)
}

export async function signedAudio(path: string): Promise<string | null> {
  if (!path) return null
  // A bundled take (the sales videos' voice, shipped in public/ads/) is served as-is.
  if (path.startsWith('public:')) { const u = path.slice(7); return /^\/ads\/[a-z0-9\-/]+\.mp3$/i.test(u) ? u : null }
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL)
  return data?.signedUrl || null
}

const KIND_KEYS = KINDS.map(k => k.kind)
const clampN = (v: any, a: number, b: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d }
/** Never trust a saved or AI-written file blindly: every field coerced, unknown kinds become a title. */
export function normalize(p: any): AdProject {
  const scenes: AdScene[] = Array.isArray(p?.scenes) ? p.scenes.slice(0, 40).map((s: any, i: number) => ({
    id: String(s?.id || 's' + (i + 1)).slice(0, 20),
    kind: (KIND_KEYS.indexOf(s?.kind) >= 0 ? s.kind : 'title') as AdKind,
    tr: (TRANSITIONS.indexOf(s?.tr) >= 0 ? s.tr : 'auto') as AdTransition,
    anim: (TEXT_ANIMS.some(x => x.key === s?.anim) ? s.anim : 'auto') as AdTextAnim,
    cam: (CAMS.some(x => x.key === s?.cam) ? s.cam : 'auto') as AdCam,
    badge: String(s?.badge || '').slice(0, 22),
    ...(s?.eyebrow ? { eyebrow: String(s.eyebrow).slice(0, 80) } : {}),
    ...([0, 1, 2].indexOf(Number(s?.dim)) >= 0 && s?.dim !== null && s?.dim !== undefined && s?.dim !== '' ? { dim: Number(s.dim) } : {}),
    ...(cleanCustom(s?.cu) ? { cu: cleanCustom(s?.cu) } : {}),
    vo: String(s?.vo || '').slice(0, 600),
    head: String(s?.head || '').slice(0, 300),
    sub: String(s?.sub || '').slice(0, 300),
    items: Array.isArray(s?.items) ? s.items.slice(0, 12).map((x: any) => String(x || '').slice(0, 160)) : [],
    photos: Array.isArray(s?.photos) ? s.photos.slice(0, 12).map((x: any) => String(x || '')).filter((x: string) => /^(https:\/\/|\/|video:)/.test(x)) : [],
    dur: s?.dur && Number(s.dur) > 0 ? Math.min(30, Number(s.dur)) : null,
    sfx: typeof s?.sfx === 'string' && /^snd:sounds\/[a-z0-9]+\.mp3$/i.test(s.sfx) ? s.sfx : '',
    fx: Array.isArray(s?.fx) ? s.fx.filter((x: any) => FX.some(f => f.key === x)).slice(0, 6) : [],
    fxo: s?.fxo && typeof s.fxo === 'object' ? Object.fromEntries(Object.entries(s.fxo).filter(([k]) => FX.some(f => f.key === k)).map(([k, v]: [string, any]) => [k, {
      ...(typeof v?.pos === 'string' ? { pos: v.pos.slice(0, 12) } : {}),
      ...(['S', 'M', 'L'].indexOf(v?.size) >= 0 ? { size: v.size } : {}),
      ...(['low', 'med', 'high'].indexOf(v?.amt) >= 0 ? { amt: v.amt } : {}),
      ...(['slow', 'normal', 'fast'].indexOf(v?.speed) >= 0 ? { speed: v.speed } : {}),
      ...(typeof v?.color === 'string' ? { color: v.color.slice(0, 12) } : {}),
      ...(typeof v?.variant === 'string' ? { variant: v.variant.slice(0, 12) } : {}),
      ...(['on', 'off'].indexOf(v?.blink) >= 0 ? { blink: v.blink } : {}),
    }])) : undefined,
  })) : []
  const c = p?.contact || {}
  return {
    id: safeId(p?.id) || Date.now().toString(36),
    name: String(p?.name || 'Untitled ad').slice(0, 120),
    prompt: String(p?.prompt || '').slice(0, 2000),
    format: (['16:9', '9:16', '1:1', '4:5', 'letter'].indexOf(p?.format) >= 0 ? p.format : '16:9'),
    kind: (['video', 'flyer', 'post', 'story'].indexOf(p?.kind) >= 0 ? p.kind : 'video'),
    moment: typeof p?.moment === 'string' ? p.moment.slice(0, 40) : undefined,
    audience: (['owners', 'partners', 'guests'].indexOf(p?.audience) >= 0 ? p.audience : 'owners'),
    look: /^[a-z]{2,12}$/.test(String(p?.look || '')) ? String(p.look) : 'stay',
    style: (() => {
      const st: any = { ...STYLE_DEFAULT }
      const src = p?.style || {}
      ;(Object.keys(STYLE_OPTIONS) as (keyof typeof STYLE_OPTIONS)[]).forEach(k => { if ((STYLE_OPTIONS[k] as any[]).some(o => o.key === src[k])) st[k] = src[k] })
      ;(['accent', 'base', 'text'] as const).forEach(k => { st[k] = /^#[0-9a-f]{6}$/i.test(String(src[k] || '')) ? String(src[k]) : '' })
      return st
    })(),
    goal: String(p?.goal || '').slice(0, 20),
    platform: PLATFORMS.some(x => x.key === p?.platform) ? String(p.platform) : '',
    status: (['draft', 'review', 'approved'].indexOf(p?.status) >= 0 ? p.status : 'draft') as AdProject['status'],
    notes: String(p?.notes || '').slice(0, 2000),
    voiceId: String(p?.voiceId || 'qSeXEcewz7tA0Q0qk9fH').slice(0, 40),
    voiceName: String(p?.voiceName || '').slice(0, 80),
    voiceSettings: {
      stability: clampN(p?.voiceSettings?.stability, 0, 1, VOICE_DEFAULTS.stability),
      style: clampN(p?.voiceSettings?.style, 0, 1, VOICE_DEFAULTS.style),
      speed: clampN(p?.voiceSettings?.speed, 0.7, 1.2, VOICE_DEFAULTS.speed),
    },
    music: String(p?.music || 'werq').slice(0, 80),
    musicVol: Math.max(0, Math.min(1, Number(p?.musicVol ?? 0.28))),
    captions: p?.captions !== false,
    scenes,
    contact: { name: String(c.name || ''), role: String(c.role || ''), phone: String(c.phone || ''), email: String(c.email || ''), photo: String(c.photo || '') },
    voice: p?.voice && typeof p.voice.path === 'string' ? {
      path: String(p.voice.path), sig: String(p.voice.sig || ''), voiceId: String(p.voice.voiceId || ''),
      starts: Array.isArray(p.voice.starts) ? p.voice.starts.map((x: any) => (x == null ? null : Number(x))) : [],
      ends: Array.isArray(p.voice.ends) ? p.voice.ends.map((x: any) => (x == null ? null : Number(x))) : [],
      dur: Number(p.voice.dur || 0),
    } : null,
    createdAt: String(p?.createdAt || new Date().toISOString()),
    updatedAt: String(p?.updatedAt || new Date().toISOString()),
    updatedBy: String(p?.updatedBy || ''),
  }
}

// ───────────────────────── voice: one continuous take, cut to the words ─────────────────────────
export async function makeVoice(p: AdProject): Promise<{ ok: true; project: AdProject } | { ok: false; error: string; status?: number }> {
  const key = elevenKey()
  if (!key) return { ok: false, status: 503, error: 'The voice needs an ElevenLabs key. Add ELEVENLABS_API_KEY in Vercel → Settings → Environment Variables, then redeploy.' }
  if (!p.scenes.some(s => s.vo.trim())) return { ok: false, status: 400, error: 'No scene has a voice line yet.' }
  // Build the take: each scene's spoken text, with a pause between lines and a longer one for a
  // music-only beat. Track where every scene's text sits, so the alignment can be read back per scene.
  let text = ''
  const spans: { at: number; len: number }[] = []
  for (let i = 0; i < p.scenes.length; i++) {
    const v = spokenText(p.scenes[i].vo.trim())
    if (!v) { text += ' <break time="2.2s" /> '; spans.push({ at: -1, len: 0 }); continue }
    if (text) text += ' <break time="0.8s" /> '
    spans.push({ at: text.length, len: v.length })
    text += v
  }
  if (text.length > 4500) return { ok: false, status: 400, error: 'The script is too long for one take (about 4,500 characters). Trim a few lines.' }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(p.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: p.voiceSettings.stability, similarity_boost: 0.8, style: p.voiceSettings.style, use_speaker_boost: true, speed: p.voiceSettings.speed } }),
  })
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300)
    return { ok: false, status: 502, error: r.status === 401 ? 'ElevenLabs refused the key (' + t + ')' : r.status === 402 ? 'ElevenLabs says the plan is out of credits or this voice needs a paid plan.' : 'ElevenLabs said ' + r.status + ': ' + t }
  }
  const j: any = await r.json()
  const al = j.alignment || j.normalized_alignment
  if (!al || !Array.isArray(al.character_start_times_seconds)) return { ok: false, status: 502, error: 'ElevenLabs returned no timing.' }
  const st: number[] = al.character_start_times_seconds, en: number[] = al.character_end_times_seconds
  // The alignment is per character of the text we sent; if the service normalized the text the
  // lengths differ, so scale positions rather than trusting them blindly.
  const k = (al.characters?.length || st.length) / text.length
  const at = (pos: number) => Math.max(0, Math.min(st.length - 1, Math.round(pos * k)))
  const starts: (number | null)[] = [], ends: (number | null)[] = []
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].at < 0) { starts.push(null); ends.push(null); continue }
    starts.push(Number(st[at(spans[i].at)] || 0))
    ends.push(Number(en[at(spans[i].at + spans[i].len - 1)] || 0))
  }
  const audio = Buffer.from(String(j.audio_base64 || ''), 'base64')
  if (audio.length < 2000) return { ok: false, status: 502, error: 'ElevenLabs returned an empty take.' }
  await ensureBucket()
  const sig = voiceSig(p)
  const path = `audio/${p.id}/${sig.replace(/[^a-z0-9]/gi, '')}-${Date.now().toString(36)}.mp3`
  const up = await supabaseAdmin().storage.from(BUCKET).upload(path, audio, { contentType: 'audio/mpeg', upsert: true })
  if (up.error) return { ok: false, status: 500, error: 'save audio: ' + up.error.message }
  const dur = Math.max(...ends.filter((x): x is number => x != null), 0) + 0.3
  return { ok: true, project: { ...p, voice: { path, sig, voiceId: p.voiceId, starts, ends, dur } } }
}

// ───────────────────────── the properties we manage ─────────────────────────
// Every prompt gets the real list from the photo library, so the writer names real places and the
// reviewer never calls a real property "invented" (it did, for 17WEST, 2026-11-03).
let propsCache: { at: number; text: string } | null = null
export async function propertiesLine(): Promise<string> {
  if (propsCache && Date.now() - propsCache.at < 10 * 60 * 1000) return propsCache.text
  try {
    const { libraryIndex } = await import('@/lib/photo-library')
    const idx = await libraryIndex()
    const text = idx.buildings.filter(b => b.photos > 0).map(b => `${b.name} (${b.market}${b.units.length > 1 ? ', ' + b.units.length + ' units' : ''})`).join('; ')
    propsCache = { at: Date.now(), text }
    return text
  } catch { return propsCache?.text || '' }
}
const withProps = (facts: string, props?: string) => props ? facts + `\nPROPERTIES WE MANAGE (real names — use them as given): ${props}` : facts

// ───────────────────────── the script writer ─────────────────────────
export function scriptPrompt(input: { prompt: string; seconds: number; format: string; audience: string; current?: AdProject | null; props?: string }): string {
  const kinds = KINDS.map(k => `- ${k.kind}: ${k.hint}`).join('\n')
  const guests = /guest/i.test(input.audience)
  const facts = withProps(guests ? GUEST_FACTS : HOUSE_FACTS, input.props)
  const rules = guests ? `HOUSE STYLE FOR GUEST ADS:
- Warm, visual, inviting — sell the stay and the place, not the company. Short lines.
- Never promise a price, discount, "best rate", free night or availability. No phone number, never "call us" or "text us".
- End on a "cta" scene whose first row is "Book at stay-hospitality.com" (a second row may carry "Rated 4.6 out of 5 by our guests").
- Do NOT use the "contact" kind (that is the owner sales card) and do not mention fees, owners, revenue, Lighthouse or channels.` : `HOUSE STYLE (Jon's standing rules):
- Tight, professional, warm. One short spoken line per scene. Plain words, no hype, no em dashes.
- Say "listings", not "homes", for the portfolio count. Say "40+ channels".
- Results: "owners who switch to Stay earn more" — no number. The fee is "lower" — no number.
- Lighthouse spots issues and automates work; it does not produce the owner report.
- End on a contact scene (kind "contact") whose line asks them to book a call with Nick and reads his number 651-200-8283.`
  return `You write short video ads for Stay Hospitality and lay them out as scenes for an ad editor. They run on Instagram, Facebook and the web.

THE FACTS YOU MAY USE (never invent others — no new numbers, percentages, fees, prices, timelines or guarantees):
${facts}

${rules}
- Every scene's spoken line ("vo") must be readable aloud in the time the scene holds: about 2.5 words a second. Open strong — the first two seconds decide whether anyone keeps watching.
- NEVER put the words "Salato" or "Pompano Beach" in a spoken line (the voice mispronounces them). They may appear on screen.
- On-screen headlines ("head") are short (2 to 8 words). Mark one or two key words gold with **double stars**. Use \\n to break lines.
- A music-only beat is allowed: a scene with an empty "vo" (good for a montage right after the opening).

CREATIVE DIRECTION (Jon: "better, nicer and very creative" — and "never use a collage photo ever"):
- Make it feel like a premium travel/brand film, not slides. Vary the scene kinds; never use the same kind twice in a row.
- Open with motion: a "cinema" or "kinetic" scene. Use "kinetic" for punchy 2 to 6 word hooks, "cinema" for mood and place, "reveal" for a hero shot, "wall" (montage, quick full-screen cuts) for energy, "cards" (three beats) for three selling points.
- One image on screen at a time. NEVER a grid, collage or side-by-side photos.
- THE HOOK: scene 1 must stop the thumb in 1.5 seconds — a headline of 2 to 5 words that is a benefit, a feeling or the place ("Wake up on the water", "Miami, from the pool"), on the strongest photo. Never "Welcome to…" or the company name as the opener.
- ONE idea per ad. Say the property's name (guest ads) or "Stay Hospitality" (owner ads) by scene 2 and again on the last scene. Every scene earns its place; cut anything that is just a label.
- The last scene holds the call to action long enough to read: give it the most words of "vo" or leave it as the end card.
- Transitions, headline animation and camera moves are chosen by the editor to suit the look — do not set them.
- Optionally ONE short "badge" sticker in the whole ad (2 or 3 words that are true, e.g. "Oceanfront", "Book direct") — never a price or a claim we cannot prove.
- Every scene's words and its photo must agree: if the line is about the pool, the photoQuery asks for the pool ("<property> pool"); about a bedroom, the bedroom. Each scene should show a different thing — don't repeat a subject.
- "callouts" rows are amenities the PLACE has that the photo can stand for; keep them short (1 to 3 words).
- Use the newer designs when they fit: "mask" (giant word filled with the photo), "panel" (photo + colour panel), "ticker" (marquee band), "callouts" (labels on one photo), "polaroid" (instant photo), "event" (date block for an event/season — only with a real date from the brief).
- Write "vo" as normal text: numbers as digits (651-200-8283), the website as stay-hospitality.com — the voice handles pronunciation. Use only the numbers in the facts (or in the brief); never round, change or invent one.
- Headlines are copywriting, not labels: sensory, specific, short. Write them in sentence case (not Title Case). Gold (**…**) the one word that carries the idea — never a filler word like "The", "Your" or "Book". Use the "sub" for a place line (e.g. "Singer Island · Florida") on cinematic scenes.
- Prefer photos with a single strong subject: the view, the pool at golden hour, a styled bedroom. Ask for them with specific photoQuery words.

SCENE KINDS YOU CAN USE:
${kinds}

PHOTOS: for each scene that shows photos, give "photoQuery": two or three words to search our photo library, e.g. "17west pool", "elser view", "arya rooftop", "ocean view", "bedroom", "kitchen", "balcony". Leave it empty for the contact kind.

THE BRIEF: ${input.prompt || (guests ? '(none — write a guest ad that makes people want to book a South Florida stay)' : '(none — write the house sales ad for owners)')}
LENGTH: about ${input.seconds} seconds in total.
AUDIENCE: ${input.audience || 'property owners'}
FORMAT: ${input.format}${input.current && input.current.scenes.length ? `\n\nTHE CURRENT DRAFT (improve it; keep what works):\n${JSON.stringify(input.current.scenes.map(s => ({ kind: s.kind, vo: s.vo, head: s.head, sub: s.sub, items: s.items })))}` : ''}

Reply with ONLY a JSON object, no prose:
{"name": "a short name for this ad", "scenes": [{"kind": "...", "badge": "", "vo": "...", "head": "...", "sub": "...", "items": ["..."], "photoQuery": "..."}]}`
}


// ───────────────────────── the video library ─────────────────────────
// Jon, 2026-11-02: "add my video library … the ones we created for sales". The sales cuts ship with
// the app (BUILTIN_VIDEOS, public/ads/library); anything exported here or uploaded is kept in the
// bucket under library/<id>.(mp4|webm) with a .json beside it (name, length, format, thumbnail).
export type LibVideo = { key: string; name: string; url: string; thumb: string; dur: number; format: string; builtin: boolean; createdAt: string; by: string; path?: string }

export async function listLibrary(): Promise<LibVideo[]> {
  await ensureBucket()
  const sb = supabaseAdmin()
  const { data } = await sb.storage.from(BUCKET).list('library', { limit: 300, sortBy: { column: 'created_at', order: 'desc' } })
  const metas = (data || []).filter(f => /\.json$/.test(f.name))
  const rows = await Promise.all(metas.map(async f => {
    const { data: b } = await sb.storage.from(BUCKET).download('library/' + f.name)
    if (!b) return null
    try { return JSON.parse(await b.text()) } catch { return null }
  }))
  const real = rows.filter(Boolean) as any[]
  const paths: string[] = []
  real.forEach(r => { if (r.path) paths.push(r.path); if (r.thumbPath) paths.push(r.thumbPath) })
  const signed: Record<string, string> = {}
  if (paths.length) {
    const { data: s } = await sb.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL)
    ;(s || []).forEach((x: any) => { if (x?.path && x?.signedUrl) signed[x.path] = x.signedUrl })
  }
  const mine: LibVideo[] = real.map(r => ({ key: 'lib:' + r.path, name: String(r.name || 'Video'), url: signed[r.path] || '', thumb: r.thumbPath ? signed[r.thumbPath] || '' : '', dur: Number(r.dur || 0), format: String(r.format || ''), builtin: false, createdAt: String(r.createdAt || ''), by: String(r.by || ''), path: r.path }))
  const built: LibVideo[] = BUILTIN_VIDEOS.map(v => ({ key: v.key, name: v.name, url: v.file, thumb: v.thumb, dur: v.dur, format: v.format, builtin: true, createdAt: '2026-11-02', by: 'Sales videos' }))
  return mine.concat(built)
}

/** A signed upload the browser PUTs the file to directly (a video is past what a route may carry). */
export async function signLibraryUpload(ext: string): Promise<{ path: string; thumbPath: string; signedUrl: string; thumbUrl: string }> {
  await ensureBucket()
  const e = /^(mp4|webm|mov|m4v)$/i.test(ext) ? ext.toLowerCase() : 'mp4'
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const path = `library/${id}.${e}`, thumbPath = `library/${id}.jpg`
  const sb = supabaseAdmin().storage.from(BUCKET)
  const a = await sb.createSignedUploadUrl(path)
  const b = await sb.createSignedUploadUrl(thumbPath)
  if (a.error || !a.data || b.error || !b.data) throw new Error('signed upload: ' + (a.error?.message || b.error?.message || 'no url'))
  return { path, thumbPath, signedUrl: a.data.signedUrl, thumbUrl: b.data.signedUrl }
}
export async function saveLibraryMeta(m: { path: string; thumbPath?: string; name: string; dur: number; format: string }, by: string): Promise<void> {
  if (!/^library\/[a-z0-9]+\.(mp4|webm|mov|m4v)$/i.test(m.path)) throw new Error('bad path')
  const meta = { path: m.path, thumbPath: m.thumbPath && /^library\/[a-z0-9]+\.jpg$/i.test(m.thumbPath) ? m.thumbPath : '', name: String(m.name || 'Video').slice(0, 140), dur: Number(m.dur || 0), format: String(m.format || '').slice(0, 8), createdAt: new Date().toISOString(), by }
  const body = new Blob([JSON.stringify(meta)], { type: 'application/json' })
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(m.path.replace(/\.[a-z0-9]+$/i, '.json'), body, { upsert: true, contentType: 'application/json' })
  if (error) throw new Error('save: ' + error.message)
}
export async function deleteLibraryItem(path: string): Promise<void> {
  if (!/^library\/[a-z0-9]+\.(mp4|webm|mov|m4v)$/i.test(path)) throw new Error('bad path')
  const base = path.replace(/\.[a-z0-9]+$/i, '')
  await supabaseAdmin().storage.from(BUCKET).remove([path, base + '.json', base + '.jpg'])
}


// ───────────────────────── sounds: ElevenLabs music + sound effects ─────────────────────────
// Jon, 2026-11-02: "add music, create a playlist of sounds, use Eleven studios". Generated tracks and
// effects are kept in the bucket under sounds/<id>.mp3 with a .json beside it, and appear in the
// Sounds tab for every ad. The bundled royalty-free tracks are MUSIC in lib/ad-engine.
export type Sound = { key: string; name: string; kind: 'music' | 'sfx'; url: string; dur: number; prompt: string; createdAt: string; by: string; path: string }


export async function listSounds(): Promise<Sound[]> {
  await ensureBucket()
  const sb = supabaseAdmin()
  const { data } = await sb.storage.from(BUCKET).list('sounds', { limit: 300, sortBy: { column: 'created_at', order: 'desc' } })
  const metas = (data || []).filter(f => /\.json$/.test(f.name))
  const rows = (await Promise.all(metas.map(async f => {
    const { data: b } = await sb.storage.from(BUCKET).download('sounds/' + f.name)
    if (!b) return null
    try { return JSON.parse(await b.text()) } catch { return null }
  }))).filter(Boolean) as any[]
  const signed: Record<string, string> = {}
  if (rows.length) {
    const { data: s } = await sb.storage.from(BUCKET).createSignedUrls(rows.map(r => r.path), SIGN_TTL)
    ;(s || []).forEach((x: any) => { if (x?.path && x?.signedUrl) signed[x.path] = x.signedUrl })
  }
  return rows.map(r => ({ key: 'snd:' + r.path, name: String(r.name || 'Sound'), kind: (r.kind === 'sfx' ? 'sfx' : 'music') as Sound['kind'], url: signed[r.path] || '', dur: Number(r.dur || 0), prompt: String(r.prompt || ''), createdAt: String(r.createdAt || ''), by: String(r.by || ''), path: String(r.path) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function generateSound(kind: 'music' | 'sfx', prompt: string, seconds: number, name: string, by: string): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const key = elevenKey()
  if (!key) return { ok: false, status: 503, error: 'Sounds need an ElevenLabs key. Add ELEVENLABS_API_KEY in Vercel, then redeploy.' }
  const pr = String(prompt || '').trim().slice(0, 600)
  if (!pr) return { ok: false, status: 400, error: 'Describe the sound first.' }
  const r = kind === 'music'
    ? await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: pr + (/vocal|sing|lyric/i.test(pr) ? '' : ' Instrumental, no vocals.'), music_length_ms: Math.round(Math.max(10, Math.min(180, seconds || 60)) * 1000) }) })
    : await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: pr, duration_seconds: Math.max(0.5, Math.min(22, seconds || 2)), prompt_influence: 0.5 }) })
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300)
    return { ok: false, status: 502, error: /missing_permissions|permission/i.test(t) ? `The ElevenLabs key is missing the "${kind === 'music' ? 'Music generation' : 'Sound effects'}" permission — tick it on the key at elevenlabs.io → API keys.` : r.status === 402 ? 'ElevenLabs is out of credits for this.' : 'ElevenLabs said ' + r.status + ': ' + t }
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 1000) return { ok: false, status: 502, error: 'ElevenLabs returned an empty sound.' }
  await ensureBucket()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const path = `sounds/${id}.mp3`
  const sb = supabaseAdmin().storage.from(BUCKET)
  const up = await sb.upload(path, buf, { contentType: 'audio/mpeg', upsert: true })
  if (up.error) return { ok: false, status: 500, error: 'save: ' + up.error.message }
  const meta = { path, kind, name: String(name || pr).slice(0, 80), prompt: pr, dur: kind === 'music' ? Math.max(10, Math.min(180, seconds || 60)) : Math.max(0.5, Math.min(22, seconds || 2)), createdAt: new Date().toISOString(), by }
  await sb.upload(`sounds/${id}.json`, new Blob([JSON.stringify(meta)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
  return { ok: true }
}
export async function deleteSound(path: string): Promise<void> {
  if (!/^sounds\/[a-z0-9]+\.mp3$/i.test(path)) throw new Error('bad path')
  await supabaseAdmin().storage.from(BUCKET).remove([path, path.replace(/\.mp3$/, '.json')])
}

/** The ElevenLabs voice library, searched — name, accent, style and a free preview clip. */
export async function searchVoices(q: string, gender: string): Promise<{ id: string; name: string; blurb: string; preview: string }[]> {
  const key = elevenKey()
  if (!key) throw new Error('Voices need an ElevenLabs key. Add ELEVENLABS_API_KEY in Vercel, then redeploy.')
  const qs = new URLSearchParams({ page_size: '24', sort: 'usage_character_count_1y', language: 'en' })
  if (q) qs.set('search', q)
  if (gender === 'female' || gender === 'male') qs.set('gender', gender)
  const r = await fetch('https://api.elevenlabs.io/v1/shared-voices?' + qs.toString(), { headers: { 'xi-api-key': key } })
  if (!r.ok) throw new Error('ElevenLabs said ' + r.status + ': ' + (await r.text()).slice(0, 200))
  const j: any = await r.json()
  return (j.voices || []).map((v: any) => ({
    id: String(v.voice_id), name: String(v.name || '').replace(/\s*[-–].*$/, '').slice(0, 40) || 'Voice',
    blurb: [v.descriptive, v.accent, v.age, v.use_case].filter(Boolean).join(' · ').replace(/_/g, ' ').slice(0, 90) || String(v.description || '').slice(0, 90),
    preview: String(v.preview_url || ''),
  }))
}

/** Rewrite ONE scene the way the person asks ("make it punchier", "show the rooftop", "turn this into numbers"). */
export function scenePrompt(p: AdProject, index: number, ask: string, props?: string): string {
  const guests = p.audience === 'guests'
  const sc = p.scenes[index]
  const kinds = KINDS.map(k => `- ${k.kind}: ${k.hint}`).join('\n')
  return `You edit one scene of a short video ad for Stay Hospitality. Change ONLY what the request asks; keep everything else as it is.

FACTS YOU MAY USE (never invent numbers, prices, fees or promises):
${withProps(guests ? GUEST_FACTS : HOUSE_FACTS, props)}

RULES: one short spoken line ("vo", about 2.5 words a second), a short on-screen headline ("head", **gold** one or two words, \\n for a new line). Never put "Salato" or "Pompano Beach" in "vo". ${guests ? 'Guest ad: no prices, no "call us"; a closing scene is kind "cta" with row 1 "Book at stay-hospitality.com".' : 'Owner ad: "listings" not "homes", "40+ channels", no fee or revenue numbers; Lighthouse does not do the owner report.'}

SCENE KINDS:
${kinds}

THE WHOLE AD, FOR CONTEXT (scene ${index + 1} is the one to change):
${p.scenes.map((s, i) => `${i + 1}. [${s.kind}] vo: ${s.vo} | head: ${s.head}`).join('\n')}

THE SCENE NOW: ${JSON.stringify({ kind: sc.kind, vo: sc.vo, head: sc.head, sub: sc.sub, items: sc.items })}

THE REQUEST: ${ask}

If the request asks for different photos, give "photoQuery" (two or three words to search our photo library, e.g. "17west pool", "ocean view", "rooftop"); otherwise leave "photoQuery" empty and the photos stay.
One image on screen at a time — never a grid or collage. Scene kinds can be changed if the request wants a different feel.
Reply with ONLY JSON: {"kind": "...", "badge": "", "vo": "...", "head": "...", "sub": "...", "items": ["..."], "photoQuery": ""}`
}


/** Step one of "Write the ad": read the brief, sharpen it, and ask only what would change the ad.
 *  Jon, 2026-11-02: "when generating, first confirm the details before creating a video — if I say
 *  make a cool video for Amrit, it should first work through what you want … and optimise the request." */
export function planPrompt(input: { brief: string; seconds: number; format: string; audience: string; properties: string; photosOf: string }): string {
  const guests = /guest/i.test(input.audience)
  return `You are the creative lead on Stay Hospitality's ad team. Someone typed a quick brief for a short video ad. Before anything is made, turn it into a sharp creative plan and ask ONLY the questions whose answers would change the ad.

FACTS WE MAY USE (never invent numbers, prices, fees, awards or promises):
${guests ? GUEST_FACTS : HOUSE_FACTS}

PROPERTIES WE MANAGE (name · market · units · photos in the library):
${input.properties}
${input.photosOf ? `\nWHAT OUR PHOTOS OF THE NAMED PROPERTY SHOW (captions):\n${input.photosOf}\n` : ''}
CURRENT SETTINGS: audience ${input.audience}, format ${input.format}, about ${input.seconds} seconds.

THE BRIEF, AS TYPED: ${input.brief || '(empty)'}

Work it through like a pro:
- Name the property exactly as it appears in the list above if the brief points at one (spelling may be loose). If none matches, say so in "warnings".
- Decide who it is for (owners, partners or guests) — a brief about a property's vibe is usually a GUEST ad; about management, revenue or "why Stay" it is an OWNER ad. Pick the platform shape (16:9 web/YouTube, 9:16 Reels/Stories/TikTok, 1:1 or 4:5 feed) and length that fit.
- Pick ONE angle (the single idea the ad sells) and a hook for the first two seconds, using what the photos actually show.
- Then ask 2 to 4 multiple-choice questions, only where a reasonable person could want it differently (e.g. who it is for, where it runs, the angle, the ending, the mood). Each has 2 to 4 short options; put your recommendation FIRST. Do not ask what the brief already says clearly. Do not ask about facts we do not have.
- Outline the scenes you would build (one line each: the look and what is said/shown), 4 to 8 scenes, ending the way the house rules require (guest ads: "Book at stay-hospitality.com", no prices; owner/partner ads: book a call with Nick).
- Suggest the mood of music: one of werq (upbeat groove), backbay (lounge, upscale), moonlight (island, easy), inspired (uplifting piano), wallpaper (light, bright), funkorama (funky).

Reply with ONLY JSON:
{"name": "short ad name", "property": "exact property name or empty", "brief": "the sharpened brief, 2 to 4 sentences, written as instructions to the writer", "settings": {"audience": "owners|partners|guests", "format": "16:9|9:16|1:1|4:5", "seconds": 15|30|45|60|90, "music": "werq|backbay|moonlight|inspired|wallpaper|funkorama"}, "angle": "one sentence", "hook": "the first line on screen", "questions": [{"id": "q1", "q": "question", "options": ["recommended", "other", "other"]}], "outline": ["1. Title — ...", "2. ..."], "warnings": ["anything missing or risky, e.g. few photos of that property"]}`
}


export async function listVersions(id: string): Promise<{ ts: string; name: string; scenes: number; by: string; look: string }[]> {
  const sb = supabaseAdmin().storage.from(BUCKET)
  const { data } = await sb.list(`versions/${safeId(id)}`, { limit: 100 })
  const names = (data || []).map(f => f.name).filter(n => /\.json$/.test(n)).sort().reverse()
  const out = await Promise.all(names.map(async n => {
    const { data: b } = await sb.download(`versions/${safeId(id)}/${n}`)
    if (!b) return null
    try { const p = JSON.parse(await b.text()); return { ts: String(p.updatedAt || n), name: String(p.name || ''), scenes: (p.scenes || []).length, by: String(p.updatedBy || ''), look: String(p.look || 'stay') } } catch { return null }
  }))
  return out.filter(Boolean) as any
}
export async function restoreVersion(id: string, ts: string, by: string): Promise<AdProject | null> {
  const sb = supabaseAdmin().storage.from(BUCKET)
  const { data } = await sb.list(`versions/${safeId(id)}`, { limit: 100 })
  const n = (data || []).map(f => f.name).find(f => f.startsWith(ts.replace(/[:.]/g, '-')))
  if (!n) return null
  const { data: b } = await sb.download(`versions/${safeId(id)}/${n}`)
  if (!b) return null
  const old = normalize(JSON.parse(await b.text()))
  return saveProject({ ...old, id: safeId(id), voice: null }, by)
}

/** The expert review on top of auditAd: a score, what works, and concrete rewrites per scene. */
export function auditPrompt(p: AdProject, issues: { sev: string; scene?: number; msg: string }[], seconds: number, props?: string): string {
  const guests = p.audience === 'guests'
  return `You are a senior creative director reviewing a short ${guests ? 'guest' : 'owner'} video ad for Stay Hospitality before it ships. Be specific and useful — the team will click "apply" on your fixes.

FACTS (never invent numbers, prices, fees or promises):
${withProps(guests ? GUEST_FACTS : HOUSE_FACTS, props)}
A property name from that list is a real place, never "invented". Amenities shown in a property's photos are real for that property; the "many / not every stay" caution applies only to portfolio-wide claims.

HOUSE RULES: ${guests ? 'no prices, no "call us"; ends on Book at stay-hospitality.com.' : '"listings" not "homes", "40+ channels", no fee or revenue numbers, ends on a call with Nick.'} Never "Salato" or "Pompano Beach" in a spoken line. Headlines in sentence case, 2 to 8 words, the key word marked **like this**. The hook (scene 1) must work in 1.5 seconds with the sound off.

THE AD (${p.format}, about ${seconds.toFixed(0)} s, look "${p.look || 'stay'}"):
${p.scenes.map((s, i) => `${i + 1}. [${s.kind}] head: ${JSON.stringify(s.head)} | sub: ${JSON.stringify(s.sub)} | vo: ${JSON.stringify(s.vo)}${s.items.length ? ' | rows: ' + JSON.stringify(s.items) : ''}${s.badge ? ' | badge: ' + s.badge : ''}`).join('\n')}

AUTOMATED CHECKS ALREADY FLAGGED (do not repeat them; go deeper):
${issues.length ? issues.map(i => `- ${i.sev}${i.scene != null ? ' scene ' + (i.scene + 1) : ''}: ${i.msg}`).join('\n') : '- none'}

Judge it like a paid-social expert: hook strength, one clear idea, rhythm, copy craft (specific and sensory, not generic), the call to action, whether the photos the words ask for exist in a rental (we only have photos of the property), and whether every scene earns its place. Then give up to 6 improvements, each with a concrete patch (new head / vo / sub / items / kind / badge for ONE scene, or "delete": true for a scene that adds nothing). Keep what already works.

Reply with ONLY JSON:
{"score": 0-100, "verdict": "one sentence", "strengths": ["...", "..."], "issues": [{"scene": 1, "problem": "...", "fix": "what to change and why", "patch": {"head": "...", "vo": "...", "sub": "...", "items": ["..."], "kind": "...", "badge": "...", "delete": false}}]}`
}
