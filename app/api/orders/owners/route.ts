// Property owners, synced from Guesty. Guesty's /owners endpoint returns each owner with a
// `listings` array (the listing ids they own), so we can group Orders by owner and mint an
// owner-scoped share link. Stored as one JSON blob in app_settings (key 'guesty_owners') - no
// migration needed. GET returns the stored owners (any signed-in user); POST re-syncs (admin).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEY = 'guesty_owners'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

type Owner = { id: string; name: string; email: string; listingIds: string[]; active: boolean }

function ownerName(o: any): string {
  const full = String(o.fullName || '').trim()
  if (full) return full
  const fn = ((String(o.firstName || '') + ' ' + String(o.lastName || '')).trim())
  if (fn) return fn
  const biz = o.businessInformation && o.businessInformation.businessName ? String(o.businessInformation.businessName).trim() : ''
  if (biz) return biz
  return String(o.email || o._id || 'Owner')
}

async function readStored(db: any): Promise<{ owners: Owner[]; syncedAt: string | null }> {
  const { data } = await db.from('app_settings').select('value,updated_at').eq('key', KEY).limit(1)
  const row = data && data[0]
  if (!row || !row.value) return { owners: [], syncedAt: null }
  try { const j = JSON.parse(row.value); return { owners: Array.isArray(j.owners) ? j.owners : [], syncedAt: j.syncedAt || row.updated_at || null } } catch { return { owners: [], syncedAt: null } }
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const stored = await readStored(supabaseAdmin())
  return NextResponse.json({ ok: true, ...stored })
}

// Re-sync from Guesty. Admin only (it hits the Guesty API and rewrites the store).
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || String(user.email || '').toLowerCase() !== 'jon@stay-hospitality.com') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 })
  }
  let token = ''
  try { token = await getToken() } catch (e: any) { return NextResponse.json({ error: 'guesty token: ' + String(e && e.message || e) }, { status: 502 }) }

  const owners: Owner[] = []
  for (let page = 0; page < 20; page++) {
    const skip = page * 100
    let batch: any[] = []
    try {
      const r = await fetch(`${BASE}/owners?limit=100&skip=${skip}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
      if (!r.ok) { if (page === 0) return NextResponse.json({ error: 'guesty /owners ' + r.status }, { status: 502 }); break }
      const j: any = await r.json()
      batch = Array.isArray(j) ? j : (j.results || j.data || j.owners || [])
    } catch (e: any) { if (page === 0) return NextResponse.json({ error: String(e && e.message || e) }, { status: 502 }); break }
    if (!batch.length) break
    for (const o of batch) {
      const listingIds = Array.isArray(o.listings) ? o.listings.map((x: any) => String(x && x._id ? x._id : x)).filter(Boolean) : []
      owners.push({ id: String(o._id || o.id || ''), name: ownerName(o), email: String(o.email || ''), listingIds, active: o.active !== false })
    }
    if (batch.length < 100) break
  }
  // Keep only owners that actually hold at least one listing (nothing to order for empty owners).
  const withListings = owners.filter(o => o.listingIds.length > 0)
  const payload = JSON.stringify({ syncedAt: new Date().toISOString(), owners: withListings })
  const { error } = await supabaseAdmin().from('app_settings').upsert({ key: KEY, value: payload, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'save failed: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: withListings.length, totalFetched: owners.length, totalListingLinks: withListings.reduce((s, o) => s + o.listingIds.length, 0) })
}
