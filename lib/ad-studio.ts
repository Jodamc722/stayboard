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
import { type AdProject, type AdContact, type AdScene, type AdKind, blankProject, spokenText, voiceSig, HOUSE_FACTS, GUEST_FACTS, KINDS, BUILTIN_VIDEOS } from '@/lib/ad-engine'

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

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string; updatedBy: string; scenes: number; format: string }[]> {
  await ensureBucket()
  const sb = supabaseAdmin()
  const { data } = await sb.storage.from(BUCKET).list('projects', { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } })
  const files = (data || []).filter(f => /\.json$/.test(f.name))
  const out = await Promise.all(files.slice(0, 60).map(async f => {
    const p = await getProject(f.name.replace(/\.json$/, ''))
    return p ? { id: p.id, name: p.name, updatedAt: p.updatedAt, updatedBy: p.updatedBy, scenes: p.scenes.length, format: p.format } : null
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
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL)
  return data?.signedUrl || null
}

const KIND_KEYS = KINDS.map(k => k.kind)
/** Never trust a saved or AI-written file blindly: every field coerced, unknown kinds become a title. */
export function normalize(p: any): AdProject {
  const scenes: AdScene[] = Array.isArray(p?.scenes) ? p.scenes.slice(0, 40).map((s: any, i: number) => ({
    id: String(s?.id || 's' + (i + 1)).slice(0, 20),
    kind: (KIND_KEYS.indexOf(s?.kind) >= 0 ? s.kind : 'title') as AdKind,
    vo: String(s?.vo || '').slice(0, 600),
    head: String(s?.head || '').slice(0, 300),
    sub: String(s?.sub || '').slice(0, 300),
    items: Array.isArray(s?.items) ? s.items.slice(0, 12).map((x: any) => String(x || '').slice(0, 160)) : [],
    photos: Array.isArray(s?.photos) ? s.photos.slice(0, 12).map((x: any) => String(x || '')).filter((x: string) => /^(https:\/\/|\/|video:)/.test(x)) : [],
    dur: s?.dur && Number(s.dur) > 0 ? Math.min(30, Number(s.dur)) : null,
  })) : []
  const c = p?.contact || {}
  return {
    id: safeId(p?.id) || Date.now().toString(36),
    name: String(p?.name || 'Untitled ad').slice(0, 120),
    prompt: String(p?.prompt || '').slice(0, 2000),
    format: (['16:9', '9:16', '1:1', '4:5'].indexOf(p?.format) >= 0 ? p.format : '16:9'),
    audience: (['owners', 'partners', 'guests'].indexOf(p?.audience) >= 0 ? p.audience : 'owners'),
    voiceId: String(p?.voiceId || 'qSeXEcewz7tA0Q0qk9fH').slice(0, 40),
    music: String(p?.music || 'werq').slice(0, 20),
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
  const key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY
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
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
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

// ───────────────────────── the script writer ─────────────────────────
export function scriptPrompt(input: { prompt: string; seconds: number; format: string; audience: string; current?: AdProject | null }): string {
  const kinds = KINDS.map(k => `- ${k.kind}: ${k.hint}`).join('\n')
  const guests = /guest/i.test(input.audience)
  const facts = guests ? GUEST_FACTS : HOUSE_FACTS
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
- A music-only beat is allowed: a scene with an empty "vo" (good for a photo wall right after the opening).

SCENE KINDS YOU CAN USE:
${kinds}

PHOTOS: for each scene that shows photos, give "photoQuery": two or three words to search our photo library, e.g. "17west pool", "elser view", "arya rooftop", "ocean view", "bedroom", "kitchen", "balcony". Leave it empty for the contact kind.

THE BRIEF: ${input.prompt || (guests ? '(none — write a guest ad that makes people want to book a South Florida stay)' : '(none — write the house sales ad for owners)')}
LENGTH: about ${input.seconds} seconds in total.
AUDIENCE: ${input.audience || 'property owners'}
FORMAT: ${input.format}${input.current && input.current.scenes.length ? `\n\nTHE CURRENT DRAFT (improve it; keep what works):\n${JSON.stringify(input.current.scenes.map(s => ({ kind: s.kind, vo: s.vo, head: s.head, sub: s.sub, items: s.items })))}` : ''}

Reply with ONLY a JSON object, no prose:
{"name": "a short name for this ad", "scenes": [{"kind": "...", "vo": "...", "head": "...", "sub": "...", "items": ["..."], "photoQuery": "..."}]}`
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
