// Bulk amenity add. For each selected listing, unions the chosen amenities with the unit's
// current set and pushes the result to Guesty (PUT /properties-api/amenities/{id}). Processes
// sequentially to respect Guesty rate limits; returns a per-listing result. The human approves
// the change in the UI before this is called. Logged-in users only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: any) => typeof x === 'string') : []
  const add: string[] = Array.isArray(body?.add) ? body.add.map(str).map((s: string) => s.trim()).filter(Boolean) : []
  const remove: string[] = Array.isArray(body?.remove) ? body.remove.map(str).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : []
  if (listingIds.length === 0) return NextResponse.json({ error: 'listingIds required' }, { status: 400 })
  if (add.length === 0 && remove.length === 0) return NextResponse.json({ error: 'nothing to add or remove' }, { status: 400 })
  if (listingIds.length > 120) return NextResponse.json({ error: 'Too many listings in one batch (max 120).' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  // Current amenities per listing (to union with the additions).
  const { data: rows } = await sb.from('guesty_listings').select('id, amenities, raw, title, nickname').in('id', listingIds)
  const byId = new Map<string, any>()
  ;(rows ?? []).forEach((r: any) => byId.set(r.id, r))

  const results: { id: string; name: string; ok: boolean; added: number; total: number; error?: string }[] = []
  let okCount = 0, failCount = 0

  for (const id of listingIds) {
    const row = byId.get(id)
    const name = row ? (row.title || row.nickname || id) : id
    const current: string[] = Array.isArray(row?.amenities) && row.amenities.length ? row.amenities
      : (Array.isArray(row?.raw?.amenities) ? row.raw.amenities : [])
    // Union (case-insensitive dedupe), then drop removals.
    const seen = new Set<string>(); const final: string[] = []
    for (const a of [...current, ...add]) {
      const s = str(a).trim(); if (!s) continue
      const key = s.toLowerCase()
      if (seen.has(key) || remove.includes(key)) continue
      seen.add(key); final.push(s)
    }
    const beforeCount = current.length
    try {
      const r = await fetch(`${BASE}/properties-api/amenities/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ amenities: final }),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) {
        const hint = r.status === 404 ? 'listing not recognized on the amenities endpoint' : r.status === 400 ? 'only single-unit listings supported' : text.slice(0, 120)
        results.push({ id, name, ok: false, added: 0, total: beforeCount, error: `Guesty ${r.status}: ${hint}` })
        failCount++
        continue
      }
      let updated: string[] = final
      try { const p = JSON.parse(text); if (Array.isArray(p)) updated = p.filter((x: any) => typeof x === 'string'); else if (Array.isArray(p?.amenities)) updated = p.amenities.filter((x: any) => typeof x === 'string') } catch { /* keep final */ }
      // Mirror locally.
      try {
        const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
        await sb.from('guesty_listings').update({ amenities: updated, raw: { ...raw, amenities: updated } }).eq('id', id)
      } catch { /* best effort */ }
      results.push({ id, name, ok: true, added: Math.max(0, updated.length - beforeCount), total: updated.length })
      okCount++
    } catch (e: any) {
      results.push({ id, name, ok: false, added: 0, total: beforeCount, error: e?.message || String(e) })
      failCount++
    }
  }

  return NextResponse.json({ ok: true, okCount, failCount, results })
}
