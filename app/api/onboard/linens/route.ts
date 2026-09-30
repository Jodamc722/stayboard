// LINENS API (Jon, 2026-09-29) — the linen standard and the units it sizes. The arithmetic and the
// shapes live in lib/linens.ts; this route only reads and writes them.
//
//   GET                                         view  → { ok, level, standard, edited, units, partial }
//   PUT { standard }                            full  → saves the standard (normalised, stamped with who/when)
//   PUT { unitBeds: { listingId, beds } }       edit  → saves one unit's bed sizes; beds null / {} clears them
//
// Storage is app_settings (no migration): `linen_standard` and `linen_unit_beds`
// ({ [listingId]: { King: 1, Queen: 2 } }).
//
// WHERE A UNIT'S BEDS COME FROM, first hit wins:
//   1. saved here (linen_unit_beds)                                            → 'saved'
//   2. Guesty's listing rooms, raw.listingRooms[].beds[] { type, quantity }     → 'guesty'
//   3. an onboarding unit's pre-form (details.beds by size, sleeperSofa)        → 'onboarding'
//   4. one Queen per bedroom, a studio counted as one                           → 'assumed'
//
// Units are the live VR listings (inactive ones and "Full …" combo listings left out — a combo sells
// units that are already listings of their own) plus onboarding units not yet assigned to a listing,
// with id `onboard:<code>`.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, type Gate } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting, setSetting } from '@/lib/app-settings'
import { pageRows } from '@/lib/db-page'
import { rollupBuilding } from '@/lib/optimize-score'
import {
  LINEN_STANDARD_KEY, LINEN_UNIT_BEDS_KEY, normLinenStandard, normBeds, bedsFromGuestyRooms, bedsFromOnboarding, assumedBeds,
  type LinenDeskUnit, type BedsSource,
} from '@/lib/linens'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEAD = /^(inactive|disabled|archived|deleted)$/i
const UNIT_ID = /^(onboard:)?[A-Za-z0-9_-]{1,64}$/
const MAX_SAVED_UNITS = 2000
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status })

/**
 * requireLevel on Onboarding, and a vacation-rental login — requireVrUser's question (lib/vr-gate.ts)
 * asked of the same access read, so the request resolves the signed-in user once, not twice.
 */
async function gate(need: 'view' | 'edit' | 'full'): Promise<Gate> {
  const g = await requireLevel('onboarding', need)
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}

/** Saved per-unit beds, every entry normalised (a hand-edited setting cannot break the page). */
function savedBedsMap(raw: any): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    if (!UNIT_ID.test(k)) continue
    const b = normBeds(v)
    if (Object.keys(b).length) out[k] = b
  }
  return out
}

export async function GET() {
  const g = await gate('view')
  if (!g.ok) return g.res
  try {
    const db = supabaseAdmin()
    const [savedStd, savedBedsRaw, listingRead, onboardRead] = await Promise.all([
      getSetting<any>(LINEN_STANDARD_KEY, null),
      getSetting<any>(LINEN_UNIT_BEDS_KEY, null),
      // Only the columns the calculator reads, and only the rooms sub-field of raw (never raw whole).
      pageRows<any>((a, b) => db.from('guesty_listings')
        .select('id,nickname,title,building,bedrooms,bathrooms,beds,max_occupancy,status,rooms:raw->listingRooms')
        .order('id').range(a, b), 3),
      // Not yet live: onboarding links with no listing assigned. A link is minted per new unit.
      Promise.resolve(db.from('onboarding_units').select('id,code,name,building,details,status,listing_id')
        .neq('status', 'archived').is('listing_id', null).order('created_at', { ascending: false }).limit(300))
        .then((r: any) => (r && !r.error && Array.isArray(r.data) ? r.data : []), () => []),
    ])
    if (listingRead.truncated && !listingRead.rows.length) return fail('Could not read the listings — try again.', 502)
    const saved = savedBedsMap(savedBedsRaw)
    const units: LinenDeskUnit[] = []

    for (const l of listingRead.rows) {
      const name = str(l.nickname || l.title || l.id)
      if (!name || DEAD.test(str(l.status)) || /\bfull\b/i.test(name)) continue
      const id = String(l.id)
      const bedrooms = Math.round(num(l.bedrooms))
      const guesty = bedsFromGuestyRooms(l.rooms)
      const auto: [Record<string, number>, BedsSource] = Object.keys(guesty).length ? [guesty, 'guesty'] : [assumedBeds(bedrooms), 'assumed']
      const mine = saved[id]
      units.push({
        id, name, building: rollupBuilding(l.building, name), bedrooms, bathrooms: num(l.bathrooms), guests: Math.round(num(l.max_occupancy)),
        beds: mine || auto[0], bedsSource: mine ? 'saved' : auto[1], autoBeds: auto[0], autoSource: auto[1], live: true,
      })
    }

    for (const u of onboardRead as any[]) {
      const code = str(u.code).toLowerCase()
      const name = str(u.name)
      if (!code || !name) continue
      const id = 'onboard:' + code
      if (!UNIT_ID.test(id)) continue
      const d = u.details && typeof u.details === 'object' ? u.details : {}
      const bedrooms = Math.round(num(d.bedrooms))
      const walked = bedsFromOnboarding(d)
      const auto: [Record<string, number>, BedsSource] = Object.keys(walked).length ? [walked, 'onboarding'] : [assumedBeds(bedrooms), 'assumed']
      const mine = saved[id]
      units.push({
        id, name, building: rollupBuilding(u.building, name), bedrooms, bathrooms: num(d.bathrooms), guests: Math.round(num(d.occupancy)),
        beds: mine || auto[0], bedsSource: mine ? 'saved' : auto[1], autoBeds: auto[0], autoSource: auto[1], live: false,
      })
    }

    units.sort((a, b) => String(a.building || '').localeCompare(String(b.building || '')) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    return NextResponse.json({
      ok: true,
      level: g.access.levels['onboarding'] || 'view',
      standard: normLinenStandard(savedStd),
      edited: !!savedStd,
      units,
      partial: listingRead.truncated,
    })
  } catch (e: any) {
    return fail(String(e?.message || e).slice(0, 200), 500)
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send { standard } or { unitBeds }.', 400)

  if ('standard' in body) {
    const g = await gate('full')
    if (!g.ok) return g.res
    try {
      const s = body.standard
      // The whole standard, or nothing: a body without an item list is a mistake, not "empty it".
      if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.items)) return fail('Send the whole standard (par, bed sizes and items).', 400)
      const who = g.access.email || ''
      const standard = normLinenStandard({ ...s, updatedAt: new Date().toISOString(), updatedBy: who })
      const r = await setSetting(LINEN_STANDARD_KEY, standard, who || null)
      if (!r.ok) return fail(r.error || 'Could not save the standard.', 500)
      return NextResponse.json({ ok: true, standard, edited: true })
    } catch (e: any) {
      return fail(String(e?.message || e).slice(0, 200), 500)
    }
  }

  if ('unitBeds' in body) {
    const g = await gate('edit')
    if (!g.ok) return g.res
    try {
      const ub = body.unitBeds && typeof body.unitBeds === 'object' ? body.unitBeds : {}
      const listingId = str(ub.listingId)
      if (!UNIT_ID.test(listingId)) return fail('That is not a unit id.', 400)
      const beds = ub.beds == null ? {} : normBeds(ub.beds)
      // Read-modify-write from the table itself, not getSetting's 60-second cache: two people setting
      // beds on different units from different server instances must not undo each other.
      const { data, error } = await supabaseAdmin().from('app_settings').select('value').eq('key', LINEN_UNIT_BEDS_KEY).limit(1)
      if (error) return fail('Could not read the saved beds — try again.', 502)
      let cur: any = null
      const raw = Array.isArray(data) && data[0] ? (data[0] as any).value : null
      if (raw && typeof raw === 'object') cur = raw
      else if (typeof raw === 'string' && raw) { try { cur = JSON.parse(raw) } catch { cur = null } }
      const map = savedBedsMap(cur)
      if (Object.keys(beds).length) map[listingId] = beds
      else delete map[listingId]
      if (Object.keys(map).length > MAX_SAVED_UNITS) return fail('Too many units with saved beds.', 400)
      const r = await setSetting(LINEN_UNIT_BEDS_KEY, map, g.access.email || null)
      if (!r.ok) return fail(r.error || 'Could not save the beds.', 500)
      return NextResponse.json({ ok: true, listingId, beds: map[listingId] || null })
    } catch (e: any) {
      return fail(String(e?.message || e).slice(0, 200), 500)
    }
  }

  return fail('Send { standard } or { unitBeds }.', 400)
}
