// AMENITY REPAIR ACROSS THE PORTFOLIO (Jon, 2026-11-01: "a lot of them don't stick, run a full audit
// and fix"). Listings carry amenity words in Airbnb's or our old spelling ("Pool", "Wifi", "Smoke
// alarm") that Guesty stores but maps to no channel amenity — so a guest filtering for a pool never
// sees them. GET = the plan per listing (nothing written). POST { apply: true, listingIds? } = write
// each listing's translated list to Guesty (legacy words kept, so nothing is ever removed), with the
// live result read back and reported.
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { repairPlan } from '@/lib/guesty-amenities'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

async function token(sb: any) { const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle(); return tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000) ? tok.access_token : null }
async function supported(tok: string): Promise<string[]> {
  try { const r = await fetch(`${BASE}/properties-api/amenities/supported`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, cache: 'no-store' }); const j: any = await r.json(); const arr: any[] = Array.isArray(j) ? j : j?.amenities || j?.results || j?.data || []; return arr.map((x: any) => typeof x === 'string' ? x : str(x?.amenity || x?.name)).filter(Boolean) } catch { return [] }
}
async function plan(sb: any, sup: string[], only?: string[]) {
  let q = sb.from('guesty_listings').select('id, nickname, title, status, amenities').limit(1000)
  if (only && only.length) q = q.in('id', only)
  const { data } = await q
  const rows = ((data || []) as any[]).filter(r => only?.length || !/inactive|deleted|archived/i.test(str(r.status)))
  return rows.map(r => { const listed: string[] = Array.isArray(r.amenities) ? r.amenities.map(String) : []; const p = repairPlan(listed, sup); return { id: str(r.id), name: str(r.nickname || r.title), listed: listed.length, ...p } })
}

export async function GET() {
  const gate = await requireAnyLevel(['optimize', 'listings'], 'edit')
  if (!gate.ok) return gate.res
  const sb = supabaseAdmin(); const tok = await token(sb)
  const sup = tok ? await supported(tok) : []
  const rows = await plan(sb, sup)
  const needs = rows.filter(r => r.add.length)
  const tally: Record<string, number> = {}
  for (const r of needs) for (const a of r.add) tally[a] = (tally[a] || 0) + 1
  return NextResponse.json({ ok: true, supportedCount: sup.length, listings: rows.length, needRepair: needs.length, tally, plan: needs.map(r => ({ id: r.id, name: r.name, add: r.add, untranslatable: r.untranslatable })) })
}

export async function POST(req: NextRequest) {
  const gate = await requireAnyLevel(['optimize', 'listings'], 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  if (body?.apply !== true) return NextResponse.json({ error: 'pass { apply: true }' }, { status: 400 })
  const only: string[] | undefined = Array.isArray(body.listingIds) ? body.listingIds.map(str).filter(Boolean) : undefined
  const sb = supabaseAdmin(); const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable' }, { status: 503 })
  const sup = await supported(tok)
  const rows = (await plan(sb, sup, only)).filter(r => r.add.length)
  const results: any[] = []
  const started = Date.now()
  for (const r of rows) {
    if (Date.now() - started > 270_000) { results.push({ id: r.id, name: r.name, skipped: 'time budget' }); continue }
    // Guesty: 15/s, 120/min; a 429 says wait, so wait and try again (up to 4 times).
    let put: Response | null = null, txt = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      put = await fetch(`${BASE}/properties-api/amenities/${encodeURIComponent(r.id)}`, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ amenities: r.next }) })
      txt = await put.text().catch(() => '')
      if (put.status !== 429) break
      const ra = Number(put.headers.get('retry-after')) || 0
      await new Promise(res => setTimeout(res, Math.max(2000, ra * 1000) * (attempt + 1)))
    }
    if (!put) continue
    if (!put.ok) { results.push({ id: r.id, name: r.name, error: `Guesty ${put.status}: ${txt.slice(0, 120)}` }); continue }
    let updated: string[] = r.next
    try { const j = JSON.parse(txt); const arr = Array.isArray(j) ? j : Array.isArray(j?.amenities) ? j.amenities : null; if (arr) updated = arr.filter((x: any) => typeof x === 'string') } catch { /* keep sent */ }
    const landed = r.add.filter(a => updated.some(u => u.toLowerCase() === a.toLowerCase()))
    const missed = r.add.filter(a => !landed.includes(a))
    try { const { data: row } = await sb.from('guesty_listings').select('raw').eq('id', r.id).maybeSingle(); const raw: any = row?.raw && typeof row.raw === 'object' ? row.raw : {}; await sb.from('guesty_listings').update({ amenities: updated, raw: { ...raw, amenities: updated }, amenities_pushed_at: new Date().toISOString() }).eq('id', r.id) } catch { /* mirror next sync */ }
    results.push({ id: r.id, name: r.name, added: landed, missed })
    await new Promise(res => setTimeout(res, 600))
  }
  return NextResponse.json({ ok: true, repaired: results.filter(x => x.added).length, results })
}
