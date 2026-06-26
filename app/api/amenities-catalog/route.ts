// Full Guesty amenity catalog. Pulls the authoritative supported-amenities enum from Guesty
// (GET /properties-api/amenities/supported) so the add/bulk pickers can offer EVERY valid
// amenity, not just ones already used in the portfolio. Cached in-memory ~6h. Logged-in only.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

let CACHE: { at: number; names: string[]; groups: { group: string; names: string[] }[] } | null = null
const TTL = 6 * 60 * 60 * 1000

function pickName(x: any): string {
  if (typeof x === 'string') return x
  return String(x?.amenity || x?.name || x?.title || x?.label || x?.value || '').trim()
}
function pickGroup(x: any): string {
  if (typeof x === 'string') return 'Other'
  return String(x?.group || x?.groupName || x?.category || x?.type || x?.amenityGroup || 'Other').trim() || 'Other'
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (CACHE && Date.now() - CACHE.at < TTL) return NextResponse.json({ names: CACHE.names, groups: CACHE.groups, cached: true })

  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable — run a sync, then retry.', names: [] }, { status: 200 })

  try {
    const r = await fetch(`${BASE}/properties-api/amenities/supported`, {
      headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json' },
    })
    const text = await r.text()
    if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${text.slice(0, 160)}`, names: [] }, { status: 200 })
    let body: any = null
    try { body = JSON.parse(text) } catch { body = null }
    const arr: any[] = Array.isArray(body) ? body
      : Array.isArray(body?.amenities) ? body.amenities
      : Array.isArray(body?.results) ? body.results
      : Array.isArray(body?.data) ? body.data
      : []
    const names = Array.from(new Set(arr.map(pickName).filter(Boolean))).sort((a, b) => a.localeCompare(b))
    const gmap = new Map<string, Set<string>>()
    for (const x of arr) {
      const nm = pickName(x); if (!nm) continue
      const g = pickGroup(x)
      if (!gmap.has(g)) gmap.set(g, new Set())
      gmap.get(g)!.add(nm)
    }
    const groups = Array.from(gmap.entries())
      .map(([group, set]) => ({ group, names: Array.from(set).sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.group.localeCompare(b.group))
    if (names.length) CACHE = { at: Date.now(), names, groups }
    return NextResponse.json({ names, groups })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), names: [] }, { status: 200 })
  }
}
