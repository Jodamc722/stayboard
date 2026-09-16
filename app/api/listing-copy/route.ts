// BULK LISTING COPY — read the pick tree, push the approved text to Guesty.
//
// GET  ?scope=property&building=<name>   the property's units, what each says today, and the
//                                        property's saved standard
// GET  ?scope=portfolio                  every property with its unit count and how many already
//                                        carry the proposed Other-notes text
// POST { scope, building?, listingIds[], sections{}, saveStandard? }
//
// THE SCOPE RULE IS ENFORCED HERE, not only in the UI (lib/listing-copy-bulk explains why it exists):
// Guest access / Neighborhood / Getting around may only be written one property at a time, and Other
// notes is chosen by whole properties. A rebuilt screen, a stale tab, or a direct POST all hit the
// same check.
//
// This route WRITES LIVE OTA LISTING TEXT across dozens of listings in one call, so it needs edit on
// the optimizer — the same gate as the single-listing push in /api/listing-content — and every push
// is recorded in listing_copy_pushes with who did it.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { rollupBuilding } from '@/lib/optimize-score'
import { unitLabel } from '@/lib/unit-label'
import { pageRows } from '@/lib/db-page'
import {
  BULK_SECTIONS, planBulk, scopeError, lengthErrors, norm, sectionOf,
  type BulkSectionKey, type CopyTarget,
} from '@/lib/listing-copy-bulk'

export const dynamic = 'force-dynamic'
// Sequential PUTs with a pause between them. A 30-unit property at ~600ms each is well inside this;
// a portfolio push is chunked by the client so no single call runs long.
export const maxDuration = 300

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const GAP_MS = 250            // between Guesty writes — polite, and well under any burst limit
const MAX_PER_CALL = 60       // the client chunks; this is the backstop

// What a property remembers as its own. Other notes is here too since 2026-09-16 — Jon put it on
// the property panel as well as the portfolio one, and a property that has its own note should keep
// it the same way it keeps its lobby directions.
const STD_KEYS: BulkSectionKey[] = ['access', 'neighborhood', 'transit', 'notes']

type Row = { id: string; title: any; nickname: any; building: any; unit: any; status: any; raw: any }

function pub(raw: any): Record<string, string> {
  const p = raw?.publicDescription
  return p && typeof p === 'object' ? p : {}
}
function live(r: Row): boolean { return DEAD.indexOf(String(r.status || '').toLowerCase()) < 0 }

function toTarget(r: Row): CopyTarget {
  const p = pub(r.raw)
  return {
    id: String(r.id),
    name: unitLabel(r as any),
    building: rollupBuilding(r.building, r.nickname || r.title),
    current: { access: norm(p.access), neighborhood: norm(p.neighborhood), transit: norm(p.transit), notes: norm(p.notes) },
  }
}

async function allListings(sb: any): Promise<Row[]> {
  // Paged, not .limit(1000). The portfolio view must be complete or the roster counts that the
  // "whole properties only" rule depends on would be wrong.
  const { rows } = await pageRows<Row>((a, b) => sb.from('guesty_listings')
    .select('id, title, nickname, building, unit, status, raw').order('id').range(a, b), 12)
  return (rows || []).filter(live)
}

async function token(sb: any): Promise<string | null> {
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  return valid ? tok.access_token : null
}

/* ------------------------------------------------------------------ GET */
export async function GET(req: NextRequest) {
  const gate = await requireLevel('optimize', 'view')
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') === 'portfolio' ? 'portfolio' : 'property'
  const sb = supabaseAdmin()
  const rows = await allListings(sb)
  const targets = rows.map(toTarget)

  if (scope === 'portfolio') {
    // Properties only. Jon: "At the portfolio level, you should be able to select only properties,
    // not individual listings" — so this returns no unit list at all, just the properties and what
    // their Other notes look like today.
    const byB = new Map<string, CopyTarget[]>()
    for (const t of targets) {
      const arr = byB.get(t.building)
      if (arr) arr.push(t); else byB.set(t.building, [t])
    }
    const properties = Array.from(byB.entries()).map(([building, list]) => {
      const texts = new Set(list.map(x => norm(x.current.notes)).filter(Boolean))
      return {
        building,
        units: list.length,
        blank: list.filter(x => !norm(x.current.notes)).length,
        variants: texts.size,
        sample: Array.from(texts)[0] || '',
      }
    }).sort((a, b) => b.units - a.units)
    return NextResponse.json({ scope, properties })
  }

  const want = norm(url.searchParams.get('building') || '').toLowerCase()
  if (!want) return NextResponse.json({ error: 'building required' }, { status: 400 })
  const units = targets.filter(t => t.building.toLowerCase() === want)
  if (!units.length) return NextResponse.json({ error: 'No live listings found for that property.' }, { status: 404 })

  const building = units[0].building
  let standard: Record<string, string> = {}
  try {
    const { data } = await sb.from('property_copy_standards').select('access, neighborhood, transit, notes, updated_by, updated_at').eq('building', building).maybeSingle()
    if (data) standard = data as any
  } catch { /* the standard is a convenience; its absence never blocks editing */ }

  return NextResponse.json({ scope, building, units, standard })
}

/* ------------------------------------------------------------------ POST */
export async function POST(req: NextRequest) {
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const who = gate.access.email || ''

  const body = await req.json().catch(() => ({} as any))
  const scope = body?.scope === 'portfolio' ? 'portfolio' : 'property'
  const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.filter((x: any) => typeof x === 'string' && x) : []
  const inSections = (body?.sections && typeof body.sections === 'object') ? body.sections : {}
  const saveStandard = body?.saveStandard === true

  if (!listingIds.length) return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 })
  if (listingIds.length > MAX_PER_CALL) return NextResponse.json({ error: 'Too many listings in one call (max ' + MAX_PER_CALL + ') — push in batches.' }, { status: 400 })

  const edits: Partial<Record<BulkSectionKey, string>> = {}
  for (const s of BULK_SECTIONS) {
    const v = inSections[s.key]
    if (typeof v === 'string' && norm(v)) edits[s.key] = norm(v)
  }
  const keys = Object.keys(edits) as BulkSectionKey[]
  if (!keys.length) return NextResponse.json({ error: 'Nothing to write — every section was left blank.' }, { status: 400 })
  const tooLong = lengthErrors(edits)
  if (tooLong.length) return NextResponse.json({ error: tooLong.join(' ') }, { status: 400 })

  const sb = supabaseAdmin()
  const all = await allListings(sb)
  const roster: Record<string, number> = {}
  for (const r of all) { const b = rollupBuilding(r.building, r.nickname || r.title); roster[b] = (roster[b] || 0) + 1 }

  const chosen = all.filter(r => listingIds.indexOf(String(r.id)) >= 0)
  if (!chosen.length) return NextResponse.json({ error: 'None of those listings are live.' }, { status: 400 })
  const targets = chosen.map(toTarget)

  // THE RULE. Checked against the real roster and the level the caller is standing on, not what
  // the client claims about either.
  const bad = scopeError(keys, targets, roster, scope)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const plan = planBulk(targets, edits)
  const writeIds = new Set(plan.rows.filter(r => r.action === 'write').map(r => r.id))
  if (!writeIds.size) {
    return NextResponse.json({ ok: true, okCount: 0, failCount: 0, unchanged: plan.unchanged, results: [], note: 'Every selected listing already says exactly this — nothing was sent to Guesty.' })
  }

  const tok = await token(sb)
  if (!tok) return NextResponse.json({ error: 'Guesty token unavailable — run a sync, then retry in a moment.' }, { status: 503 })

  const byId = new Map(chosen.map(r => [String(r.id), r]))
  const results: { id: string; name: string; ok: boolean; error?: string }[] = []
  let okCount = 0, failCount = 0
  let first = true

  for (const id of Array.from(writeIds)) {
    const row = byId.get(id)!
    const name = unitLabel(row as any)
    // Only the sections that actually differ on THIS listing. Guesty merges a partial
    // publicDescription, so a section left out is untouched.
    const mine: Record<string, string> = {}
    for (const r of plan.rows) if (r.id === id && r.action === 'write') mine[r.section] = r.after

    if (!first) await new Promise(res => setTimeout(res, GAP_MS))
    first = false
    try {
      const r = await fetch(`${BASE}/listings/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicDescription: mine }),
      })
      const text = await r.text().catch(() => '')
      if (!r.ok) { results.push({ id, name, ok: false, error: `Guesty ${r.status}: ${text.slice(0, 120)}` }); failCount++; continue }
      try {
        const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
        const newRaw = { ...raw, publicDescription: { ...pub(raw), ...mine }, _lastBulkCopy: new Date().toISOString() }
        await sb.from('guesty_listings').update({ raw: newRaw }).eq('id', id)
      } catch { /* the mirror is best-effort; Guesty is the record */ }
      results.push({ id, name, ok: true }); okCount++
    } catch (e: any) {
      results.push({ id, name, ok: false, error: e?.message || String(e) }); failCount++
    }
  }

  // The property keeps its own words (Jon said yes to this). Only the three property-scoped
  // sections are stored — Other notes is portfolio boilerplate and has no per-property meaning.
  const buildings = Array.from(new Set(targets.map(t => t.building)))
  if (saveStandard && scope === 'property' && buildings.length === 1 && okCount > 0) {
    const patch: any = { building: buildings[0], updated_by: who, updated_at: new Date().toISOString() }
    let any = false
    for (const k of STD_KEYS) if (edits[k]) { patch[k] = edits[k]; any = true }
    if (any) { try { await sb.from('property_copy_standards').upsert(patch, { onConflict: 'building' }) } catch { /* best effort */ } }
  }

  try {
    await sb.from('listing_copy_pushes').insert({
      by_email: who, scope, buildings, sections: keys,
      listing_count: writeIds.size, ok_count: okCount, fail_count: failCount,
    })
  } catch { /* the audit row never blocks the push */ }

  return NextResponse.json({
    ok: true, okCount, failCount, unchanged: plan.unchanged,
    sections: keys.map(k => sectionOf(k)?.label || k), results,
  })
}
