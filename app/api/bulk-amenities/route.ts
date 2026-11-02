// Bulk amenity add/remove. For each selected listing, unions the chosen amenities with the unit's
// current set and pushes the result to Guesty (PUT /properties-api/amenities/{id}). Processes
// sequentially to respect Guesty rate limits; returns a per-listing result. The human approves
// the change in the UI before this is called. Logged-in users only.
//
// WHY NAMES ARE TRANSLATED (2026-11-01, "a lot of them don't stick"): Guesty answers 200 to a PUT
// and silently drops any name not in its supported list ("Smart TV", "Cooking basics", "Pool").
// So every name is translated to Guesty's spelling first (lib/guesty-amenities), a name Guesty has
// nothing for is reported as dropped instead of pretending it saved, and a removal matches the
// amenity in any spelling (removing "TV" also clears "Smart TV").
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAnyLevel } from '@/lib/access'
import { resolveAmenities, resolveAmenity, norm } from '@/lib/guesty-amenities'
import { guestyFetch } from '@/lib/guesty-retry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const GAP_MS = 350            // ~3 writes/s — under Guesty's 15/s and 120/min with room for other callers
const TIME_BUDGET_MS = 270_000

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function supported(tok: string): Promise<string[]> {
  try {
    const r = await guestyFetch(`${BASE}/properties-api/amenities/supported`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' } })
    const j: any = await r.json()
    const arr: any[] = Array.isArray(j) ? j : j?.amenities || j?.results || j?.data || []
    return arr.map((x: any) => typeof x === 'string' ? x : str(x?.amenity || x?.name)).filter(Boolean)
  } catch { return [] }
}

export type BulkAmenityResult = {
  id: string; name: string; ok: boolean; added: number; removed: number; total: number
  renamed?: { from: string; to: string }[]; dropped?: string[]; error?: string; skipped?: string
}

export async function POST(req: NextRequest) {
  // The bulk panels sit on the Property page (/buildings/[slug]); edit there or on the Optimizer.
  const gate = await requireAnyLevel(['optimize', 'buildings'], 'edit')
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: any) => typeof x === 'string') : []
  const add: string[] = Array.isArray(body?.add) ? body.add.map(str).map((s: string) => s.trim()).filter(Boolean) : []
  const remove: string[] = Array.isArray(body?.remove) ? body.remove.map(str).map((s: string) => s.trim()).filter(Boolean) : []
  if (listingIds.length === 0) return NextResponse.json({ error: 'listingIds required' }, { status: 400 })
  if (add.length === 0 && remove.length === 0) return NextResponse.json({ error: 'nothing to add or remove' }, { status: 400 })
  if (listingIds.length > 120) return NextResponse.json({ error: 'Too many listings in one batch (max 120).' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })
  const sup = await supported(tok!.access_token)

  // Names to add, in Guesty's spelling. A name Guesty has nothing for is reported once, up front.
  const addPlan = resolveAmenities(add, sup)
  const addNames = addPlan.kept
  // Removal keys: the chosen name and its Guesty spelling, so either form on the listing goes.
  const removeKeys = new Set<string>()
  for (const r of remove) { removeKeys.add(norm(r)); const g = resolveAmenity(r, sup); if (g) removeKeys.add(norm(g)) }
  const removes = (a: string) => { if (removeKeys.has(norm(a))) return true; const g = resolveAmenity(a, sup); return !!g && removeKeys.has(norm(g)) }

  if (addNames.length === 0 && removeKeys.size === 0) {
    return NextResponse.json({ error: `Guesty has no amenity for: ${addPlan.dropped.join(', ')}. Nothing was changed.`, dropped: addPlan.dropped }, { status: 400 })
  }

  // Current amenities per listing (to union with the additions).
  const { data: rows } = await sb.from('guesty_listings').select('id, amenities, raw, title, nickname').in('id', listingIds)
  const byId = new Map<string, any>()
  ;(rows ?? []).forEach((r: any) => byId.set(r.id, r))

  const results: BulkAmenityResult[] = []
  let okCount = 0, failCount = 0
  const started = Date.now()

  for (const id of listingIds) {
    const row = byId.get(id)
    const name = row ? (row.title || row.nickname || id) : id
    // A listing we do not hold a mirror of would be REPLACED with only the additions — never do that.
    if (!row) { results.push({ id, name, ok: false, added: 0, removed: 0, total: 0, error: 'Not in our mirror yet — run a Guesty sync, then retry.' }); failCount++; continue }
    if (Date.now() - started > TIME_BUDGET_MS) { results.push({ id, name, ok: false, added: 0, removed: 0, total: 0, skipped: 'time budget — run again for the rest' }); failCount++; continue }

    const current: string[] = Array.isArray(row?.amenities) && row.amenities.length ? row.amenities.map(str)
      : (Array.isArray(row?.raw?.amenities) ? row.raw.amenities.map(str) : [])
    // Union in Guesty's spelling (legacy names already on the listing pass through), then drop removals.
    const { kept, renamed } = resolveAmenities([...current, ...addNames], sup, current)
    const final = kept.filter(a => !removes(a))
    const beforeCount = current.length
    const removedCount = current.filter(a => removes(a)).length
    const alreadyHad = (a: string) => current.some(c => norm(c) === norm(a))
    const newlyAdded = addNames.filter(a => !alreadyHad(a) && !removes(a))

    try {
      const r = await guestyFetch(`${BASE}/properties-api/amenities/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ amenities: final }),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) {
        const hint = r.status === 429 ? 'Guesty asked us to slow down — run again in a minute for the rest'
          : r.status === 404 ? 'listing not recognized on the amenities endpoint' : r.status === 400 ? 'only single-unit listings supported' : text.slice(0, 120)
        results.push({ id, name, ok: false, added: 0, removed: 0, total: beforeCount, error: `Guesty ${r.status}: ${hint}` })
        failCount++
        await sleep(GAP_MS)
        continue
      }
      // What Guesty actually kept — the truth the mirror and the result both report.
      let updated: string[] = final
      try { const p = JSON.parse(text); if (Array.isArray(p)) updated = p.filter((x: any) => typeof x === 'string'); else if (Array.isArray(p?.amenities)) updated = p.amenities.filter((x: any) => typeof x === 'string') } catch { /* keep final */ }
      const stuck = newlyAdded.filter(a => !updated.some(u => norm(u) === norm(a)))
      try {
        const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
        await sb.from('guesty_listings').update({ amenities: updated, raw: { ...raw, amenities: updated } }).eq('id', id)
      } catch { /* best effort */ }
      results.push({
        id, name, ok: true, added: newlyAdded.length - stuck.length, removed: removedCount, total: updated.length,
        renamed: renamed.filter(x => addNames.some(a => norm(a) === norm(x.to)) && !alreadyHad(x.to)),
        dropped: stuck.length ? stuck : undefined,
      })
      okCount++
    } catch (e: any) {
      results.push({ id, name, ok: false, added: 0, removed: 0, total: beforeCount, error: e?.message || String(e) })
      failCount++
    }
    await sleep(GAP_MS)
  }

  return NextResponse.json({
    ok: true, okCount, failCount, results,
    // Chosen names Guesty has nothing for, and what the chosen names were saved as.
    dropped: addPlan.dropped, renamed: addPlan.renamed,
  })
}
