// FOLIO FIXES REACH THE STATEMENT AUDIT ON THEIR OWN (Jon, 2026-10-21: "if we fix the folio it
// should update the report").
//
// The Expedia fee breakout on the Statements desk reads each booking's guest folio out of the
// reservation mirror (guesty_reservations.raw.money.invoiceItems). When someone splits the fees on
// the reservation in Guesty, the mirror learns about it only when the 5-minute booking feed happens
// to re-pull that reservation, or when a signed-in person presses "Re-check Guesty". A folio edit
// does not reliably move the reservation's lastUpdatedAt, so the feed can miss it for a day — and
// the row keeps saying "fees not set up" after the fix was made.
//
// So the open folios are re-pulled on their own: every Expedia-family booking in this month and
// last month whose folio is NOT yet split (those are the only ones a fix would change) is pulled
// fresh from Guesty, hourly from the booking feed, and on demand (throttled) when the desk opens.
// A split folio needs no second look; it is already right. Bounded: at most MAX_IDS a run.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pullReservationsByIds } from './guesty'
import { getSetting, setSetting } from './app-settings'
import { recordRun } from './automation-runs'
import { EXPEDIA_RE } from './owner-audit'

export const FOLIO_REFRESH_AT_KEY = 'folio_refresh_at'
const MAX_IDS = 150
const PAGE = 1000
const CLEAN_RE = /clean/i
const RM_RE = /revenue|\brm\b/i

export type FolioRefresh = {
  ran: boolean
  reason?: string
  months: string[]
  candidates: number
  pulled: number
  /** Folios that read as split after the pull and did not before — the fixes this run surfaced. */
  fixed: number
  ms: number
}

function ymdET(d: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
/** This month and last month, as 'YYYY-MM', in Eastern time. */
export function openMonths(now = new Date()): string[] {
  const cur = ymdET(now).slice(0, 7)
  const [y, m] = cur.split('-').map(Number)
  const prev = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0')
  return [prev, cur]
}
function monthSpan(months: string[]): { start: string; endExcl: string } {
  const sorted = [...months].sort()
  const [y, m] = sorted[sorted.length - 1].split('-').map(Number)
  const endExcl = m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01'
  return { start: sorted[0] + '-01', endExcl }
}

/** The folio as the desk reads it: is the fee split already on it? */
export function folioSplit(inv: any): boolean {
  if (!Array.isArray(inv) || !inv.length) return false
  const title = (x: any) => String(x?.title || x?.name || '')
  const amt = (x: any) => Number(x?.amount) || 0
  const clean = inv.filter(x => CLEAN_RE.test(title(x))).reduce((a, x) => a + amt(x), 0)
  const rm = inv.filter(x => !CLEAN_RE.test(title(x)) && RM_RE.test(title(x))).reduce((a, x) => a + amt(x), 0)
  return clean > 0.5 && rm > 0.5
}

/** Expedia-family bookings in the open months whose folio is not split yet: id → split now? */
async function openFolios(months: string[]): Promise<Record<string, boolean>> {
  const sb = supabaseAdmin()
  const { start, endExcl } = monthSpan(months)
  const out: Record<string, boolean> = {}
  for (let off = 0; off < 20_000; off += PAGE) {
    const { data, error } = await sb.from('guesty_reservations')
      .select('id, source, status, inv:raw->money->invoiceItems')
      .gt('check_out', start).lt('check_in', endExcl)
      .not('status', 'in', '(canceled,cancelled,inquiry,declined,expired)')
      .or('source.ilike.%expedia%,source.ilike.%orbitz%,source.ilike.%travelocity%,source.ilike.%hotels%,source.ilike.%wotif%,source.ilike.%ebookers%,source.ilike.%cheaptickets%')
      .order('id').range(off, off + PAGE - 1)
    if (error) throw new Error('reservations: ' + error.message)
    const rows = (data || []) as any[]
    for (const r of rows) {
      if (!EXPEDIA_RE.test(String(r.source || ''))) continue
      out[String(r.id)] = folioSplit(r.inv)
    }
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * Re-pull the open folios. `minMinutes` is the throttle between runs (the hourly feed passes 55,
 * the desk's own check passes 10); `force` ignores it. Writes a receipt ('folio-refresh') on every
 * real run so the Health page and Eve can say when folios were last checked and how many had been fixed.
 */
export async function refreshOpenFolios(opts: { minMinutes?: number; force?: boolean; source?: string } = {}): Promise<FolioRefresh> {
  const t0 = Date.now()
  const months = openMonths()
  const minMs = Math.max(0, (opts.minMinutes ?? 55) * 60_000)
  if (!opts.force && minMs) {
    // An OBJECT, not a bare string: getSetting hands back only JSON objects (a bare string parses
    // to a string and falls through to the default), which is how the first cut of this throttle
    // never throttled — every open of the desk re-pulled all 133 folios two minutes after the feed had.
    const last = await getSetting<{ at?: string }>(FOLIO_REFRESH_AT_KEY, {})
    const lastMs = last && last.at ? Date.parse(String(last.at)) : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < minMs) {
      return { ran: false, reason: 'checked ' + Math.round((Date.now() - lastMs) / 60_000) + ' min ago', months, candidates: 0, pulled: 0, fixed: 0, ms: Date.now() - t0 }
    }
  }
  // Claim the slot before the pull so two instances do not both spend the budget.
  await setSetting(FOLIO_REFRESH_AT_KEY, { at: new Date().toISOString() }, null)
  try {
    const before = await openFolios(months)
    const ids = Object.keys(before).filter(id => !before[id]).slice(0, MAX_IDS)
    let pulled = 0, fixed = 0
    if (ids.length) {
      pulled = await pullReservationsByIds(ids)
      const after = await openFolios(months)
      for (const id of ids) if (after[id]) fixed++
    }
    const out: FolioRefresh = { ran: true, months, candidates: ids.length, pulled, fixed, ms: Date.now() - t0 }
    await recordRun({ name: 'folio-refresh', ok: true, itemCount: fixed, ms: out.ms, detail: { months, candidates: ids.length, pulled, fixed, source: opts.source || 'cron' } })
    return out
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300)
    await recordRun({ name: 'folio-refresh', ok: false, ms: Date.now() - t0, error, detail: { months, source: opts.source || 'cron' } })
    throw e
  }
}
