// Set a listing's amenities in Guesty. Uses the dedicated amenities endpoint
// (PUT /properties-api/amenities/{id}) which SETS the full list. We send the final
// desired set; values ported from sibling units are already valid Guesty amenities.
// Logged-in users only; the human approves the change in the UI before this is called.
// Mirrors the result into guesty_listings so StayBoard reflects it immediately.
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
  const incoming = Array.isArray(body?.amenities) ? body.amenities : null
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  if (!incoming) return NextResponse.json({ error: 'amenities array required' }, { status: 400 })

  // Clean + dedupe (case-insensitive, keep first spelling). Cap to a sane size.
  const seen = new Set<string>()
  const amenities: string[] = []
  for (const a of incoming) {
    const s = typeof a === 'string' ? a.trim() : ''
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    amenities.push(s)
  }
  if (amenities.length > 200) return NextResponse.json({ error: 'Too many amenities.' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  const r = await fetch(`${BASE}/properties-api/amenities/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ amenities }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) {
    const hint = r.status === 404 ? ' (Guesty did not recognize this listing id for the amenities endpoint - no change was made.)'
      : r.status === 400 ? ' (Guesty only allows this on single-unit listings.)' : ''
    return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}${hint}` }, { status: 502 })
  }

  // Guesty returns the updated amenities list (array, or { amenities: [...] }).
  let updated: string[] = amenities
  try {
    const parsed = JSON.parse(respText)
    if (Array.isArray(parsed)) updated = parsed.filter((x: any) => typeof x === 'string')
    else if (Array.isArray(parsed?.amenities)) updated = parsed.amenities.filter((x: any) => typeof x === 'string')
  } catch { /* fall back to what we sent */ }

  // Mirror locally so StayBoard + the Optimize score reflect it immediately.
  try {
    const { data: row } = await sb.from('guesty_listings').select('raw').eq('id', listingId).maybeSingle()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    const newRaw = { ...raw, amenities: updated }
    await sb.from('guesty_listings').update({ amenities: updated, raw: newRaw }).eq('id', listingId)
  } catch { /* mirror is best-effort */ }

  return NextResponse.json({ ok: true, amenities: updated, count: updated.length })
}
