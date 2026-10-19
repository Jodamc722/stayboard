// The unit × day cells behind the Upkeep calendar and the smart booking (see app/api/upkeep/calendar).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { isLiveStay } from './stay-status'
import { getMultiCalendar, isOpsBlock } from './guesty'
import { teamVisits, tradeOk, buildingKey } from './upkeep-plan'
import type { CalKind, CalCell } from './upkeep-schedule'

const str = (v: any) => String(v ?? '').trim()
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const tradeWord = (ds: string[]) => { const j = ds.join(' ').toLowerCase(); return /maint/.test(j) ? 'maintenance' : /inspect/.test(j) ? 'inspection' : /housekeep|clean/.test(j) ? 'housekeeping' : (ds[0] || '') }

/** A stay touching the window, for the reservation bars on the calendar (Jon, 2026-10-19). */
export type CalStay = { id: string; guest: string; checkIn: string; checkOut: string; nights: number | null; source: string | null; owner: boolean }
export type CalUnit = { listingId: string; unit: string; building: string; cells: CalCell[]; stays: CalStay[] }
export type UnitCells = { today: string; days: string[]; units: CalUnit[]; people: { name: string; trade: string; perDay: Record<string, number> }[]; unsure: string[] }

export async function buildUnitCells(ids: string[], dept: string, today: string, n: number): Promise<UnitCells> {
  const days = Array.from({ length: n }, (_, i) => plus(today, i))
  const last = days[days.length - 1]
  if (!ids.length) return { today, days, units: [], people: [], unsure: [] }
  const unsure: string[] = []
  const db = supabaseAdmin()
  const [stays, tv, cal] = await Promise.all([
    // Any stay touching the window: it ends on/after today and starts on/before the last day.
    pageRows<any>((a, b) => db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status,guest_name,nights,source')
      .in('listing_id', ids).gte('check_out', today).lte('check_in', last).order('id').range(a, b), 10),
    teamVisits(today, n),
    getMultiCalendar(ids, today, last).catch(() => null),
  ])
  if (stays.truncated) unsure.push('stays (some reservations could not be read — check Guesty before booking)')
  if (!cal) unsure.push('Guesty blocks (owner stays and holds may be missing)')
  if (tv.truncated) unsure.push('team schedule')

  const byUnit: Record<string, { ci: string; co: string; id: string; guest: string; nights: number | null; source: string | null }[]> = {}
  for (const r of (stays.rows as any[])) {
    if (!isLiveStay(r.status)) continue
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    if (ci && co) (byUnit[str(r.listing_id)] = byUnit[str(r.listing_id)] || []).push({ ci, co, id: str(r.id), guest: str(r.guest_name) || 'Guest', nights: r.nights != null ? Number(r.nights) : null, source: r.source ? str(r.source) : null })
  }
  const blockOf: Record<string, { label: string; occupied: boolean }> = {}
  for (const d of (cal || [])) {
    if (!isOpsBlock(d)) continue
    const ref = d.refs?.[0]
    const label = (ref?.reason || ref?.note || d.note || 'Blocked in Guesty').slice(0, 60)
    const keys = Object.keys(d.blocks || {}).filter(k => (d.blocks as any)[k]).map(k => k.toLowerCase())
    // Somebody is (or may be) in the unit: an owner block, or a label/note that says a person is staying.
    const occupied = keys.includes('o') || String(ref?.type || '').toLowerCase() === 'o' || /owner|stay|guest|family|friend|tenant|personal use/i.test(label + ' ' + (ref?.note || ''))
    blockOf[d.listingId + '|' + d.date] = { label, occupied }
  }

  const units: CalUnit[] = ids.map(lid => {
    const unit = tv.nameOf[lid] || lid
    const b = tv.bOf[lid] || buildingKey(unit)
    const ss = byUnit[lid] || []
    const cells: CalCell[] = days.map(d => {
      const inAllDay = ss.some(s => s.ci < d && d < s.co)                   // here the night before AND that night
      const leaves = ss.some(s => s.co === d)
      const arrives = ss.some(s => s.ci === d)
      let k: CalKind = inAllDay ? 'stay' : leaves && arrives ? 'turn' : leaves ? 'out' : arrives ? 'in' : 'open'
      let label: string | null = null
      // A Guesty block on an otherwise empty day (owner stay, hold) — the night of d.
      const bl = blockOf[lid + '|' + d]
      if ((k === 'open' || k === 'out') && bl) { k = bl.occupied ? 'block' : k === 'open' ? 'hold' : 'out'; label = 'Guesty: ' + bl.label }
      const team = Object.values(tv.visits[b]?.[d] || {})
        .filter(s => Array.from(s.depts).some(x => tradeOk(dept, x)))
        .map(s => ({ name: s.name, atUnit: s.units.has(lid), jobs: s.jobs, trade: tradeWord(Array.from(s.depts)) }))
        .sort((x, y) => Number(y.atUnit) - Number(x.atUnit) || y.jobs - x.jobs)
      return { d, k, label, team }
    })
    const stays: CalStay[] = ss.slice().sort((x, y) => x.ci.localeCompare(y.ci))
      .map(x => ({ id: x.id, guest: x.guest, checkIn: x.ci, checkOut: x.co, nights: x.nights, source: x.source, owner: /^owner/i.test(x.source || '') }))
    return { listingId: lid, unit, building: b, cells, stays }
  })

  // A person's trade is what most of their work is (a tech who also carries a linen drop is still a tech).
  const ppl: Record<string, { name: string; trade: string; perDay: Record<string, number>; tally: Record<string, number> }> = {}
  for (const byDay of Object.values(tv.visits)) for (const [d, who] of Object.entries(byDay)) for (const s of Object.values(who)) {
    if (!Array.from(s.depts).some(x => tradeOk(dept, x))) continue
    const p = (ppl[s.name.toLowerCase()] = ppl[s.name.toLowerCase()] || { name: s.name, trade: '', perDay: {}, tally: {} })
    p.perDay[d] = (p.perDay[d] || 0) + s.jobs
    for (const x of Array.from(s.depts)) { const t = tradeWord([x]); if (t) p.tally[t] = (p.tally[t] || 0) + 1 }
  }
  const people = Object.values(ppl).map(p => ({ name: p.name, perDay: p.perDay, trade: Object.entries(p.tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '' })).sort((a, b) => a.name.localeCompare(b.name))
  // The same majority trade on the day chips, so one person never reads as two trades.
  const tradeOfName = new Map(people.map(p => [p.name.toLowerCase(), p.trade]))
  for (const u of units) for (const c of u.cells) for (const t of c.team) { const tr = tradeOfName.get(t.name.toLowerCase()); if (tr) t.trade = tr }
  return { today, days, units, people, unsure }
}
