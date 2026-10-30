// PROPERTY PROGRAMS — a Breezeway template that runs on a schedule at a building or a unit (Jon,
// 2026-10-30: "This should be part of the upkeep page, programs, should be able to create them,
// manage them, update them. This should not create duplicates, if not done, should move the one from
// previous day" · "should allow us to add a template, assign it to a unit or property, and should be
// smart and intuitive").
//
// A PROGRAM is: a template (its checklist), the task title, a department, the people who always get
// it, whether whoever is cleaning there that day is added too, and a list of PLACES — a whole
// building or one unit — each with its own days:
//   days         weekdays it runs (0 = Sun … 6 = Sat)
//   alternate    every other day instead (even day numbers, so two buildings on it walk the same day)
//   onCleanDays  also any day a clean is scheduled there
//
// ONE TASK PER PLACE, EVER OPEN (the filter-change rule, 2026-10-28). Each run, per place:
//   an open task of this program dated today      → the day's task; only newly assigned cleaners are added
//   an open task from an earlier day (not done)   → MOVED to today, cleaners added — never a second task
//   more than one open                            → the newest is kept and moved; the rest are cancelled
//   none open and today is one of its days        → created
// Done or cancelled tasks are history and never moved. A place's day that is not on its schedule
// creates nothing, but a still-open task from before is still moved forward — it is still owed.
//
// WHERE a building's task lands: its Exterior/Building property in Breezeway when it has one, else
// its first unit (never a "Full" listing). A unit's task lands on that unit.
//
// Stored in app_settings (no migration). The first read seeds the Property Exterior Clean program
// Jon set up the same morning.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting } from './app-settings'
import { buildingOf } from './segments'
import { isTaskDone, isTaskGone } from './task-categories'
import {
  createBreezewayTask, updateBreezewayTask, cancelBreezewayTask, breezewayConfigured, breezewayPeopleLite, mapBreezewayTask,
} from './breezeway'

export const PROGRAMS_KEY = 'site_programs'
export type Person = { id: number; name: string }
export type Place = {
  id: string
  kind: 'building' | 'unit'
  /** building: the grouping key (buildingOf) · unit: the Guesty listing id */
  ref: string
  /** What the crew reads in the task title: "Eden", "Miami Rd", "Capri 109". */
  label: string
  days: number[]
  alternate: boolean
  onCleanDays: boolean
}
export type Program = {
  id: string
  name: string
  active: boolean
  templateId: number | null
  templateName: string
  department: 'maintenance' | 'housekeeping' | 'inspection'
  description: string
  people: Person[]
  addCleaners: boolean
  places: Place[]
  updatedAt?: string
  updatedBy?: string
}

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const NOT_A_PERSON = /customer care|support/i
const LOOKBACK_DAYS = 45

const ALL = [0, 1, 2, 3, 4, 5, 6], MWF = [1, 3, 5]
const SEED: Program[] = [{
  id: 'exterior-clean', name: 'Property Exterior Clean', active: true,
  templateId: 921654, templateName: 'Property Exterior Clean 1.0', department: 'maintenance',
  description: 'Walk the whole property outside: grounds, entrances, walkways, parking and the trash area. Check the plants and water them if dry. Blow walkways and entrances if there are leaves or debris. Photos at each step.\n\nRecorre todo el exterior: areas comunes, entradas, pasillos, estacionamiento y area de basura. Revisa las plantas y riega si estan secas. Sopla pasillos y entradas si hay hojas o basura.',
  people: [{ id: 203520, name: 'Gehron Regis' }], addCleaners: true,
  places: [
    { id: 'eden', kind: 'building', ref: 'Eden', label: 'Eden', days: ALL, alternate: false, onCleanDays: false },
    { id: 'rustic', kind: 'building', ref: 'Rustic', label: 'Rustic', days: ALL, alternate: false, onCleanDays: false },
    { id: 'pelican', kind: 'building', ref: 'Pelican', label: 'Pelican', days: ALL, alternate: false, onCleanDays: false },
    { id: '906', kind: 'building', ref: '906', label: '906', days: ALL, alternate: false, onCleanDays: false },
    { id: 'oasis', kind: 'building', ref: 'Oasis', label: 'Oasis', days: ALL, alternate: false, onCleanDays: false },
    { id: 'hendricks', kind: 'building', ref: 'Hendricks', label: 'Hendricks', days: MWF, alternate: false, onCleanDays: false },
    { id: 'miamird', kind: 'building', ref: '2023', label: 'Miami Rd', days: MWF, alternate: false, onCleanDays: false },
    { id: 'capri', kind: 'building', ref: 'Capri', label: 'Capri', days: [], alternate: true, onCleanDays: true },
    { id: 'lucerne', kind: 'building', ref: 'Lucerne', label: 'Lucerne', days: [], alternate: true, onCleanDays: true },
    { id: 'boynton', kind: 'building', ref: 'Boynton', label: 'Boynton', days: [], alternate: true, onCleanDays: true },
  ],
}]

/** The building a listing belongs to: the segments rule, else the leading street number ("2023/1" → "2023"). */
export function buildingKey(building: string, name: string): string {
  const b = buildingOf(building || null, name || null)
  if (b) return b
  const m = str(name).trim().match(/^(\d{3,5})\b/)
  return m ? m[1] : str(name).trim()
}

/** The task title the crew reads, and the prefix every task of the program starts with. */
export const titlePrefix = (p: Program) => p.name.trim() + ':'
export const taskTitle = (p: Program, place: Place) => `${p.name.trim()}: ${place.label.trim()}`

/** Is today one of the place's days (cleans aside)? Pure. */
export function onDays(place: Place, ymd: string): boolean {
  const d = new Date(ymd + 'T12:00:00Z')
  if (place.alternate && Math.floor(d.getTime() / 86400000) % 2 === 0) return true
  return place.days.indexOf(d.getUTCDay()) >= 0
}

/** One line for a place's schedule: "Every day", "Mon, Wed, Fri", "Every other day + clean days". */
export function scheduleLine(place: Place): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const parts: string[] = []
  const days = Array.from(new Set(place.days)).sort()
  if (days.length === 7) parts.push('Every day')
  else if (days.length) parts.push(days.map(d => names[d]).join(', '))
  if (place.alternate) parts.push('every other day')
  if (place.onCleanDays) parts.push('clean days')
  if (!parts.length) return 'No days set'
  const s = parts.join(' + ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function clean(p: any): Program | null {
  if (!p || typeof p !== 'object') return null
  const name = str(p.name).trim().slice(0, 80)
  if (!name) return null
  const dept = ['maintenance', 'housekeeping', 'inspection'].indexOf(p.department) >= 0 ? p.department : 'maintenance'
  const places: Place[] = (Array.isArray(p.places) ? p.places : []).map((x: any, i: number) => ({
    id: str(x?.id) || 'p' + i + '-' + Math.random().toString(36).slice(2, 7),
    kind: x?.kind === 'unit' ? 'unit' : 'building',
    ref: str(x?.ref).trim(),
    label: str(x?.label || x?.ref).trim().slice(0, 60),
    days: (Array.isArray(x?.days) ? x.days : []).map(Number).filter((n: number) => n >= 0 && n <= 6),
    alternate: !!x?.alternate,
    onCleanDays: !!x?.onCleanDays,
  })).filter((x: Place) => x.ref && x.label)
  const people: Person[] = (Array.isArray(p.people) ? p.people : []).map((x: any) => ({ id: Number(x?.id), name: str(x?.name) })).filter((x: Person) => Number.isFinite(x.id) && x.id > 0)
  return {
    id: str(p.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program',
    name, active: p.active !== false,
    templateId: Number(p.templateId) > 0 ? Number(p.templateId) : null,
    templateName: str(p.templateName).slice(0, 120), department: dept,
    description: str(p.description).slice(0, 2000), people, addCleaners: p.addCleaners !== false, places,
    updatedAt: str(p.updatedAt) || undefined, updatedBy: str(p.updatedBy) || undefined,
  }
}

export async function loadPrograms(): Promise<Program[]> {
  const raw = await getSetting<any>(PROGRAMS_KEY, null)
  const list = raw && Array.isArray(raw.programs) ? raw.programs : null
  if (!list) return SEED.map(p => ({ ...p }))
  return list.map(clean).filter(Boolean) as Program[]
}

export async function savePrograms(programs: Program[], by?: string): Promise<{ ok: boolean; error?: string }> {
  return setSetting(PROGRAMS_KEY, { programs }, by || null)
}

/** Save one program (create or replace by id). Names must be unique: the name is how its tasks are found. */
export async function upsertProgram(input: any, by: string): Promise<{ ok: boolean; error?: string; program?: Program }> {
  const p = clean(input)
  if (!p) return { ok: false, error: 'A program needs a name.' }
  const all = await loadPrograms()
  const clash = all.find(x => x.id !== p.id && x.name.trim().toLowerCase() === p.name.trim().toLowerCase())
  if (clash) return { ok: false, error: 'Another program is already called "' + p.name + '".' }
  p.updatedAt = new Date().toISOString(); p.updatedBy = by
  const at = all.findIndex(x => x.id === p.id)
  if (at < 0 && all.some(x => x.id === p.id)) p.id = p.id + '-' + Date.now().toString(36)
  const next = at >= 0 ? all.map((x, i) => (i === at ? p : x)) : all.concat([p])
  const r = await savePrograms(next, by)
  return r.ok ? { ok: true, program: p } : { ok: false, error: r.error }
}

export async function deleteProgram(id: string, by: string) {
  const all = await loadPrograms()
  return savePrograms(all.filter(p => p.id !== id), by)
}

// ── the day's plan ───────────────────────────────────────────────────────────────────────────────

export type OpenTask = { id: string; date: string; assigneeIds: number[]; homeId: number }
export type PlacePlan = {
  programId: string; placeId: string; label: string; kind: Place['kind']; schedule: string
  homeId: number | null; where: string
  due: boolean; why: string
  people: Person[]; cleaners: Person[]
  today: OpenTask | null
  carry: OpenTask | null          // an open task from an earlier day, to move to today
  extras: OpenTask[]              // further open duplicates, to cancel
  action: 'create' | 'move' | 'add' | 'none' | 'skip'
  note: string
}

type Ctx = {
  props: any[]; listings: { id: string; name: string; building: string; key: string }[]
  people: any[]
}

async function context(): Promise<Ctx> {
  const db = supabaseAdmin()
  const [{ data: props }, { data: ls }, people] = await Promise.all([
    db.from('breezeway_properties').select('home_id,name,reference_property_id,status').limit(3000),
    db.from('guesty_listings').select('id,nickname,title,building,active:raw->>active').limit(3000),
    breezewayConfigured() ? breezewayPeopleLite().catch(() => []) : Promise.resolve([]),
  ])
  const listings = ((ls || []) as any[]).filter(l => String(l.active) !== 'false').map(l => {
    const name = str(l.nickname || l.title).trim()
    return { id: str(l.id), name, building: str(l.building), key: buildingKey(str(l.building), name) }
  })
  return { props: ((props || []) as any[]).filter(p => !/inactive|deleted/i.test(str(p.status))), listings, people: people as any[] }
}

/** Where a place's task lands, and every Breezeway home at the place (to find cleans there). */
function resolvePlace(place: Place, ctx: Ctx): { homeId: number | null; where: string; homeIds: number[] } {
  const homeOfListing = (id: string) => ctx.props.find(p => str(p.reference_property_id) === id)
  if (place.kind === 'unit') {
    const l = ctx.listings.find(x => x.id === place.ref)
    const p = homeOfListing(place.ref)
    return p ? { homeId: Number(p.home_id), where: l?.name || str(p.name), homeIds: [Number(p.home_id)] } : { homeId: null, where: l?.name || '', homeIds: [] }
  }
  const key = place.ref.toLowerCase()
  const units = ctx.listings.filter(l => l.key.toLowerCase() === key)
  const unitProps = units.map(u => homeOfListing(u.id)).filter(Boolean) as any[]
  // Breezeway homes not linked to a listing yet but named like the building's units (a new building).
  const named = ctx.props.filter(p => !p.reference_property_id && buildingKey('', str(p.name)).toLowerCase() === key)
  const all = unitProps.concat(named)
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const words = [place.ref, place.label].filter(Boolean).map(w => new RegExp('\\b' + esc(w) + '\\b', 'i'))
  const ext = ctx.props.find(p => /exterior|building|common/i.test(str(p.name)) && words.some(re => re.test(str(p.name))))
  const homeIds = all.map(p => Number(p.home_id)).concat(ext ? [Number(ext.home_id)] : [])
  if (ext) return { homeId: Number(ext.home_id), where: str(ext.name), homeIds }
  const first = units.filter(u => !/\bfull\b/i.test(u.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(u => ({ u, p: homeOfListing(u.id) })).find(x => x.p)
  if (first) return { homeId: Number(first.p.home_id), where: first.u.name, homeIds }
  const n = named.filter(p => !/\bfull\b/i.test(str(p.name))).sort((a, b) => str(a.name).localeCompare(str(b.name), undefined, { numeric: true }))[0]
  return n ? { homeId: Number(n.home_id), where: str(n.name), homeIds } : { homeId: null, where: '', homeIds }
}

const ids = (as: any): number[] => (Array.isArray(as) ? as : []).map((a: any) => Number(a?.id)).filter((n: number) => Number.isFinite(n))

export async function planPrograms(day = ymdET(new Date()), only?: string): Promise<{ day: string; plans: PlacePlan[] }> {
  const programs = (await loadPrograms()).filter(p => (only ? p.id === only : p.active))
  if (!programs.length) return { day, plans: [] }
  const ctx = await context()
  const db = supabaseAdmin()
  const resolved = programs.flatMap(p => p.places.map(place => ({ p, place, r: resolvePlace(place, ctx) })))
  const allHomes = Array.from(new Set(resolved.flatMap(x => x.r.homeIds.concat(x.r.homeId != null ? [x.r.homeId] : []))))
  // Two reads: today's tasks at every place (cleans → who is there), and each program's own tasks over
  // the look-back window (anything still open is carried, never duplicated).
  const tasks: any[] = [], seen = new Set<string>()
  const keep = (rows: any) => { for (const t of (rows || []) as any[]) if (!seen.has(str(t.id))) { seen.add(str(t.id)); tasks.push(t) } }
  const COLS = 'id,name,home_id,type_department,assignees,status,finished_at,scheduled_date'
  for (let i = 0; i < allHomes.length; i += 150) {
    const { data } = await db.from('breezeway_tasks_sync').select(COLS).in('home_id', allHomes.slice(i, i + 150)).eq('scheduled_date', day).limit(3000)
    keep(data)
  }
  for (const p of programs) {
    const { data } = await db.from('breezeway_tasks_sync').select(COLS).ilike('name', p.name.trim().replace(/[%_]/g, '') + ':%')
      .gte('scheduled_date', shift(day, -LOOKBACK_DAYS)).lte('scheduled_date', day).limit(3000)
    keep(data)
  }
  const plans: PlacePlan[] = []
  for (const { p, place, r } of resolved) {
    const base = { programId: p.id, placeId: place.id, label: place.label, kind: place.kind, schedule: scheduleLine(place), homeId: r.homeId, where: r.where }
    const mine = new Set(r.homeIds.concat(r.homeId != null ? [r.homeId] : []))
    const here = tasks.filter(t => mine.has(Number(t.home_id)))
    // Cleaners there today.
    const cleaners: Person[] = []
    let cleanToday = false
    for (const t of here) {
      if (str(t.scheduled_date) !== day || !/housekeep|clean/i.test(str(t.type_department))) continue
      if (str(t.name).indexOf(titlePrefix(p)) === 0 || isTaskGone(t.status)) continue
      cleanToday = true
      if (!p.addCleaners) continue
      for (const a of (Array.isArray(t.assignees) ? t.assignees : []) as any[]) {
        const id = Number(a?.id)
        if (Number.isFinite(id) && !NOT_A_PERSON.test(str(a?.name)) && !cleaners.some(c => c.id === id) && !p.people.some(x => x.id === id)) cleaners.push({ id, name: str(a?.name) })
      }
    }
    // This program's open tasks at the place, newest first.
    const open = here.filter(t => str(t.name).indexOf(titlePrefix(p)) === 0 && !isTaskDone(t.status, t.finished_at) && !isTaskGone(t.status))
      .map(t => ({ id: str(t.id), date: str(t.scheduled_date), assigneeIds: ids(t.assignees), homeId: Number(t.home_id) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id) - Number(a.id)))
    const todayT = open.find(t => t.date === day) || null
    const older = open.filter(t => t !== todayT)
    const carry = todayT ? null : older[0] || null
    const extras = todayT ? older : older.slice(1)
    const scheduled = onDays(place, day)
    const due = scheduled || (place.onCleanDays && cleanToday)
    const why = scheduled ? scheduleLine(place) : place.onCleanDays && cleanToday ? 'clean scheduled today' : 'not today'
    const people = p.people
    let action: PlacePlan['action'] = 'none', note = ''
    if (r.homeId == null && !todayT && !carry) { action = 'skip'; note = place.kind === 'unit' ? 'unit not in Breezeway' : 'no Breezeway property at this building yet' }
    else if (todayT) { action = 'add'; note = 'today’s task is on the board' }
    else if (carry) { action = 'move'; note = 'not done on ' + carry.date + ' — moves to today' }
    else if (due) { action = 'create'; note = 'due — ' + why }
    else note = 'not today'
    plans.push({ ...base, due, why, people, cleaners, today: todayT, carry, extras, action, note })
  }
  return { day, plans }
}

export async function runPrograms(opts: { dryRun?: boolean; only?: string } = {}) {
  const { day, plans } = await planPrograms(undefined, opts.only)
  const programs = await loadPrograms()
  const lines: string[] = []
  let created = 0, moved = 0, updated = 0, cancelled = 0
  if (!breezewayConfigured()) return { ok: false, error: 'Breezeway is not configured', day, plans, created, moved, updated, cancelled, lines }
  const db = supabaseAdmin()
  const mirror = async (res: any, homeId?: number | null) => {
    try {
      if (!res?.data) return
      const m: any = mapBreezewayTask(res.data)
      if (!m?.id) return
      if (homeId != null && !m.home_id) m.home_id = homeId
      m.synced_at = new Date().toISOString(); const rp = Number(m.rate_paid); m.rate_paid = Number.isFinite(rp) ? rp : null
      await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
    } catch { /* the next sync mirrors it */ }
  }
  for (const pl of plans) {
    const p = programs.find(x => x.id === pl.programId)
    if (!p) continue
    const tag = p.name + ' · ' + pl.label
    const want = pl.people.concat(pl.cleaners).map(x => x.id)
    // Duplicates first: one open task per place.
    for (const x of pl.extras) {
      if (opts.dryRun) { lines.push(tag + ': would cancel duplicate ' + x.id + ' (' + x.date + ')'); continue }
      const c = await cancelBreezewayTask(x.id).catch(() => ({ ok: false } as any))
      if (c.ok) { cancelled++; lines.push(tag + ': cancelled duplicate ' + x.id); try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', x.id) } catch { /* sync */ } }
    }
    if (pl.action === 'skip' || pl.action === 'none') { lines.push(tag + ': ' + pl.note); continue }
    const t = pl.today || pl.carry
    if (t) {
      const add = want.filter(id => t.assigneeIds.indexOf(id) < 0)
      const moving = pl.action === 'move'
      if (!moving && !add.length) { lines.push(tag + ': today’s task ' + t.id + ' already has everyone'); continue }
      if (opts.dryRun) { lines.push(tag + ': would ' + (moving ? 'move ' + t.id + ' from ' + t.date + ' to today' : 'add ' + add.length + ' to ' + t.id) + (moving && add.length ? ' and add ' + add.length : '')); continue }
      const body: any = {}
      if (add.length) body.assignments = t.assigneeIds.concat(add)
      if (moving) body.scheduled_date = day
      const r = await updateBreezewayTask(t.id, body)
      if (!r.ok) { lines.push(tag + ': Breezeway said ' + r.status + ' ' + str(r.text).slice(0, 120)); continue }
      if (moving) moved++; else updated++
      lines.push(tag + ': ' + (moving ? 'moved ' + t.id + ' from ' + t.date + ' to today' : 'added ' + add.length + ' to ' + t.id))
      await mirror(r, t.homeId)
      continue
    }
    if (opts.dryRun) { lines.push(tag + ' (' + pl.why + '): would create at ' + pl.where + ' for ' + (pl.people.concat(pl.cleaners).map(x => x.name).join(', ') || 'nobody')); continue }
    const res = await createBreezewayTask({
      home_id: pl.homeId, name: taskTitle(p, { label: pl.label } as Place), type_department: p.department, scheduled_date: day,
      template_id: p.templateId || null, ...(p.description ? { description: p.description } : {}), ...(want.length ? { assignments: want } : {}),
    })
    const id = res.ok && res.data ? str(res.data.id) : ''
    if (!id) { lines.push(tag + ': Breezeway said ' + res.status + ' ' + str(res.text).slice(0, 120)); continue }
    created++
    lines.push(tag + ' (' + pl.why + '): created ' + id + ' at ' + pl.where)
    await mirror(res, pl.homeId)
  }
  return { ok: true, day, plans, created, moved, updated, cancelled, lines }
}

/** What the editor offers as places: every building (with its unit count) and every unit. */
export async function placeOptions() {
  const ctx = await context()
  const byKey: Record<string, { key: string; units: number; sample: string; inBreezeway: boolean }> = {}
  const linked = new Set(ctx.props.map(p => str(p.reference_property_id)).filter(Boolean))
  for (const l of ctx.listings) {
    const b = byKey[l.key] || (byKey[l.key] = { key: l.key, units: 0, sample: l.name, inBreezeway: false })
    if (!/\bfull\b/i.test(l.name)) b.units++
    if (linked.has(l.id)) b.inBreezeway = true
  }
  for (const p of ctx.props) if (!p.reference_property_id) { const k = buildingKey('', str(p.name)); if (byKey[k]) byKey[k].inBreezeway = true }
  return {
    buildings: Object.values(byKey).filter(b => b.units > 0).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    units: ctx.listings.filter(l => !/\bfull\b/i.test(l.name)).map(l => ({ id: l.id, name: l.name, building: l.key, inBreezeway: linked.has(l.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  }
}
