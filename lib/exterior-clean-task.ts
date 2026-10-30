// PROPERTY EXTERIOR CLEAN IN BREEZEWAY (Jon, 2026-10-30: "a new checklist to do property exterior
// clean … walk property, walk trash area, check plants, water plants if needed, blow areas if needed
// … under maintenance … Eden, Rustic, Pelican, 906, Oasis every day. Hendricks 3 times a week. Capri,
// Lucerne, Boynton Beach every other day — and every time a clean is scheduled … auto assign to
// whoever is there cleaning, and maintenance every time" · "add Miami Rd 3 times a week").
//
// One Breezeway maintenance task per building on its days, carrying the "Property Exterior Clean
// 1.0" template (BZ_TEMPLATES.exteriorClean):
//   WHEN   daily        → Eden, Rustic, Pelican, 906, Oasis
//          Mon/Wed/Fri  → Hendricks, Miami Rd
//          every other day (even day number) → Capri, Lucerne, Boynton — AND any day a clean is
//          scheduled at the building, so a clean added later in the day still brings the walk.
//   WHERE  the building's Exterior/Building property in Breezeway, else its lowest unit (never "Full").
//   WHO    maintenance (Ronnie) every time + every person with a housekeeping task at the building
//          that day. Later runs only ADD newly assigned cleaners; nobody is taken off.
//   NEVER TWICE  a task with this title on that property for the day is the day's.
// Adding a building = one line in TARGETS.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createBreezewayTask, updateBreezewayTask, breezewayConfigured, breezewayPeopleLite, mapBreezewayTask, BZ_TEMPLATES } from './breezeway'

export const EXTERIOR_CLEAN_PREFIX = 'Property Exterior Clean'
type Cadence = 'daily' | 'mwf' | 'alternate'
type Target = { key: string; label: string; unitRe: RegExp; nameRe: RegExp; cadence: Cadence }
export const TARGETS: Target[] = [
  { key: 'eden', label: 'Eden', unitRe: /^eden\b/i, nameRe: /\beden\b/i, cadence: 'daily' },
  { key: 'rustic', label: 'Rustic', unitRe: /^rustic\b/i, nameRe: /\brustic\b/i, cadence: 'daily' },
  { key: 'pelican', label: 'Pelican', unitRe: /^pelican\b/i, nameRe: /\bpelican\b/i, cadence: 'daily' },
  { key: '906', label: '906', unitRe: /^906\b/i, nameRe: /\b906\b/i, cadence: 'daily' },
  { key: 'oasis', label: 'Oasis', unitRe: /^oasis\b/i, nameRe: /^oasis\b/i, cadence: 'daily' },
  { key: 'hendricks', label: 'Hendricks', unitRe: /^hendricks\b/i, nameRe: /\bhendricks\b/i, cadence: 'mwf' },
  { key: 'miamird', label: 'Miami Rd', unitRe: /^2023\//, nameRe: /\b2023\b|\bmiami\s*r(oa)?d\b/i, cadence: 'mwf' },
  { key: 'capri', label: 'Capri', unitRe: /^capri\b/i, nameRe: /\bcapri\b/i, cadence: 'alternate' },
  { key: 'lucerne', label: 'Lucerne', unitRe: /\blucerne\b/i, nameRe: /\blucerne\b/i, cadence: 'alternate' },
  { key: 'boynton', label: 'Boynton', unitRe: /^boynton\b/i, nameRe: /\bboynton\b/i, cadence: 'alternate' },
]
/** Maintenance, on every task. Breezeway names matched on the first word. */
/** Shared logins that sit on tasks but never walk a property. */
const NOT_A_PERSON = /customer care|support/i
const MAINTENANCE = [/^gehron\b/i /* Ronnie */]

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const titleFor = (label: string) => `${EXTERIOR_CLEAN_PREFIX}: ${label} — walk grounds & trash, water plants, blow walkways`

/** Is this a scheduled day for the cadence (cleans aside)? Pure. */
export function onSchedule(cadence: Cadence, ymd: string): boolean {
  const d = new Date(ymd + 'T12:00:00Z')
  if (cadence === 'daily') return true
  if (cadence === 'mwf') return [1, 3, 5].indexOf(d.getUTCDay()) >= 0
  return Math.floor(d.getTime() / 86400000) % 2 === 0
}

const DESCRIPTION = [
  'Walk the whole property outside: grounds, entrances, walkways, parking and the trash area.',
  'Check the plants and water them if dry. Blow walkways and entrances if there are leaves or debris.',
  'Photos at each step. Anything broken or damaged: note it in the last step.',
  '',
  'Recorre todo el exterior: areas comunes, entradas, pasillos, estacionamiento y area de basura.',
  'Revisa las plantas y riega si estan secas. Sopla pasillos y entradas si hay hojas o basura.',
].join('\n')

export type ExteriorPlan = {
  key: string; label: string; cadence: Cadence; due: boolean; why: string
  homeId: number | null; where: string
  maintenance: { id: number; name: string }[]; cleaners: { id: number; name: string }[]; missing: string[]
  existing: { id: string; assigneeIds: number[] } | null
}

export async function planExteriorCleans(day = ymdET(new Date())): Promise<{ day: string; targets: ExteriorPlan[] }> {
  const db = supabaseAdmin()
  const [{ data: props }, { data: ls }, people] = await Promise.all([
    db.from('breezeway_properties').select('home_id,name,reference_property_id,status').limit(3000),
    db.from('guesty_listings').select('id,nickname,title,active:raw->>active').limit(1000),
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
  ])
  const allProps = ((props || []) as any[]).filter(p => !/inactive|deleted/i.test(str(p.status)))
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => ({ id: str(l.id), name: str(l.nickname || l.title).trim() }))
  const maintenance: { id: number; name: string }[] = [], missing: string[] = []
  for (const re of MAINTENANCE) {
    const p = (people as any[]).find(x => re.test(str(x.name).trim()))
    if (p) maintenance.push({ id: Number(p.id), name: str(p.name) }); else missing.push(re.source.replace(/\\b|\^/g, ''))
  }
  const out: ExteriorPlan[] = []
  for (const t of TARGETS) {
    const unitIds = listings.filter(l => t.unitRe.test(l.name)).map(l => l.id)
    // Units by listing link, plus Breezeway properties named like the units (a new building whose
    // Breezeway homes are not linked to their listing yet — Boynton, 2026-10-30).
    const unitHomes = allProps.filter(p => unitIds.indexOf(str(p.reference_property_id)) >= 0 || t.unitRe.test(str(p.name).trim()))
    const ext = allProps.find(p => /exterior|building/i.test(str(p.name)) && t.nameRe.test(str(p.name)))
    let homeId: number | null = ext ? Number(ext.home_id) : null
    let where = ext ? str(ext.name) : ''
    if (homeId == null) {
      const units = listings.filter(l => t.unitRe.test(l.name) && !/\bfull\b/i.test(l.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      for (const u of units) { const p = allProps.find(x => str(x.reference_property_id) === u.id); if (p) { homeId = Number(p.home_id); where = u.name; break } }
    }
    if (homeId == null) {
      const named = unitHomes.filter(p => !/\bfull\b/i.test(str(p.name))).sort((a, b) => str(a.name).localeCompare(str(b.name), undefined, { numeric: true }))[0]
      if (named) { homeId = Number(named.home_id); where = str(named.name) }
    }
    const homeIds = unitHomes.map(p => Number(p.home_id)).concat(homeId != null ? [homeId] : [])
    const cleaners: { id: number; name: string }[] = []
    let existing: ExteriorPlan['existing'] = null, cleanToday = false
    if (homeIds.length) {
      const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,name,home_id,type_department,assignees,status')
        .in('home_id', homeIds).eq('scheduled_date', day).limit(300)
      for (const tk of (tasks || []) as any[]) {
        if (str(tk.name).indexOf(EXTERIOR_CLEAN_PREFIX) === 0) {
          if (Number(tk.home_id) === homeId) existing = { id: str(tk.id), assigneeIds: (Array.isArray(tk.assignees) ? tk.assignees : []).map((a: any) => Number(a?.id)).filter((n: number) => Number.isFinite(n)) }
          continue
        }
        if (!/housekeep|clean/i.test(str(tk.type_department))) continue
        if (/cancel/i.test(str(tk.status))) continue
        cleanToday = true
        for (const a of (Array.isArray(tk.assignees) ? tk.assignees : []) as any[]) {
          const id = Number(a?.id)
          if (Number.isFinite(id) && !NOT_A_PERSON.test(str(a?.name)) && !cleaners.some(h => h.id === id) && !maintenance.some(m => m.id === id)) cleaners.push({ id, name: str(a?.name) })
        }
      }
    }
    const scheduled = onSchedule(t.cadence, day)
    const due = scheduled || (t.cadence === 'alternate' && cleanToday)
    const why = scheduled ? (t.cadence === 'daily' ? 'daily' : t.cadence === 'mwf' ? 'Mon/Wed/Fri' : 'every other day') : cleanToday && t.cadence === 'alternate' ? 'clean scheduled today' : 'not today'
    out.push({ key: t.key, label: t.label, cadence: t.cadence, due, why, homeId, where, maintenance, cleaners, missing, existing })
  }
  return { day, targets: out }
}

export async function runExteriorCleans(opts: { dryRun?: boolean } = {}) {
  const plan = await planExteriorCleans()
  const lines: string[] = []
  let created = 0, updated = 0
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', ...plan, created, updated, lines }
  const db = supabaseAdmin()
  for (const t of plan.targets) {
    if (!t.due && !t.existing) { lines.push(t.label + ': not today (' + t.cadence + ')'); continue }
    if (t.homeId == null) { lines.push(t.label + ': no Breezeway property found — skipped'); continue }
    const who = t.maintenance.concat(t.cleaners)
    const want = who.map(p => p.id)
    if (t.existing) {
      const add = want.filter(id => t.existing!.assigneeIds.indexOf(id) < 0)
      if (!add.length) { lines.push(t.label + ': today’s task ' + t.existing.id + ' already has everyone'); continue }
      if (opts.dryRun) { lines.push(t.label + ': would add ' + add.length + ' to ' + t.existing.id); continue }
      const r = await updateBreezewayTask(t.existing.id, { assignments: t.existing.assigneeIds.concat(add) })
      if (r.ok) {
        updated++
        lines.push(t.label + ': added ' + add.length + ' to ' + t.existing.id)
        try { if (r.data) { const m: any = mapBreezewayTask(r.data); if (m?.id) await db.from('breezeway_tasks_sync').update({ assignees: m.assignees, assignee_count: m.assignee_count }).eq('id', m.id) } } catch { /* next sync */ }
      } else lines.push(t.label + ': update said ' + r.status + ' ' + str(r.text).slice(0, 120))
      continue
    }
    if (opts.dryRun) { lines.push(t.label + ' (' + t.why + '): would create at ' + t.where + ' for ' + (who.map(p => p.name).join(', ') || 'nobody')); continue }
    const res = await createBreezewayTask({
      home_id: t.homeId, name: titleFor(t.label), type_department: 'maintenance', scheduled_date: plan.day,
      template_id: BZ_TEMPLATES.exteriorClean, description: DESCRIPTION, ...(want.length ? { assignments: want } : {}),
    })
    const id = res.ok && res.data ? str(res.data.id) : ''
    if (!id) { lines.push(t.label + ': Breezeway said ' + res.status + ' ' + str(res.text).slice(0, 120)); continue }
    created++
    lines.push(t.label + ' (' + t.why + '): created ' + id + ' at ' + t.where + ' for ' + (who.map(p => p.name).join(', ') || 'nobody'))
    try {
      const m: any = mapBreezewayTask(res.data)
      if (m?.id) { m.home_id = t.homeId; m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null; await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' }) }
    } catch { /* the next sync mirrors it */ }
  }
  return { ok: true, ...plan, created, updated, lines }
}
