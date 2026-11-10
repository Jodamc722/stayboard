// DOES THE BRAIN AGREE WITH REVENUE CENTER? (2026-11-10, GET /api/brain/reconcile?month=YYYY-MM)
//
// For one calendar month, per building and in total: guest nights, owner nights and net
// accommodation, worked out twice —
//   REVENUE CENTER  exactly the way app/revenue/page.tsx works out a month: the same pull (live
//                   statuses, check-out after the 1st, check-in before the next 1st, ordered by id),
//                   the same components (lib/brain/rc-rules: adjusted fare else base fare, THE ONE
//                   NET, the Expedia cleaning split over the same pull), the same proration (nights
//                   in the month ÷ the stay's nights) and the same listing scope (not dead, not "Full").
//                   The page keeps those helpers private and the brain may not edit it, so they are
//                   restated in rc-rules — the one copy both this check and the builder use.
//   THE BRAIN       fact_unit_day summed over the same days and the same listings.
// — and the difference, in dollars and %. For the three buildings that differ most, the stays that
// explain it are listed side by side. Brain rows on listings Revenue Center leaves out (dead or
// "Full") are reported apart, never mixed into the difference.
//
// A cross-check from lib/unit-revenue (the Properties table's shared builder) rides along: it has
// no Expedia split and no owner split, so it is expected to sit a little above both on net.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LIVE_STAY_STATUSES, channelFeeOf } from '@/lib/basis'
import { isOwnerOrFriendsFamily } from '@/lib/owner-audit'
import { unitRevenue } from '@/lib/unit-revenue'
import { loadUnits } from './spine'
import { rcExpediaSplit, rcGrossAccom, rcOutOfScopeReason, type RcStay } from './rc-rules'
import { str, dOf, addDays, daysBetween, round2, todayET, monthEndOf, pageRead } from './shared'

type Fig = { guestNights: number; ownerNights: number; net: number }
const zero = (): Fig => ({ guestNights: 0, ownerNights: 0, net: 0 })
const rounded = (f: Fig): Fig => ({ guestNights: f.guestNights, ownerNights: f.ownerNights, net: round2(f.net) })
const diffOf = (brain: Fig, rc: Fig) => ({
  guestNights: brain.guestNights - rc.guestNights,
  ownerNights: brain.ownerNights - rc.ownerNights,
  net: round2(brain.net - rc.net),
  netPct: rc.net !== 0 ? round2(((brain.net - rc.net) / Math.abs(rc.net)) * 100) : null,
})

export type ReconStay = {
  reservationId: string; listingId: string; unit: string; checkIn: string; checkOut: string; source: string
  rcNights: number; rcNet: number; brainNights: number; brainNet: number; diffNet: number; why: string
}

const n0 = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export async function reconcileMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM')
  const db = supabaseAdmin()
  const today = todayET()
  const from = month + '-01'
  const lastDay = monthEndOf(from)
  if (from > today) throw new Error('that month has not started')
  const to = lastDay < today ? lastDay : today
  const toExcl = addDays(to, 1)
  const closed = lastDay < today

  // Listings, as Revenue Center reads them (every status; it filters in code).
  const { data: lrows, error: lerr } = await db.from('guesty_listings').select('id,nickname,title,status').limit(1000) // deliberate cap: one row per listing, ~300
  if (lerr) throw new Error('listings did not load: ' + lerr.message)
  const listing: Record<string, any> = {}
  for (const l of ((lrows || []) as any[])) listing[str(l.id)] = l
  const scopeOf = (lid: string): 'in' | 'inactive' | 'full' | 'unknown' => {
    const l = listing[lid]
    if (!l) return 'unknown'
    return rcOutOfScopeReason(l) || 'in'
  }
  const nameOf = (lid: string) => { const l = listing[lid]; return l ? str(l.nickname || l.title || lid) : lid }

  // Buildings: the brain's own (dim_unit), applied to BOTH sides so labels cannot cause a difference.
  const { byId } = await loadUnits()
  const bLabel: Record<string, string> = {}
  try {
    const { data } = await db.from('dim_building').select('id,label').limit(200) // deliberate cap: one row per building (~30)
    for (const b of ((data || []) as any[])) bLabel[str(b.id)] = str(b.label)
  } catch { /* ids stand in */ }
  const buildingOf = (lid: string) => (byId[lid] && byId[lid].building_id) || 'unassigned'

  // ── REVENUE CENTER, as the page computes a month ─────────────────────────────────────────────
  const RC_COLS = 'id,listing_id,check_in,check_out,nights,status,source,guest_name,'
    + 'fare:raw->money->>fareAccommodation,grossFare:raw->money->>fareAccommodationAdjusted,cleaningFee:raw->money->>fareCleaning,'
    + 'hostFee:raw->money->>hostServiceFeeIncTax,hostFeeEx:raw->money->>hostServiceFee,tags:raw->tags'
  const pull = await pageRead<any>((a, b) => db.from('guesty_reservations').select(RC_COLS)
    .in('status', LIVE_STAY_STATUSES).gt('check_out', from).lt('check_in', toExcl)
    .order('id').range(a, b), 30)
  if (pull.truncated || pull.missing) throw new Error('reservations did not load whole: ' + (pull.error || 'short read'))
  type S = RcStay & { id: string; ci: string; co: string; nights: number; owner: boolean }
  const stays: S[] = []
  for (const r of pull.rows) {
    if (!r.check_in || !r.check_out || !r.listing_id) continue
    const ci = dOf(r.check_in), co = dOf(r.check_out)
    const grossAccom = rcGrossAccom(r.grossFare, r.fare)
    const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
    stays.push({
      id: str(r.id), listingId: str(r.listing_id), ci, co,
      nights: Math.max(1, n0(r.nights) || daysBetween(ci, co)),
      source: String(r.source || 'other'),
      grossAccom, netAccom: grossAccom - channelFeeOf(r.hostFee, r.hostFeeEx), cleaning: n0(r.cleaningFee),
      owner: isOwnerOrFriendsFamily(String(r.source || ''), tagBlob, String(r.guest_name || '')),
    })
  }
  rcExpediaSplit(stays)

  const rcTotal = zero()
  const rcBy: Record<string, Fig> = {}
  const rcStay: Record<string, { nights: number; net: number; s: S }> = {}
  const nightHolders: Record<string, number> = {}            // listing|day -> in-scope stays holding it
  for (const x of stays) {
    if (scopeOf(x.listingId) !== 'in') continue
    const s = x.ci > from ? x.ci : from
    const e = x.co < toExcl ? x.co : toExcl
    const n = Math.max(0, daysBetween(s, e))
    if (n <= 0) continue
    const share = n / x.nights
    const b = rcBy[buildingOf(x.listingId)] = rcBy[buildingOf(x.listingId)] || zero()
    for (const f of [rcTotal, b]) {
      if (x.owner) f.ownerNights += n; else f.guestNights += n
      f.net += x.netAccom * share
    }
    rcStay[x.id] = { nights: n, net: x.netAccom * share, s: x }
    for (let d = s; d < e; d = addDays(d, 1)) nightHolders[x.listingId + '|' + d] = (nightHolders[x.listingId + '|' + d] || 0) + 1
  }

  // ── THE BRAIN ────────────────────────────────────────────────────────────────────────────────
  const fr = await pageRead<any>((a, b) => db.from('fact_unit_day').select('day,listing_id,state,reservation_id,net_accom,built_at')
    .gte('day', from).lte('day', to).order('day').order('listing_id').range(a, b), 20)
  if (fr.missing) throw new Error('fact_unit_day is not there — run migration 178')
  const brainTotal = zero()
  const brainBy: Record<string, Fig> = {}
  const outOfScope: Record<string, Fig> = { inactive: zero(), full: zero(), unknown: zero() }
  const brainStay: Record<string, { nights: number; net: number }> = {}
  let builtFrom = '', builtTo = ''
  let rowsN = 0
  for (const r of fr.rows) {
    rowsN++
    const at = str(r.built_at)
    if (at && (!builtFrom || at < builtFrom)) builtFrom = at
    if (at && at > builtTo) builtTo = at
    const state = str(r.state)
    if (state !== 'occupied' && state !== 'owner_stay') continue
    const lid = str(r.listing_id)
    const scope = scopeOf(lid)
    const net = n0(r.net_accom)
    const targets: Fig[] = scope === 'in'
      ? [brainTotal, brainBy[buildingOf(lid)] = brainBy[buildingOf(lid)] || zero()]
      : [outOfScope[scope]]
    for (const f of targets) {
      if (state === 'owner_stay') f.ownerNights += 1; else f.guestNights += 1
      f.net += net
    }
    if (scope === 'in' && r.reservation_id) {
      const k = str(r.reservation_id)
      const bs = brainStay[k] = brainStay[k] || { nights: 0, net: 0 }
      bs.nights += 1; bs.net += net
    }
  }

  // Nights two in-scope stays both hold: Revenue Center counts them twice, the brain once.
  const doubleBooked: { listingId: string; unit: string; day: string; stays: number }[] = []
  for (const k of Object.keys(nightHolders)) {
    if (nightHolders[k] < 2) continue
    const cut = k.indexOf('|')
    const lid = k.slice(0, cut)
    doubleBooked.push({ listingId: lid, unit: nameOf(lid), day: k.slice(cut + 1), stays: nightHolders[k] })
  }
  doubleBooked.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.unit.localeCompare(b.unit))

  // ── PER BUILDING, AND THE THREE THAT DIFFER MOST ─────────────────────────────────────────────
  const ids = Array.from(new Set(Object.keys(rcBy).concat(Object.keys(brainBy))))
  const buildings = ids.map(id => {
    const rc = rcBy[id] || zero(), brain = brainBy[id] || zero()
    return { building_id: id, label: bLabel[id] || id, rc: rounded(rc), brain: rounded(brain), diff: diffOf(brain, rc) }
  }).sort((a, b) => Math.abs(b.diff.net) - Math.abs(a.diff.net) || Math.abs(b.diff.guestNights + b.diff.ownerNights) - Math.abs(a.diff.guestNights + a.diff.ownerNights))

  const doubledStay: Record<string, boolean> = {}
  for (const x of stays) {
    if (!rcStay[x.id]) continue
    const s = x.ci > from ? x.ci : from
    const e = x.co < toExcl ? x.co : toExcl
    for (let d = s; d < e; d = addDays(d, 1)) if ((nightHolders[x.listingId + '|' + d] || 0) > 1) { doubledStay[x.id] = true; break }
  }
  const explain = buildings.filter(b => b.diff.net !== 0 || b.diff.guestNights !== 0 || b.diff.ownerNights !== 0).slice(0, 3).map(b => {
    const resIds = new Set<string>()
    for (const id of Object.keys(rcStay)) if (buildingOf(rcStay[id].s.listingId) === b.building_id) resIds.add(id)
    for (const r of fr.rows) {
      const lid = str(r.listing_id)
      if (r.reservation_id && scopeOf(lid) === 'in' && buildingOf(lid) === b.building_id) resIds.add(str(r.reservation_id))
    }
    const lines: ReconStay[] = []
    resIds.forEach(id => {
      const rc = rcStay[id], br = brainStay[id] || { nights: 0, net: 0 }
      const rcNights = rc ? rc.nights : 0, rcNet = rc ? rc.net : 0
      const d = round2(br.net - rcNet)
      if (Math.abs(d) < 0.01 && br.nights === rcNights) return
      const s = rc ? rc.s : null
      let why: string
      if (!rc) why = 'in the brain, not on Revenue Center — the stay was cancelled, moved or re-priced after this month was built; the next rebuild clears it'
      else if (!br.nights) why = doubledStay[id] ? 'shares its nights with another stay (double booking) — its money sits on the other stay\'s rows' : 'on Revenue Center, not in the brain — booked or changed after this month was built'
      else if (doubledStay[id]) why = 'double-booked nights: Revenue Center counts each night twice, the brain once (the money of both stays is on the brain\'s rows)'
      else if (br.nights !== rcNights) why = 'night count differs — the dates changed after this month was built'
      else if (s && s.split) why = 'Expedia cleaning split differs (' + s.split + ' moved out on Revenue Center) — this month was built before month-aligned chunks; the next rebuild agrees'
      else why = 'money differs — the folio changed after this month was built'
      lines.push({
        reservationId: id, listingId: s ? s.listingId : '', unit: s ? nameOf(s.listingId) : '',
        checkIn: s ? s.ci : '', checkOut: s ? s.co : '', source: s ? s.source : '',
        rcNights, rcNet: round2(rcNet), brainNights: br.nights, brainNet: round2(br.net), diffNet: d, why,
      })
    })
    lines.sort((a, z) => Math.abs(z.diffNet) - Math.abs(a.diffNet) || Math.abs(z.brainNights - z.rcNights) - Math.abs(a.brainNights - a.rcNights))
    return { building_id: b.building_id, label: b.label, diff: b.diff, stays: lines.slice(0, 12), more: Math.max(0, lines.length - 12) }
  })

  // ── THE SHARED BUILDER, AS A CROSS-CHECK ─────────────────────────────────────────────────────
  let shared: { guestAndOwnerNights: number; net: number; note: string } | { error: string }
  try {
    const ur = await unitRevenue(from, to, 'net')
    let nights = 0, net = 0
    for (const lid of Object.keys(ur)) { if (scopeOf(lid) !== 'in') continue; nights += ur[lid].nights; net += ur[lid].revenue }
    shared = { guestAndOwnerNights: nights, net: round2(net), note: 'lib/unit-revenue unitRevenue(from, to, net): whole-dollar per listing, no Expedia cleaning split, owner nights not separated' }
  } catch (e: any) { shared = { error: str(e?.message || e).slice(0, 200) } }

  return {
    ok: true,
    month, from, to, closed,
    note: closed
      ? 'A closed month: the two should agree to the dollar, except for the double-booked nights listed (Revenue Center counts them twice).'
      : 'An open month: compared through ' + to + ' only. Tonight is on both sides; stays booked since the last build differ until the next one.',
    totals: { rc: rounded(rcTotal), brain: rounded(brainTotal), diff: diffOf(brainTotal, rcTotal) },
    brainOutsideRevenueCenter: {
      inactiveListings: rounded(outOfScope.inactive), fullListings: rounded(outOfScope.full), unknownListings: rounded(outOfScope.unknown),
      why: 'Revenue Center leaves out stays on dead listings and on "Full" whole-unit listings; the brain keeps them (the money is real) and they are shown here, not in the difference.',
    },
    buildings,
    explain,
    doubleBooked: doubleBooked.slice(0, 60), doubleBookedNights: doubleBooked.length,
    sharedBuilder: shared,
    brain: { rows: rowsN, short: fr.truncated, builtFrom: builtFrom || null, builtTo: builtTo || null },
    rcStays: stays.length,
  }
}
