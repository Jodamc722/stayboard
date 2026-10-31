// DO OUR PHOTOS MATCH GUESTY? (Jon, 2026-10-31: "don't think the photos match what's in Guesty, can we
// please check"). Lighthouse shows a listing's photos from its mirror (guesty_listings.pictures and
// raw.pictures), refreshed by the listing sync. This reads the LIVE pictures from Guesty for one
// listing, a building, or every active listing, and reports the differences: photos Guesty has that
// we do not, photos we show that Guesty no longer has, a different order, different captions.
//
// GET  ?listing=<id> | ?building=<name> | ?all=1   — report only, nothing written.
// POST { listingIds: [...] }                      — refresh OUR mirror from Guesty for those listings
//                                                    (never writes to Guesty).
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const pics = (arr: any): { id: string; caption: string; url: string }[] =>
  (Array.isArray(arr) ? arr : []).map((p: any) => { const o = typeof p === 'string' ? (() => { try { return JSON.parse(p) } catch { return { url: p } } })() : (p || {}); return { id: str(o._id || o.id), caption: str(o.caption).trim(), url: str(o.original || o.large || o.regular || o.thumbnail || o.url) } }).filter(p => p.id || p.url)

async function token(sb: any): Promise<string | null> {
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  return tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? tok.access_token : null
}
async function livePictures(tok: string, id: string): Promise<{ ok: boolean; pictures?: any[]; status?: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${BASE}/listings/${encodeURIComponent(id)}?fields=pictures`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' })
    if (r.status === 429) { await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); continue }
    if (!r.ok) return { ok: false, status: r.status }
    const j: any = await r.json().catch(() => null)
    return { ok: true, pictures: Array.isArray(j?.pictures) ? j.pictures : [] }
  }
  return { ok: false, status: 429 }
}

function compare(mine: ReturnType<typeof pics>, live: ReturnType<typeof pics>) {
  // The image file name is the stable identity: the pictures column holds bare URLs, raw.pictures holds
  // objects, and Guesty's transform segments (h_200,c_fit) differ between sizes of the same photo.
  const key = (p: { id: string; url: string }) => (p.url.split('?')[0].split('/').pop() || p.id).toLowerCase()
  const mineIds = mine.map(key), liveIds = live.map(key)
  const onlyGuesty = live.filter(p => !mineIds.includes(key(p)))
  const onlyOurs = mine.filter(p => !liveIds.includes(key(p)))
  const common = liveIds.filter(id => mineIds.includes(id))
  const orderDiffers = common.join(',') !== mineIds.filter(id => liveIds.includes(id)).join(',')
  const captionDiffs = live.filter(p => { const m = mine.find(x => key(x) === key(p)); return m && m.caption !== p.caption }).length
  const match = !onlyGuesty.length && !onlyOurs.length && !orderDiffers && !captionDiffs
  return { match, oursCount: mine.length, guestyCount: live.length, onlyInGuesty: onlyGuesty.length, onlyInLighthouse: onlyOurs.length, orderDiffers, captionDiffs, coverDiffers: (mineIds[0] || '') !== (liveIds[0] || '') }
}

export async function GET(req: NextRequest) {
  const gate = await requireAnyLevel(['optimize', 'listings'], 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const sb = supabaseAdmin()
  const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable — run a sync, then retry.' }, { status: 503 })
  let q = sb.from('guesty_listings').select('id, nickname, title, building, status, pictures, rawPics:raw->pictures').limit(1000)
  if (sp.get('listing')) q = q.eq('id', String(sp.get('listing')))
  else if (sp.get('building')) q = q.ilike('nickname', '%' + String(sp.get('building')).replace(/[%_]/g, '') + '%')
  else if (sp.get('all') !== '1') return NextResponse.json({ error: 'Pass ?listing=, ?building= or ?all=1' }, { status: 400 })
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data || []).filter((r: any) => sp.get('listing') || !/inactive|deleted|archived/i.test(str(r.status)))
  const out: any[] = []
  const started = Date.now()
  for (const r of rows as any[]) {
    if (Date.now() - started > 270_000) { out.push({ id: r.id, name: r.nickname, skipped: 'time budget' }); continue }
    const mine = pics(Array.isArray(r.rawPics) && r.rawPics.length ? r.rawPics : r.pictures)
    const live = await livePictures(tok, r.id)
    if (!live.ok) { out.push({ id: r.id, name: r.nickname || r.title, error: 'Guesty ' + live.status }); continue }
    out.push({ id: r.id, name: r.nickname || r.title, ...compare(mine, pics(live.pictures)) })
  }
  const mismatched = out.filter(x => x.match === false)
  return NextResponse.json({ ok: true, checked: out.length, mismatched: mismatched.length, results: out.sort((a, b) => Number(!!a.match) - Number(!!b.match)) })
}

export async function POST(req: NextRequest) {
  const gate = await requireAnyLevel(['optimize', 'listings'], 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const ids: string[] = Array.isArray(body?.listingIds) ? body.listingIds.map(str).filter(Boolean).slice(0, 300) : []
  if (!ids.length) return NextResponse.json({ error: 'listingIds required' }, { status: 400 })
  const sb = supabaseAdmin()
  const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable' }, { status: 503 })
  const done: string[] = [], failed: string[] = []
  for (const id of ids) {
    const live = await livePictures(tok, id)
    if (!live.ok) { failed.push(id); continue }
    const { data: row } = await sb.from('guesty_listings').select('raw').eq('id', id).maybeSingle()
    const raw: any = row?.raw && typeof row.raw === 'object' ? row.raw : {}
    // The pictures column holds bare URLs (what the sync writes); raw.pictures holds the full objects.
    const urls = live.pictures!.map((p: any) => str(p?.original || p?.large || p?.regular || p?.thumbnail)).filter(Boolean)
    const { error } = await sb.from('guesty_listings').update({ pictures: urls, raw: { ...raw, pictures: live.pictures } }).eq('id', id)
    if (error) failed.push(id); else done.push(id)
  }
  return NextResponse.json({ ok: true, refreshed: done.length, failed })
}
