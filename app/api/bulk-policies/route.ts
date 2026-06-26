// Bulk-set booking policies across listings: cancellation policy, check-in/out times,
// min/max nights, house rules. GET ?listingId=X probes a listing's current policy fields
// (read-only) so the UI can prefill + verify field paths. POST {listingIds[], policy{}}
// pushes the partial change to Guesty per listing (PUT /listings/{id}), merging nested
// objects from the locally-synced raw so we never clobber other price/terms fields.
// The human approves in the UI before POST. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Note: cancellation policy is NOT settable via Guesty's API (the integrations object is read-only),
// so it's intentionally not handled here. Set cancellation in Guesty's UI.

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
async function token(sb: any): Promise<string | null> {
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  return valid ? tok.access_token : null
}

// ---- GET: probe one listing's current policy fields (verification + prefill) ----
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('listingId') || ''
  if (!id) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  const sb = supabaseAdmin()
  const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  const r = await fetch(`${BASE}/listings/${encodeURIComponent(id)}?fields=defaultCheckInTime defaultCheckOutTime terms prices publicDescription houseRules integrations`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
  })
  const text = await r.text()
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${text.slice(0, 200)}` }, { status: 200 })
  let l: any = {}
  try { l = JSON.parse(text) } catch { l = {} }
  // Return the policy-relevant subset (and a couple of candidate paths so we can confirm exact field names).
  return NextResponse.json({
    defaultCheckInTime: l.defaultCheckInTime ?? null,
    defaultCheckOutTime: l.defaultCheckOutTime ?? null,
    terms: l.terms ?? null,
    prices_keys: l.prices && typeof l.prices === 'object' ? Object.keys(l.prices) : null,
    guestyCancellationPolicy: l.prices?.guestyCancellationPolicy ?? null,
    cancellationPolicy: l.prices?.cancellationPolicy ?? l.cancellationPolicy ?? null,
    houseRules_top: l.houseRules ?? null,
    publicDescription_houseRules: l.publicDescription?.houseRules ?? null,
    publicDescription_keys: l.publicDescription && typeof l.publicDescription === 'object' ? Object.keys(l.publicDescription) : null,
    terms_cancellation: l.terms?.cancellation ?? null,
    integrations: Array.isArray(l.integrations) ? l.integrations.map((it: any) => {
      const platform = it?.platform || it?.channel || it?._id || null
      const out: any = { platform }
      for (const k of Object.keys(it || {})) {
        const v = (it as any)[k]
        if (v && typeof v === 'object' && ('cancellationPolicy' in v || 'cancellation' in v)) {
          out[k] = { cancellationPolicy: v.cancellationPolicy ?? v.cancellation ?? null }
        }
      }
      return out
    }) : null,
  })
}

// ---- POST: bulk-apply a partial policy change ----
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: any) => typeof x === 'string') : []
  const p = (body?.policy && typeof body.policy === 'object') ? body.policy : {}
  if (listingIds.length === 0) return NextResponse.json({ error: 'listingIds required' }, { status: 400 })
  if (listingIds.length > 120) return NextResponse.json({ error: 'Too many listings in one batch (max 120).' }, { status: 400 })

  // Validate + normalize the requested changes.
  const change: any = {}
  if (typeof p.checkInTime === 'string' && /^\d{1,2}:\d{2}$/.test(p.checkInTime)) change.checkInTime = p.checkInTime
  if (typeof p.checkOutTime === 'string' && /^\d{1,2}:\d{2}$/.test(p.checkOutTime)) change.checkOutTime = p.checkOutTime
  if (p.minNights != null && Number.isFinite(Number(p.minNights)) && Number(p.minNights) > 0) change.minNights = Math.round(Number(p.minNights))
  if (p.maxNights != null && Number.isFinite(Number(p.maxNights)) && Number(p.maxNights) > 0) change.maxNights = Math.round(Number(p.maxNights))
  if (typeof p.houseRules === 'string' && p.houseRules.trim()) change.houseRules = p.houseRules.trim().slice(0, 4000)
  if (Object.keys(change).length === 0) return NextResponse.json({ error: 'No valid policy changes provided.' }, { status: 400 })

  const sb = supabaseAdmin()
  const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry.' }, { status: 503 })

  const { data: rows } = await sb.from('guesty_listings').select('id, title, nickname, raw').in('id', listingIds)
  const byId = new Map<string, any>()
  ;(rows ?? []).forEach((r: any) => byId.set(r.id, r))

  const results: { id: string; name: string; ok: boolean; error?: string }[] = []
  let okCount = 0, failCount = 0

  for (const id of listingIds) {
    const row = byId.get(id)
    const name = row ? (row.title || row.nickname || id) : id
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    // Build a partial PUT payload, merging nested objects from the synced raw so we don't clobber siblings.
    const payload: any = {}
    if (change.checkInTime) payload.defaultCheckInTime = change.checkInTime
    if (change.checkOutTime) payload.defaultCheckOutTime = change.checkOutTime
    if (change.minNights != null || change.maxNights != null) {
      const terms = (raw.terms && typeof raw.terms === 'object') ? { ...raw.terms } : {}
      if (change.minNights != null) terms.minNights = change.minNights
      if (change.maxNights != null) terms.maxNights = change.maxNights
      payload.terms = terms
    }
    if (change.houseRules) payload.publicDescription = { houseRules: change.houseRules }

    try {
      const r = await fetch(`${BASE}/listings/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) { results.push({ id, name, ok: false, error: `Guesty ${r.status}: ${text.slice(0, 120)}` }); failCount++; continue }
      // Mirror locally.
      try {
        const newRaw: any = { ...raw }
        if (change.checkInTime) newRaw.defaultCheckInTime = change.checkInTime
        if (change.checkOutTime) newRaw.defaultCheckOutTime = change.checkOutTime
        if (payload.terms) newRaw.terms = payload.terms
        if (payload.prices) newRaw.prices = payload.prices
        if (change.houseRules) newRaw.publicDescription = { ...(raw.publicDescription || {}), houseRules: change.houseRules }
        await sb.from('guesty_listings').update({ raw: newRaw }).eq('id', id)
      } catch { /* best effort */ }
      results.push({ id, name, ok: true }); okCount++
    } catch (e: any) {
      results.push({ id, name, ok: false, error: e?.message || String(e) }); failCount++
    }
  }

  return NextResponse.json({ ok: true, okCount, failCount, applied: change, results })
}
