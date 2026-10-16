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

export type CalUnit = { listingId: string; unit: string; building: string; cells: CalCell[] }
export type UnitCells = { today: string; days: string[]; units: CalUnit[]; people: { name: string; trade: string; perDay: Record<string, number> }[]; unsure: string[] }

export async function buildUnitCells(ids: string[], dept: string, today: string, n: number): Promise<UnitCells> {
  const days = Array.from({ length: n }, (_, i) => plus(today, i))
  const last = days[days.length - 1]
  if (!ids.length) return { today, days, units: [], people: [], unsure: [] }
  const unsure: string[] = []
  const db = supabaseAdmin()
  const [stays, tv, cal] = await Promise.all([
    // Any stay touching the window: it ends on/after today and starts on/before the last day.
    pageRows<any>((a, b) => db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status')
      .in('listing_id', ids).gte('check_out', today).lte('check_in', last).order('id').range(a, b), 10),
    teamVisits(today, n),
    getMultiCalendar(ids, today, last).catch(() => null),
  ])
  if (stays.truncated) unsure.push('stays (some reservations could not be read — check Guesty before booking)')
  if (!cal) unsure.push('Guesty blocks (owner stays and holds may be missing)')
  if (tv.truncated) unsure.push('team schedule')

  const byUnit: Record<string, { ci: string; co: string }[]> = {}
  for (const r of (stays.rows as any[])) {
    if (!isLiveStay(r.status)) continue
    const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
    if (ci && co) (byUnit[str(r.listing_id)] = byUnit[str(r.listing_id)] || []).push({ ci, co })
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
    return { listingId: lid, unit, building: b, cells }
  })

  const ppl: Record<string, { name: string; trade: string; perDay: Record<string, number> }> = {}
  for (const byDay of Object.values(tv.visits)) for (const [d, who] of Object.entries(byDay)) for (const s of Object.values(who)) {
    if (!Array.from(s.depts).some(x => tradeOk(dept, x))) continue
    const p = (ppl[s.name.toLowerCase()] = ppl[s.name.toLowerCase()] || { name: s.name, trade: tradeWord(Array.from(s.depts)), perDay: {} })
    p.perDay[d] = (p.perDay[d] || 0) + s.jobs
  }
  const people = Object.values(ppl).sort((a, b) => a.name.localeCompare(b.name))
  return { today, days, units, people, unsure }
}
