// Per-unit occupancy / ADR / RevPAR over a window, for the Properties table.
//
// It deliberately reuses the EXACT conventions lib/kpi.ts (the Revenue page) already uses, so
// Properties, Revenue and the Botanica owner report can never quietly disagree:
//   • live reservations only: confirmed / checked_in / checked_out / closed, cancellations excluded
//   • room revenue = raw.money.fareAccommodationAdjusted ("net accom"), cleaning = fareCleaning
//   • ADR = (room + cleaning) / occupied nights, cleaning SPREAD PER NIGHT
//   • RevPAR = (room + cleaning) / available nights
// The revenue basis (Net / Net + fees / Gross) comes from lib/basis.ts, so the same numbers can be
// read the way the owner statement reads them. GROSS is the default here because that is what the
// Botanica report quotes and what kpi.ts calls `adr`.
//
// PERF LAW (project-direct-booking-tracker): never select `raw->money` over thousands of rows — a
// whole-object select statement-timeouts. Only the four `->>` scalars below are pulled.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { basisTriple, type Basis, type BasisRaw } from '@/lib/basis'

const LIVE_RES = ['confirmed', 'checked_in', 'checked_out', 'closed']
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
const isCancelled = (s: any) => /cancel|declin|expir|denied|inquiry/i.test(str(s))

export const RES_SELECT = 'listing_id,check_in,check_out,nights,status,cleaning:raw->money->>fareCleaning,fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,channelFee:raw->money->>hostServiceFee'

export type UnitRevenue = { revenue: number; adr: number; revpar: number; occupancy: number; nights: number; available: number }

function dOf(v: any): string { return str(v).slice(0, 10) }
function daysBetween(a: string, b: string): number {
  const t = (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000
  return Number.isFinite(t) ? Math.max(0, Math.round(t)) : 0
}

async function pageAll(build: (from: number, to: number) => any, maxPages = 14): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999)
    if (error) break
    const rows = (data || []) as any[]
    out.push.apply(out, rows)
    if (rows.length < 1000) break
  }
  return out
}

/**
 * Occupancy / ADR / RevPAR per listing id over [from, to] (inclusive dates, YYYY-MM-DD).
 * A stay that straddles the window edge contributes only the nights inside it, with its money
 * prorated to those nights — otherwise a single long stay would distort a short window.
 */
export async function unitRevenue(from: string, to: string, basis: Basis = 'gross'): Promise<Record<string, UnitRevenue>> {
  const db = supabaseAdmin()
  const rows = await pageAll((a, b) => db.from('guesty_reservations')
    .select(RES_SELECT)
    .gte('check_out', from).lte('check_in', to)
    .order('check_out').range(a, b))

  const windowNights = daysBetween(from, to) + 1
  const acc: Record<string, BasisRaw> = {}

  for (const r of rows) {
    if (isCancelled(r.status)) continue
    if (LIVE_RES.indexOf(str(r.status).toLowerCase()) < 0) continue
    const id = str(r.listing_id); if (!id) continue
    const ci = dOf(r.check_in), co = dOf(r.check_out)
    if (!ci || !co) continue

    const total = Number(r.nights) > 0 ? Number(r.nights) : daysBetween(ci, co)
    if (total <= 0) continue
    // Nights of this stay that land inside the window.
    const s = ci > from ? ci : from
    const e = co < to ? co : to
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
export function windowRange(days: number, todayIso: string): { from: string; to: string } {
  const to = todayIso
  const d = new Date(Date.parse(to + 'T00:00:00Z') - days * 86400_000)
  return { from: d.toISOString().slice(0, 10), to }
}
