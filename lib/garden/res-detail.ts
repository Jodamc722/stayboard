// RESERVATION DETAIL FROM CLOUDBEDS (Jon, 2026-11-10: "id verification, guest profiles").
//
// The reservation LIST Cloudbeds gives the sync leaves three things out that the desk needs:
//   total       getReservationsWithRateDetails carries it — without it revenue and ADR read $0
//   ID on file  getReservation → guestList[].guestDocumentType / guestDocumentNumber
//   card        getReservation → cardsOnFile
// pullTotals() writes totals onto garden_reservations for a wide check-out window; pullDetails() reads
// each arriving / in-house / departing reservation (yesterday → +7 days) and keeps, per reservation,
// only what the desk needs: whether an ID document is on file and its type, whether a card is on
// file, the guest status. Never the document number or card digits. Stored in app_settings
// (garden_res_detail) so it needs no migration.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cbGet } from './cloudbeds'
import { getSettingFresh, setSetting } from '../app-settings'

export const DETAIL_KEY = 'garden_res_detail'
export type ResDetail = { idOnFile: boolean; idType: string | null; idGuests: number; guests: number; cardOnFile: boolean; cards: number; guestStatus: string | null; at: string }

const ymd = (d: Date) => d.toISOString().slice(0, 10)
/** Run `fn` over `items`, `size` at a time — the sync has 120 seconds for everything. */
export async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x) } catch { /* one item never stops the rest */ } } }))
}
const TOTALS_AT = 'garden_totals_at'
const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : null }

/** Totals (and balances) for every reservation checking out in the window. */
export async function pullTotals(daysBack = 120, daysAhead = 365, force = false): Promise<number | null> {
  // Totals move slowly; every six hours is plenty, and it keeps the 20-minute sync inside its budget.
  const last = await getSettingFresh<string | null>(TOTALS_AT, null).catch(() => null)
  if (!force && last && Date.now() - Date.parse(last) < 6 * 3600e3) return null
  const db = supabaseAdmin()
  const from = ymd(new Date(Date.now() - daysBack * 864e5)), to = ymd(new Date(Date.now() + daysAhead * 864e5))
  const got: { id: string; total: number | null; balance: number | null }[] = []
  for (let page = 1; page <= 60; page++) {
    const { data } = await cbGet<any[]>('getReservationsWithRateDetails', { reservationCheckOutFrom: from, reservationCheckOutTo: to, pageNumber: page, pageSize: 100 })
    const rows = Array.isArray(data) ? data : []
    for (const r of rows) if (r?.reservationID) got.push({ id: String(r.reservationID), total: n(r.total), balance: n(r.balance) })
    if (rows.length < 100) break
  }
  // Only rows we hold, only when the total is known — one update per reservation that changed.
  const { data: have } = await db.from('garden_reservations').select('id,total,balance').in('id', got.map(g => g.id).slice(0, 5000))
  const cur: Record<string, any> = {}; for (const h of ((have || []) as any[])) cur[h.id] = h
  const todo = got.filter(g => { const c = cur[g.id]; return c && g.total != null && !(Number(c.total) === g.total && (g.balance == null || Number(c.balance) === g.balance)) })
  await pool(todo, 10, async g => { await db.from('garden_reservations').update({ total: g.total, ...(g.balance != null ? { balance: g.balance } : {}) }).eq('id', g.id) })
  await setSetting(TOTALS_AT, new Date().toISOString(), 'garden-sync')
  return todo.length
}

/** ID / card on file for the desk's window: yesterday through a week out. */
export async function pullDetails(): Promise<number> {
  const db = supabaseAdmin()
  const t0 = ymd(new Date(Date.now() - 864e5)), t7 = ymd(new Date(Date.now() + 7 * 864e5))
  const { data: res } = await db.from('garden_reservations').select('id,check_in').lte('check_in', t7).gte('check_out', t0).neq('status', 'canceled').limit(200)
  const prev = await getSettingFresh<Record<string, ResDetail>>(DETAIL_KEY, {}).catch(() => ({} as Record<string, ResDetail>))
  const out: Record<string, ResDetail> = {}
  // Keep anything still recent so a failed read never blanks a reservation the desk is looking at.
  const keepAfter = Date.now() - 14 * 864e5
  for (const [k, v] of Object.entries(prev || {})) if (v && Date.parse(v.at) > keepAfter) out[k] = v
  let n2 = 0
  // Arrivals today and tomorrow every run; everyone else once every two hours.
  const t1 = ymd(new Date(Date.now() + 864e5)), fresh = Date.now() - 2 * 3600e3
  const todo = ((res || []) as any[]).filter(r => r.check_in <= t1 && r.check_in >= ymd(new Date()) || !out[r.id] || Date.parse(out[r.id].at) < fresh)
  await pool(todo, 8, async r => {
    {
      const { data: d } = await cbGet<any>('getReservation', { reservationID: r.id })
      if (!d) return
      const gl = Object.values(d.guestList || {}) as any[]
      const withId = gl.filter(g => String(g?.guestDocumentType || '').trim() && String(g?.guestDocumentNumber || '').trim())
      const main = gl.find(g => g?.isMainGuest) || gl[0] || null
      const cards = Array.isArray(d.cardsOnFile) ? d.cardsOnFile.length : d.cardsOnFile && typeof d.cardsOnFile === 'object' ? Object.keys(d.cardsOnFile).length : 0
      out[r.id] = {
        idOnFile: withId.length > 0, idType: withId[0] ? String(withId[0].guestDocumentType).replace(/_/g, ' ').slice(0, 40) : null,
        idGuests: withId.length, guests: gl.length, cardOnFile: cards > 0, cards, guestStatus: main?.guestStatus ? String(main.guestStatus) : null, at: new Date().toISOString(),
      }
      if (n(d.total) != null) await db.from('garden_reservations').update({ total: n(d.total), ...(n(d.balance) != null ? { balance: n(d.balance) } : {}) }).eq('id', r.id)
      n2++
    }
  })
  await setSetting(DETAIL_KEY, out, 'garden-sync')
  return n2
}

export async function resDetails(): Promise<Record<string, ResDetail>> {
  return getSettingFresh<Record<string, ResDetail>>(DETAIL_KEY, {}).catch(() => ({} as Record<string, ResDetail>))
}
