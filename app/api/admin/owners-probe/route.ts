// TEMP diagnostic (admin-only): discover how Guesty exposes property owners and how they map to
// listings, so we can build a real owners sync. Tries the Guesty /owners endpoints and inspects a
// few synced listing `raw` objects for owner-ish fields. Safe/read-only. Delete after we wire the
// real sync.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

async function gget(token: string, path: string) {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    const text = await r.text()
    let json: any = null
    try { json = JSON.parse(text) } catch {}
    return { path, status: r.status, ok: r.ok, json: json, text: json ? undefined : text.slice(0, 400) }
  } catch (e: any) {
    return { path, error: String(e && e.message || e).slice(0, 300) }
  }
}

// Pull the keys of an object, plus any key that looks owner/account related with its value shape.
function ownerish(obj: any): { allKeys: string[]; ownerKeys: Record<string, any> } {
  const out: Record<string, any> = {}
  const all = obj && typeof obj === 'object' ? Object.keys(obj) : []
  for (const k of all) {
    if (/owner|account/i.test(k)) {
      const v = (obj as any)[k]
      out[k] = v && typeof v === 'object' ? (Array.isArray(v) ? { array: true, len: v.length, first: v[0] } : { keys: Object.keys(v).slice(0, 20) }) : v
    }
  }
  return { allKeys: all, ownerKeys: out }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || String(user.email || '').toLowerCase() !== 'jon@stay-hospitality.com') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 })
  }

  let token = ''
  try { token = await getToken() } catch (e: any) { return NextResponse.json({ error: 'guesty token: ' + String(e && e.message || e) }, { status: 502 }) }

  // Try the likely owner list endpoints. Whichever returns 200 tells us the shape + list field.
  const ownerCalls = await Promise.all([
    gget(token, '/owners?limit=25'),
    gget(token, '/owners'),
    gget(token, '/owners?limit=25&skip=0'),
  ])
  // If any returned a list, grab the first owner id and fetch its detail.
  let firstOwnerId = ''
  for (const c of ownerCalls) {
    const j: any = (c as any).json
    const list = j && (j.results || j.data || j.owners || (Array.isArray(j) ? j : null))
    if (Array.isArray(list) && list.length) { firstOwnerId = String(list[0]._id || list[0].id || ''); break }
  }
  const ownerDetail = firstOwnerId ? await gget(token, '/owners/' + firstOwnerId) : { skipped: 'no owner id found in list responses' }

  // Inspect synced listing raw for owner-ish fields, focused on 17West + Elser.
  const db = supabaseAdmin()
  const { data: sampleListings } = await db
    .from('guesty_listings')
    .select('id,nickname,title,building,raw')
    .or('building.ilike.%17%west%,building.ilike.%elser%,building.ilike.%salado%')
    .limit(8)
  const listingProbe = (sampleListings || []).map((l: any) => ({
    id: l.id,
    nickname: l.nickname || l.title,
    building: l.building,
    rawTopKeys: l.raw && typeof l.raw === 'object' ? Object.keys(l.raw) : [],
    ...ownerish(l.raw || {}),
  }))
  // Distinct building names present, to sanity-check spelling.
  const { data: bldgs } = await db.from('guesty_listings').select('building').limit(1000)
  const buildingNames = Array.from(new Set((bldgs || []).map((b: any) => String(b.building || '')).filter(Boolean))).sort()

  return NextResponse.json({
    ok: true,
    ownerCalls: ownerCalls.map((c: any) => ({ path: c.path, status: c.status, error: c.error, listLen: (() => { const j = c.json; const list = j && (j.results || j.data || j.owners || (Array.isArray(j) ? j : null)); return Array.isArray(list) ? list.length : null })(), sampleFirst: (() => { const j = c.json; const list = j && (j.results || j.data || j.owners || (Array.isArray(j) ? j : null)); return Array.isArray(list) && list[0] ? list[0] : (j && !Array.isArray(list) ? Object.keys(j).slice(0, 20) : c.text) })() })),
    ownerDetail,
    listingProbe,
    buildingNames,
  })
}
