// BUILD A SLIDE FROM A PROMPT (Jon, 2026-10-06: "create a way to add a slide where I can prompt it and
// give it details and add photos as well and it arranges it on the owner reports or onboarding —
// custom slides").
//
// POST { reportId, prompt, details?, photos?: string[], deck?: 'review' | 'onboarding', current? }
//   -> { ok, slide } where slide is a `kind: 'composed'` custom section the deck renders in one of six
//      layouts. The model SEES the photos (downscaled), so it can put the strongest one first and
//      caption each; it chooses the layout from what it was given:
//        feature  one strong photo beside a headline, a short paragraph and up to 4 bullets
//        gallery  the photos are the story (3+): a hero plus the rest, each captioned
//        stats    2–4 figures the team supplied, with a line of context (photo optional)
//        list     5–8 points (a plan, a checklist, what's included), photo optional
//        quote    one guest/owner line worth a page of its own
//        text     words only
// It writes ONLY from what the team gave it — a number that is not in the prompt or details is never
// invented — in the owner-report voice. Nothing is saved here: the client inserts the slide and the
// team saves the report as usual. `current` (an existing composed slide) lets "Rebuild" revise it.
import { NextRequest, NextResponse } from 'next/server'
import { hasEditCookie } from '@/lib/edit-access'
import { modelFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VISION_MODEL = 'claude-sonnet-4-6'
const LAYOUTS = ['feature', 'gallery', 'stats', 'list', 'quote', 'text'] as const
type Layout = typeof LAYOUTS[number]

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function anthropic(payload: any): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await aiFetch('reports', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    return Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { return null }
}
function parseJson(text: string | null): any | null {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** A photo as a small JPEG the model can look at (phone photos are 4–12 MB). */
async function imageBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 25 * 1024 * 1024) return null
    const sharp = (await import('sharp')).default
    const small = await sharp(buf).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } }
  } catch { return null }
}

const clip = (s: any, n: number) => str(s).replace(/\s+/g, ' ').trim().slice(0, n)

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok && !hasEditCookie()) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const prompt = str(body?.prompt).slice(0, 2000).trim()
  const details = str(body?.details).slice(0, 6000).trim()
  const deck = body?.deck === 'onboarding' ? 'onboarding' : 'review'
  const photos: string[] = (Array.isArray(body?.photos) ? body.photos : []).filter((u: any) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 8)
  const current = body?.current && typeof body.current === 'object' ? body.current : null
  if (!prompt && !details && !photos.length) return NextResponse.json({ error: 'Say what the slide is about, add details, or add photos.' }, { status: 400 })

  const blocks: any[] = []
  for (let i = 0; i < photos.length; i++) {
    const b = await imageBlock(photos[i])
    if (b) { blocks.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' }); blocks.push(b) }
  }

  const sys = 'You design ONE slide for a Stay Hospitality ' + (deck === 'onboarding' ? 'owner onboarding presentation (a new owner deciding to hand their property to us)' : 'owner performance review (an existing owner reading how their property did)') + '. '
    + 'Stay Hospitality is a short-term-rental operator in South Florida. Voice: confident, warm, specific, zero fluff; short declarative sentences; no exclamation marks; no emojis. '
    + 'Never admit fault or liability, never mention pests, security incidents or disputes, never disparage a guest. '
    + 'USE ONLY FACTS THE TEAM GAVE YOU. Never invent a number, a date, a price, a name or a result; if a figure is not in the prompt or details, it does not appear. '
    + 'Return STRICT JSON only, no markdown.'
  const text = [
    current ? 'The slide as it stands (revise it per the instruction, keep what still fits):\n' + JSON.stringify({ layout: current.layout, eyebrow: current.eyebrow, title: current.title, body: current.body, bullets: current.bullets, stats: current.stats, quote: current.quote, by: current.by, caps: current.caps }) : '',
    'What the slide should do: ' + (prompt || '(not stated — infer from the details and photos)'),
    details ? 'Details from the team (the only facts you may use):\n' + details : '',
    photos.length ? photos.length + ' photo(s) are attached above, numbered in upload order.' : 'No photos.',
    'Choose the layout that fits what you were given:',
    '- "feature": 1–2 photos and a message — one strong photo beside a headline, a short paragraph, up to 4 bullets.',
    '- "gallery": 3+ photos where the pictures ARE the story (a renovation, the property, work completed).',
    '- "stats": 2–4 figures the team supplied, each with a short label.',
    '- "list": 5–8 points (a plan, what is included, next steps).',
    '- "quote": one guest or owner line worth a page of its own (only if the team gave the quote).',
    '- "text": words only, no photos.',
    'Return JSON: {"layout": one of ' + LAYOUTS.map(l => '"' + l + '"').join('|') + ', "eyebrow": 1–3 word section label in Title Case, "title": headline of at most 9 words, '
      + '"body": 1–3 short sentences (at most 60 words), "bullets": [0–8 short phrases, at most 10 words each], "stats": [{"value": exactly as given e.g. "$4,860" or "94%", "label": 2–5 words}] (only figures the team gave), '
      + '"quote": the quote text if layout is quote else "", "by": who said it if given else "", '
      + '"order": [photo numbers 1..' + Math.max(1, photos.length) + ' best first — every photo exactly once], "caps": [one caption per photo IN THE NEW ORDER, at most 8 words, describing what is actually visible; "" if nothing useful to say]}',
  ].filter(Boolean).join('\n\n')

  const out = await anthropic({
    model: blocks.length ? VISION_MODEL : await modelFor('reports'),
    max_tokens: 1500,
    system: sys,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
  })
  const j = parseJson(out)
  if (!j) return NextResponse.json({ error: 'Could not build that slide — try saying what it should show in one line.' }, { status: 422 })

  // Clean and bound everything the model returned; photos keep their URLs, reordered as it chose.
  let layout: Layout = (LAYOUTS as readonly string[]).includes(str(j.layout)) ? j.layout : (photos.length >= 3 ? 'gallery' : photos.length ? 'feature' : 'text')
  const order: number[] = Array.isArray(j.order) ? j.order.map((n: any) => Number(n) - 1).filter((n: number) => Number.isInteger(n) && n >= 0 && n < photos.length) : []
  const seen = new Set<number>(); const ord: number[] = []
  for (const n of order) if (!seen.has(n)) { seen.add(n); ord.push(n) }
  for (let i = 0; i < photos.length; i++) if (!seen.has(i)) ord.push(i)
  const capsIn: string[] = Array.isArray(j.caps) ? j.caps.map((c: any) => clip(c, 80)) : []
  const stats = (Array.isArray(j.stats) ? j.stats : []).slice(0, 4).map((s: any) => ({ value: clip(s?.value, 16), label: clip(s?.label, 40) })).filter((s: any) => s.value)
  // A figure the team never typed is dropped — the model may not invent one.
  const given = (prompt + ' ' + details).replace(/,/g, '')
  const statsOk = stats.filter((s: any) => { const n = s.value.replace(/[^\d.]/g, ''); return !n || given.indexOf(n) >= 0 })
  if (layout === 'stats' && statsOk.length < 2) layout = photos.length ? 'feature' : 'text'
  if (layout === 'quote' && !clip(j.quote, 400)) layout = photos.length ? 'feature' : 'text'
  if (layout === 'gallery' && photos.length < 2) layout = photos.length ? 'feature' : 'text'

  const slide = {
    kind: 'composed',
    layout,
    eyebrow: clip(j.eyebrow, 40),
    title: clip(j.title, 90) || 'New slide',
    body: clip(j.body, 480),
    bullets: (Array.isArray(j.bullets) ? j.bullets : []).map((b: any) => clip(b, 90)).filter(Boolean).slice(0, 8),
    stats: statsOk,
    quote: clip(j.quote, 400),
    by: clip(j.by, 60),
    photos: ord.map(i => photos[i]),
    caps: ord.map((_, k) => capsIn[k] || ''),
    prompt, details,
  }
  return NextResponse.json({ ok: true, slide })
}
