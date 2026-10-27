// CAPTIONS FOR EVERY PHOTO (Jon, 2026-10-27: "write captions for all photos. If unsure of bed size
// don't say it, if not sure if common area vs in-room just describe it").
//   GET                      → how many photos have no caption, listing by listing (photo-library view)
//   POST { listingId }       → caption that listing's uncaptioned photos and push them to Guesty
//
// Only photos WITHOUT a real caption are written (empty, a camera file name, an id) — a caption the
// team wrote is never overwritten. The same file already captioned on another listing (a copied
// listing) reuses that caption instead of a new AI call. The rest go to the vision model six at a
// time, with what the photo analysis already knows about each, and come back with honesty flags —
// lib/caption-batch strips a bed size or a "private"/"shared" the model was not sure of.
//
// The push starts from Guesty's LIVE picture list (not our copy), changes only captions, keeps order
// and every picture, and is read back. Our copy and the photo index are updated to match. The AI
// spend hard stop applies: over the cap, the run stops and says so.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadListingAi } from '@/lib/listing-ai-server'
import { captionSpec } from '@/lib/listing-ai'
import { captionTagFor } from '@/lib/caption-tags'
import { modelFor } from '@/lib/ai-models'
import { aiFetch } from '@/lib/ai-usage'
import { isJunkCaption } from '@/lib/photo-order'
import { unitLabel } from '@/lib/unit-label'
import { rollupBuilding } from '@/lib/optimize-score'
import { PHOTO_LIBRARY_CACHE_TAG, forgetSearchCorpus } from '@/lib/photo-library'
import { batchInstruction, parseBatch, sanitizeCaption, chunks } from '@/lib/caption-batch'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const str = (v: any) => (v == null ? '' : String(v)).trim()
const picsOf = (v: any): any[] => (Array.isArray(v) ? v : []).map((p: any) => { if (typeof p === 'string') { try { return JSON.parse(p) } catch { return null } } return p }).filter((p: any) => p && typeof p === 'object')
const imgOf = (p: any) => str(p.thumbnail) || str(p.regular) || str(p.large) || str(p.original)
const needs = (p: any) => !!imgOf(p) && isJunkCaption(str(p.caption))
/** A 512 px view: enough to read a bed and a room, a fraction of the tokens of the original. */
function viewUrl(p: any): string {
  const u = str(p.original) || imgOf(p)
  if (u.includes('/image/upload/') && !/\/image\/upload\/[a-z]{1,2}_/.test(u)) return u.replace('/image/upload/', '/image/upload/w_512,h_512,c_limit,q_auto,f_jpg/')
  return imgOf(p)
}

type Row = { id: string; nickname: string | null; title: string | null; building: string | null; status: string | null; address_city: string | null; pics: any; pidx: any }
async function readListings(): Promise<Row[]> {
  const sb = supabaseAdmin()
  const out: Row[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb.from('guesty_listings').select('id, nickname, title, building, status, address_city, pics:raw->pictures, pidx:raw->_photoIndex').order('id').range(from, from + 999)
    if (error) throw new Error('guesty_listings: ' + error.message)
    out.push(...((data || []) as any))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function GET() {
  const g = await requireLevel('photo-library', 'view')
  if (!g.ok) return g.res
  try {
    const rows = await readListings()
    let photos = 0, missing = 0
    const listings: { id: string; name: string; building: string; active: boolean; total: number; missing: number }[] = []
    for (const l of rows) {
      const pics = picsOf(l.pics)
      const m = pics.filter(needs).length
      photos += pics.length; missing += m
      if (m) { const name = unitLabel(l); listings.push({ id: l.id, name, building: rollupBuilding(l.building, name), active: str(l.status).toLowerCase() === 'active', total: pics.length, missing: m }) }
    }
    listings.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.building.localeCompare(b.building, undefined, { numeric: true }) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    return NextResponse.json({ ok: true, photos, missing, captioned: photos - missing, listings })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

async function guestyToken(): Promise<string | null> {
  const { data: tok } = await supabaseAdmin().from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  return tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? tok.access_token : null
}

export async function POST(req: NextRequest) {
  // Writes to live OTA listings: the same gate as the photo organizer's push.
  const g = await requireLevel('optimize', 'edit')
  if (!g.ok) return g.res
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ ok: false, error: 'AI not configured' }, { status: 500 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = str(body?.listingId)
  if (!listingId) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  const token = await guestyToken()
  if (!token) return NextResponse.json({ ok: false, error: 'Guesty token unavailable — run a sync, then retry.' }, { status: 503 })

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_listings').select('id, nickname, title, building, status, address_city, raw').eq('id', listingId).single()
  if (error || !row) return NextResponse.json({ ok: false, error: 'listing not found' }, { status: 404 })
  const raw: any = (row as any).raw && typeof (row as any).raw === 'object' ? (row as any).raw : {}

  // Guesty's live list is the base — someone may have changed photos in Guesty since our last sync.
  const lr = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}?fields=pictures`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
  if (!lr.ok) return NextResponse.json({ ok: false, error: `Guesty ${lr.status} reading the listing` }, { status: 502 })
  const lj: any = await lr.json().catch(() => ({}))
  const live: any[] = picsOf(Array.isArray(lj?.pictures) ? lj.pictures : lj?.data?.pictures)
  const targets = live.map((p, i) => ({ p, i, id: str(p._id) || 'idx-' + i })).filter(t => needs(t.p))
  if (!targets.length) return NextResponse.json({ ok: true, listingId, written: 0, reused: 0, ai: 0, failed: 0, note: 'Every photo already has a caption.' })

  // Reuse: the same file, captioned on another listing.
  const known = new Map<string, string>()
  try {
    for (const l of await readListings()) for (const p of picsOf(l.pics)) { const c = str(p.caption); if (!isJunkCaption(c)) { const u = str(p.original); if (u && !known.has(u)) known.set(u, c) } }
  } catch { /* reuse is a saving, not a requirement */ }

  const name = unitLabel(row)
  const building = rollupBuilding((row as any).building, name)
  const listingLine = `Listing: ${str((row as any).title) || name} — property ${building}${str((row as any).address_city) ? ', ' + str((row as any).address_city) : ''}.`
  const cfg = await loadListingAi()
  const SYS = `You caption short-term-rental listing photos for Stay Hospitality.

${captionSpec(cfg, await captionTagFor(listingId))}

Each caption: at most ${cfg.photos.captionMaxWords} words and ${cfg.photos.captionMaxChars} characters. Reply with ONLY the JSON array asked for.`
  const model = await modelFor('photos')
  const idx = raw._photoIndex && typeof raw._photoIndex === 'object' ? raw._photoIndex : {}

  const result = new Map<string, string>()
  let reused = 0, ai = 0, failed = 0
  let budget = ''
  const toAsk: typeof targets = []
  for (const t of targets) { const c = known.get(str(t.p.original)); if (c) { result.set(t.id, c); reused++ } else toAsk.push(t) }

  const runChunk = async (group: typeof targets) => {
    if (budget) return
    const imgs = await Promise.all(group.map(async t => {
      try {
        const r = await fetch(viewUrl(t.p))
        if (!r.ok) return null
        const ct = (r.headers.get('content-type') || '').toLowerCase()
        return { media: ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg', data: Buffer.from(await r.arrayBuffer()).toString('base64') }
      } catch { return null }
    }))
    const items = group.map((t, k) => ({ t, k, img: imgs[k] })).filter(x => x.img)
    failed += group.length - items.length
    if (!items.length) return
    const content: any[] = [{ type: 'text', text: batchInstruction(items.map((x, n) => { const e = idx[x.t.id]; return { i: n + 1, context: e && (e.room || e.subject) ? 'the photo analysis saw: ' + [e.room, e.subject].filter(Boolean).join(', ') : '' } }), listingLine) }]
    items.forEach((x, n) => { content.push({ type: 'text', text: `Photo ${n + 1}:` }); content.push({ type: 'image', source: { type: 'base64', media_type: x.img!.media, data: x.img!.data } }) })
    const r = await aiFetch('photos', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 1200, system: SYS, messages: [{ role: 'user', content }] }) })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) { if (r.status === 429 && j?.error?.type === 'budget_exceeded') budget = str(j?.error?.message) || 'AI spend cap reached'; failed += items.length; return }
    const text = Array.isArray(j?.content) ? j.content.map((x: any) => str(x?.text)).join('') : ''
    const answers = parseBatch(text, items.map((_, n) => n + 1))
    items.forEach((x, n) => {
      const a = answers[n]
      const c = a ? sanitizeCaption(a.caption, a, cfg.photos.captionMaxChars) : ''
      if (c && !isJunkCaption(c)) { result.set(x.t.id, c); ai++ } else failed++
    })
  }
  const groups = chunks(toAsk, 6)
  for (let k = 0; k < groups.length; k += 3) await Promise.all(groups.slice(k, k + 3).map(runChunk))

  if (!result.size) return NextResponse.json({ ok: !budget, listingId, written: 0, reused, ai, failed, error: budget || 'No caption could be written for this listing.' }, { status: budget ? 429 : 200 })

  // Push: the live list, same order, same pictures, only the new captions changed.
  const next = live.map((p, i) => { const id = str(p._id) || 'idx-' + i; const c = result.get(id); return c ? { ...p, caption: c } : p })
  const pr = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ pictures: next }) })
  if (!pr.ok) { const t = await pr.text().catch(() => ''); return NextResponse.json({ ok: false, listingId, error: `Guesty ${pr.status}: ${t.slice(0, 200)}` }, { status: 502 }) }

  // Read back.
  let verified = 0
  try {
    const vr = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}?fields=pictures`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    const vj: any = vr.ok ? await vr.json().catch(() => ({})) : {}
    const back = picsOf(Array.isArray(vj?.pictures) ? vj.pictures : vj?.data?.pictures)
    const byId = new Map(back.map((p, i) => [str(p._id) || 'idx-' + i, str(p.caption)]))
    result.forEach((c, id) => { if (byId.get(id) === c) verified++ })
  } catch { /* the push itself succeeded */ }

  // Our copy and the photo index, to match.
  try {
    const index = { ...idx }
    const at = new Date().toISOString()
    result.forEach((c, id) => { index[id] = { ...(index[id] || {}), caption: c, at } })
    await sb.from('guesty_listings').update({ raw: { ...raw, pictures: next, _photoIndex: index } }).eq('id', listingId)
  } catch { /* the next sync brings it anyway */ }
  try { revalidateTag(PHOTO_LIBRARY_CACHE_TAG); forgetSearchCorpus() } catch { /* fine */ }

  const samples = Array.from(result.values()).slice(0, 4)
  return NextResponse.json({ ok: true, listingId, name, written: result.size, reused, ai, failed, verified, budget: budget || undefined, samples })
}
