// GUESTY ROOMS & ROOM PHOTOS (the Airbnb photo tour) — read side.
// GET ?listingId=X            → the listing's spaces, its photos (with any room assignment), and the
//                               account's room-type list, straight from Guesty.
// GET ?probe=1&listingId=X    → the same plus raw responses, for working out field shapes.
// Admin-only while this is a probe; the write side lives in lib/guesty-rooms.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const id = String(req.nextUrl.searchParams.get('listingId') || '').trim()
  if (!id) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  if (!tok?.access_token) return NextResponse.json({ error: 'no token' }, { status: 503 })
  const h = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' }
  const get = async (path: string) => { const r = await fetch(BASE + path, { headers: h, cache: 'no-store' }); const t = await r.text(); let j: any = null; try { j = JSON.parse(t) } catch { j = t.slice(0, 500) }; return { status: r.status, body: j } }
  const [roomTypes, spaces, photos] = await Promise.all([
    get('/properties/spaces/room-types'),
    get('/properties/spaces/unit-type/' + encodeURIComponent(id)),
    get('/properties-api/property-photos/property-photos/' + encodeURIComponent(id)),
  ])
  return NextResponse.json({ ok: true, roomTypes, spaces, photos })
}
