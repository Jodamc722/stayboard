// Fold NEW materials into an existing guidebook — appliance photos are vision-labeled and become
// How-To Guide items (with the photo pinned), and PDFs (manuals, building packets) are read and
// their facts folded into whichever sections they inform. Internal _keys are preserved.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-opus-4-8'
const VISION_MODEL = 'claude-sonnet-4-6'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  let o = tryParse(raw)
  if (!o) o = tryParse(raw.replace(/```(?:json)?/gi, '').trim())
  if (!o) { const a = raw.search(/[[{]/); const b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']')); if (a !== -1 && b > a) o = tryParse(raw.slice(a, b + 1)) }
  return o && typeof o === 'object' ? o : null
}

async function anthropic(key: string, payload: any): Promise<string | null> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    return Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const photoUrls: string[] = Array.isArray(body?.photoUrls) ? body.photoUrls.filter((u: any) => typeof u === 'string').slice(0, 12) : []
  const docUrls: string[] = Array.isArray(body?.docUrls) ? body.docUrls.filter((u: any) => typeof u === 'string').slice(0, 3) : []
  if (!id || (!photoUrls.length && !docUrls.length)) return NextResponse.json({ error: 'id and at least one photo or document required' }, { status: 400 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const db = supabaseAdmin()
  const { data } = await db.from('guidebooks').select('*').eq('id', id).limit(1)
  const gb = (data || [])[0]
  if (!gb) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sections = gb.sections || {}

  // ---- Vision: identify what each new photo shows (appliance labels drive How-To items). ----
  let meta = photoUrls.map(u => ({ url: u, category: 'other', brightness: 'mid', quality: 3, coverWorthy: false, hasText: false, label: '' }))
  if (photoUrls.length) {
    const content: any[] = photoUrls.flatMap((u, i) => [{ type: 'text', text: 'IMAGE ' + i + ':' }, { type: 'image', source: { type: 'url', url: u } }])
    content.push({ type: 'text', text: `For EACH of the ${photoUrls.length} images above, in order, return a JSON array: {"i":index,"category":"bedroom|living|kitchen|dining|bathroom|pool|beach|view|exterior|amenity|appliance|logo|other","brightness":"dark|mid|bright","quality":1-5,"coverWorthy":true|false,"hasText":true|false,"label":""}. category "appliance" = a close-up of a specific appliance or control - for those ONLY, set "label" to a 2-4 word name (e.g. "induction cooktop"). hasText = any visible printed text/document/menu/sheet. STRICT minified JSON array only.` })
    const text = await anthropic(key, { model: VISION_MODEL, max_tokens: 1800, messages: [{ role: 'user', content }] })
    const parsed = parseJson(text || '')
    if (Array.isArray(parsed)) parsed.forEach((p: any) => {
      const i = Number(p?.i)
      if (Number.isFinite(i) && meta[i]) meta[i] = { url: photoUrls[i], category: str(p.category) || 'other', brightness: str(p.brightness) || 'mid', quality: Number(p.quality) || 3, coverWorthy: p.coverWorthy === true, hasText: p.hasText === true, label: str(p.label).slice(0, 40) }
    })
  }

  // ---- Attach PDFs. ----
  const docBlocks: any[] = []
  for (const u of docUrls) {
    try {
      const r = await fetch(u)
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 8 * 1024 * 1024) continue
      docBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
    } catch { /* skip doc */ }
  }

  // ---- Compose: fold the material into the book. ----
  const visible: Record<string, any> = {}
  for (const [k, v] of Object.entries(sections)) if (!k.startsWith('_')) visible[k] = v
  const labels = meta.filter(p => p.category === 'appliance' && p.label).map(p => p.label)

  const SYSTEM = `You are the editor of a luxury guest guidebook for Stay Hospitality. You receive the guidebook's current content as JSON plus NEW MATERIALS (appliance photos identified by name, and attached documents such as manuals or building packets). Fold the materials in:
1. houseGuide is the HOW-TO GUIDE - add or update one item per appliance/system from the materials (title NAMES the equipment; body 25-45 words of clear guest steps, framed as a premium feature). Up to 6 items. Remove "houseGuide" from "omit" if you add items.
2. Update any other section the materials clearly inform (arrival, guidelines, gettingAround, special). Change nothing else.
3. Never invent facts not present in the content or the materials.
4. Return the COMPLETE revised JSON - same top-level keys and shapes. STRICT minified JSON only, no markdown.`
  const USER: any[] = [...docBlocks, { type: 'text', text: `CURRENT GUIDEBOOK CONTENT:\n${JSON.stringify(visible)}\n\nNEW APPLIANCE PHOTOS (write/refresh a How-To item for each): ${labels.length ? labels.join(', ') : '(none)'}\n${docBlocks.length ? 'Documents attached above - read them and fold the relevant facts in.' : ''}` }]

  const text = await anthropic(key, { model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: 'user', content: USER }] })
  const revised = parseJson(text || '')
  if (!revised || !revised.cover) return NextResponse.json({ error: 'AI could not fold the materials in — try again.' }, { status: 502 })

  const next: Record<string, any> = { ...sections, ...revised }
  for (const [k, v] of Object.entries(sections)) if (k.startsWith('_')) next[k] = v
  // Extend the photo pool + metadata, then pin appliance photos onto matching How-To items.
  next._photos = [...(Array.isArray(sections._photos) ? sections._photos : []), ...photoUrls]
  next._photoMeta = [...(Array.isArray(sections._photoMeta) ? sections._photoMeta : []), ...meta]
  {
    const appl = meta.filter(p => p.category === 'appliance' && !p.hasText)
    const claimed = new Set<string>()
    for (const it of (next.houseGuide?.items || [])) {
      if (it.photo) continue
      const tw = str(it?.title).toLowerCase()
      const hit = appl.find(p => !claimed.has(p.url) && str(p.label).toLowerCase().split(/\s+/).filter(w => w.length > 2 && tw.includes(w)).length >= 2)
      if (hit) { it.photo = hit.url; claimed.add(hit.url) }
    }
  }

  const { error } = await db.from('guidebooks').update({ sections: next, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sections: next })
}
