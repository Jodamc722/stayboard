// Per-unit occupancy / ADR / RevPAR over a window, for the Properties table.
//
// Conventions, stated once:
//   • live reservations only: confirmed / checked_in / checked_out / closed, cancellations excluded
//     (the same status rule as lib/kpi — settle Guesty `closed` there before changing it here)
//   • the window is [from, to] INCLUSIVE: every night from `from` through the night of `to`, and
//     a stay that straddles an edge contributes only its nights inside, money prorated to them
//   • room revenue = raw.money.fareAccommodationAdjusted, cleaning = fareCleaning, channel fee =
//     hostServiceFee, and the basis (lib/basis.ts) decides which of them count:
//       netota (DEFAULT) — accommodation before the channel fee: the ADR Home, Revenue Center and
//                          PriceLabs report (lib/kpi `adr`, room only since 2026-09-03)
//       net              — after the channel fee: the owner statement's Net
//       gross            — accommodation + cleaning: what the Botanica report quotes
//   • RevPAR = the same revenue ÷ available nights, so RevPAR = occupancy × ADR on every basis
//
// FIXED 2026-09-28 (audit P1-4): the window ran from `to − days` (days + 1 nights of denominator)
// while the night of `to` was never counted in the numerator, so occupancy and RevPAR read about
// 1/(days+1) low — ~3% on the 30-day view. And the default basis was Gross, described here as "what
// kpi.ts calls adr" — true until kpi's ADR became room only, after which Properties and Home quoted
// different ADRs for the same unit.
//
// PERF LAW (project-direct-booking-tracker): never select `raw->money` over thousands of rows — a
// whole-object select statement-timeouts. Only the four `->>` scalars below are pulled.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { basisTriple, type Basis, type BasisRaw } from '@/lib/basis'

const LIVE_RES = ['confirmed', 'checked_in', 'checked_out', 'closed']
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
const isCancelled = (s: any) => /cancel|declin|expir|denied|inquiry/i.test(str(s))

export const RES_SELECT = 'id,listing_id,check_in,check_out,nights,status,cleaning:raw->money->>fareCleaning,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,channelFee:raw->money->>hostServiceFee'

/** The basis the Properties table opens on — the same ADR as Home and Revenue Center. */
export const DEFAULT_BASIS: Basis = 'netota'

export type UnitRevenue = { revenue: number; adr: number; revpar: number; occupancy: number; nights: number; available: number }

function dOf(v: any): string { return str(v).slice(0, 10) }
function daysBetween(a: string, b: string): number {
  const t = (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000
  return Number.isFinite(t) ? Math.max(0, Math.round(t)) : 0
}
function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
}

/**
 * Occupancy / ADR / RevPAR per listing id over [from, to] (inclusive dates, YYYY-MM-DD).
 * A stay that straddles the window edge contributes only the nights inside it, with its money
 * prorated to those nights — otherwise a single long stay would distort a short window.
 */
export async function unitRevenue(from: string, to: string, basis: Basis = DEFAULT_BASIS): Promise<Record<string, UnitRevenue>> {
  const db = supabaseAdmin()
  const toExcl = addDays(to, 1)                    // nights run through the night of `to`
  const windowNights = daysBetween(from, toExcl)
  // Paged to completion, ordered, live statuses filtered in the database — a 12-month window is
  // over ten thousand stays. A short read throws: the page shows "Revenue did not load" rather
  // than a table of quietly low occupancies.
  const { rows, truncated } = await pageRows<any>((a, b) => db.from('guesty_reservations')
    .select(RES_SELECT)
    .in('status', LIVE_RES)
    .gte('check_out', from).lte('check_in', to)
    .order('check_out').order('id').range(a, b), Math.ceil((windowNights + 30) * 50 / 1000) + 2)
  if (truncated) throw new Error('unit revenue: the reservations read came back short')

  const acc: Record<string, BasisRaw> = {}

  for (const r of rows) {
    if (isCancelled(r.status)) continue
    if (LIVE_RES.indexOf(str(r.status).toLowerCase()) < 0) continue
    const id = str(r.listing_id); if (!id) continue
    const ci = dOf(r.check_in), co = dOf(r.check_out)
    if (!ci || !co) continue

    const total = Number(r.nights) > 0 ? Number(r.nights) : daysBetween(ci, co)
    if (total <= 0) continue
    // Nights of this stay that land inside the window — through the night of `to`.
    const s = ci > from ? ci : from
    const e = co < toExcl ? co : toExcl
    const inWindow = Math.min(total, daysBetween(s, e))
    if (inWindow <= 0) continue
    const share = inWindow / total

    const a = (acc[id] ||= { accomNum: 0, accomGrossNum: 0, cleaningNum: 0, feeNum: 0, occNights: 0, availNights: windowNights })
    a.accomNum += num(r.fareBase) * share
    a.accomGrossNum += num(r.fare) * share
    a.cleaningNum += num(r.cleaning) * share
    a.feeNum = (a.feeNum || 0) + num(r.channelFee) * share
    a.occNights += inWindow
  }

  const out: Record<string, UnitRevenue> = {}
  for (const [id, a] of Object.entries(acc)) {
    const t = basisTriple(a, basis)
    out[id] = {
      revenue: t.revenue, adr: t.adr, revpar: t.revpar,
      nights: a.occNights, available: a.availNights,
      occupancy: a.availNights ? Math.round((a.occNights / a.availNights) * 1000) / 10 : 0,
    }
  }
  return out
}

// Window presets offered on the Properties page. Each one is its own cache entry, so keep the list short.
export const REV_WINDOWS = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
]
export function windowFor(v?: string) { return REV_WINDOWS.find(w => w.key === v) || REV_WINDOWS[1] }
/** `days` nights ending with the night of `todayIso` (an Eastern date): [today − (days − 1), today]. */
export function windowRange(days: number, todayIso: string): { from: string; to: string } {
  const to = todayIso
  return { from: addDays(to, -(Math.max(1, days) - 1)), to }
}
