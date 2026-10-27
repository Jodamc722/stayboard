// WHAT PROPERTIES LIKE YOURS EARN — the maths behind the sales deck's proof slide.
//
// Lifted out of /api/reports/proof so the generator can fill the slide at the moment a deck is
// made: a proposal for a building we already run should arrive carrying that building's real
// numbers, not an empty table and an instruction to go and press a button.
//
// REVENUE ONLY, AND THAT IS STRUCTURAL. This reads the reservation mirror and nothing else, so
// there is no commission, labour or owner-ledger figure in reach of it. The owner statement would
// have been the wrong source for exactly that reason: its shape is income minus the expenses we
// have no business showing someone who is not that owner. Gross and net come from basisTriple()
// on the same raw components every owner report carries, so a prospect who later becomes an owner
// cannot find a different number for the same unit on their own report.
import { pullReservations, metricsFor, fmtK } from './owner-report'
import { basisTriple } from './basis'
import { rollupBuilding } from './optimize-score'
import { supabaseAdmin } from './supabase-admin'

export type ProofRow = { label: string; sub: string; gross: string; net: string; occ: string; adr: string; nights: string }
export type ProofTotals = { gross: string; net: string; occ: string; adr: string; nights: string }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
export function monthLabel(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The active, non-combined listings of a building or an explicit set. */
export async function proofListings(opts: { listingIds?: string[]; building?: string }) {
  const db = supabaseAdmin()
  const ids = (opts.listingIds || []).map(String).filter(Boolean)
  const wantB = str(opts.building).toLowerCase()
  const { data } = await db.from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status').limit(1000)
  return ((data || []) as any[]).filter(l => {
    const st = str(l.status).toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) return false
    // A combined "Full" listing is the same apartment sold a second way; counting it beside its
    // halves would double a building's revenue on the one slide meant to prove we can be trusted
    // with numbers.
    if (/\bfull\b/i.test(str(l.nickname || l.title || l.id))) return false
    if (ids.length) return ids.indexOf(String(l.id)) >= 0
    if (wantB) return rollupBuilding(str(l.building)).toLowerCase() === wantB
    return false
  })
}

export async function proofRows(listings: any[], from: string, to: string): Promise<{ rows: ProofRow[]; totals: ProofTotals }> {
  const toExcl = nextDay(to)
  const useIds = listings.map(l => String(l.id))
  const resv = await pullReservations(useIds, from, toExcl)
  const byId: Record<string, any[]> = {}
  for (const r of resv) { (byId[r.listing_id] = byId[r.listing_id] || []).push(r) }
  const pct = (n: number) => Math.round(n) + '%'
  const rows = listings.map(l => {
    const m = metricsFor(byId[String(l.id)] || [], 1, from, toExcl)
    const raw = {
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
    }
    const g = basisTriple(raw, 'gross'), n = basisTriple(raw, 'net')
    const br = l.bedrooms == null ? '' : (Number(l.bedrooms) === 0 ? 'Studio' : Number(l.bedrooms) + 'BR')
    const unit = str(l.unit)
    return {
      label: [br, unit ? 'Unit ' + unit : ''].filter(Boolean).join(' \u00b7 ') || str(l.nickname || l.title),
      sub: rollupBuilding(str(l.building)),
      gross: fmtK(g.revenue), net: fmtK(n.revenue),
      occ: pct(m.occupancyPct), adr: '$' + g.adr, nights: String(m.occupiedNights),
      _gross: g.revenue, _net: n.revenue, _occNights: m.occupiedNights, _availNights: m.availableNights,
    }
  }).sort((a, b) => b._gross - a._gross)
  const sum = (k: '_gross' | '_net' | '_occNights' | '_availNights') => rows.reduce((a, r) => a + r[k], 0)
  const nights = sum('_occNights')
  const totals: ProofTotals = {
    gross: fmtK(sum('_gross')), net: fmtK(sum('_net')),
    occ: sum('_availNights') ? pct((sum('_occNights') / sum('_availNights')) * 100) : '\u2014',
    adr: nights ? '$' + Math.round(sum('_gross') / nights) : '\u2014',
    nights: String(nights),
  }
  return { rows: rows.map(({ _gross, _net, _occNights, _availNights, ...r }) => r), totals }
}
