// Push an approved photo display order to Guesty. POST { listingId, order: [pictureId, ...] }.
// Reorders the listing's existing `pictures` array to match `order` (no add/remove) and PUTs it.
// MASTER content -> syncs to channels. Logged-in users only; the human approves the order in the UI.
// Mirrors the new order into guesty_listings locally so StayBoard reflects it immediately.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  const order: string[] = Array.isArray(body?.order) ? body.order.filter((x: any) => typeof x === 'string') : []
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  if (order.length === 0) return NextResponse.json({ error: 'order array required' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_listings').select('raw, pictures').eq('id', listingId).single()
  if (error || !row) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const current: any[] = Array.isArray(raw.pictures) ? raw.pictures
    : (Array.isArray((row as any).pictures) ? (row as any).pictures : [])
  if (current.length === 0) return NextResponse.json({ error: 'listing has no pictures' }, { status: 400 })

  // Reorder by _id. Any photo not named in `order` is appended in its original relative order, so we
  // can never drop a photo. The result must be a strict permutation (same set, same count).
  const byId = new Map<string, any>()
  current.forEach((p, i) => byId.set(String(p?._id ?? `idx-${i}`), p))
  const used = new Set<string>()
  const reordered: any[] = []
  for (const id of order) { const p = byId.get(id); if (p && !used.has(id)) { used.add(id); reordered.push(p) } }
  current.forEach((p, i) => { const id = String(p?._id ?? `idx-${i}`); if (!used.has(id)) { used.add(id); reordered.push(p) } })
  if (reordered.length !== current.length) {
    return NextResponse.json({ error: 'reorder integrity check failed' }, { status: 500 })
  }

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  const r = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pictures: reordered }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}` }, { status: 502 })

  // Mirror locally so StayBoard reflects the new order immediately.
  try {
    const newRaw = { ...raw, pictures: reordered, _lastOptimized: new Date().toISOString() }
    const update: any = { raw: newRaw }
    if (Array.isArray((row as any).pictures)) update.pictures = reordered
    await sb.from('guesty_listings').update(update).eq('id', listingId)
  } catch { /* mirror is best-effort */ }

  return NextResponse.json({ ok: true, count: reordered.length })
}
